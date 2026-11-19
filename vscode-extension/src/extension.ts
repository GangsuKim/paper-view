import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';

let serverProc: ChildProcess | null = null;
let activePanel: vscode.WebviewPanel | null = null;
let outputChannel: vscode.OutputChannel;

function getPort(): number {
  return vscode.workspace.getConfiguration('paperview').get<number>('port', 8787);
}

function resolveProjectRoot(context: vscode.ExtensionContext): string | null {
  const configured = vscode.workspace
    .getConfiguration('paperview')
    .get<string>('projectRoot', '')
    .trim();
  if (configured && fs.existsSync(path.join(configured, 'backend', 'app', 'main.py'))) {
    return configured;
  }

  // Check parent of vscode-extension directory
  const fromExt = path.resolve(context.extensionPath, '..');
  if (fs.existsSync(path.join(fromExt, 'backend', 'app', 'main.py'))) {
    return fromExt;
  }

  // Check open workspace folders
  for (const wf of vscode.workspace.workspaceFolders || []) {
    const p = wf.uri.fsPath;
    if (fs.existsSync(path.join(p, 'backend', 'app', 'main.py'))) {
      return p;
    }
  }
  return null;
}

async function isServerHealthy(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = (await res.json()) as { service?: string };
    return data?.service === 'paper-view';
  } catch {
    return false;
  }
}

async function ensureServerRunning(context: vscode.ExtensionContext): Promise<string> {
  const port = getPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  if (await isServerHealthy(port)) {
    return baseUrl;
  }

  const root = resolveProjectRoot(context);
  if (!root) {
    throw new Error(
      'PaperView 백엔드 경로를 찾을 수 없습니다. 설정(paperview.projectRoot)을 확인해주세요.'
    );
  }

  const isWin = process.platform === 'win32';
  const venvPython = isWin
    ? path.join(root, 'backend', 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'backend', 'venv', 'bin', 'python');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';

  outputChannel.appendLine(`[PaperView] Starting local server on ${baseUrl}...`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'PaperView 로컬 서버를 시작하는 중...',
      cancellable: false,
    },
    async () => {
      serverProc = spawn(
        pythonCmd,
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
        {
          cwd: path.join(root, 'backend'),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        }
      );

      serverProc.stdout?.on('data', (d) => outputChannel.append(d.toString()));
      serverProc.stderr?.on('data', (d) => outputChannel.append(d.toString()));
      serverProc.on('exit', (code) => {
        outputChannel.appendLine(`[PaperView] Server exited (code=${code})`);
        serverProc = null;
      });

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 400));
        if (await isServerHealthy(port)) {
          outputChannel.appendLine('[PaperView] Local server is ready.');
          return;
        }
      }
      throw new Error(
        'PaperView 서버 시작 시간이 초과되었습니다. Output > PaperView 로그를 확인해주세요.'
      );
    }
  );

  return baseUrl;
}

async function registerLocalPdf(baseUrl: string, filePath: string): Promise<{ paperId: string; title: string }> {
  const res = await fetch(`${baseUrl}/api/papers/open-local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PDF 열기 실패: ${txt}`);
  }
  const data = (await res.json()) as { paper: { paper_id: string; title: string } };
  return { paperId: data.paper.paper_id, title: data.paper.title };
}

function buildWebviewHtml(externalUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${externalUrl} http://127.0.0.1:* http://localhost:*; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body, iframe {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      border: none;
      overflow: hidden;
      background: #0b1120;
    }
  </style>
</head>
<body>
  <iframe id="pv-frame" src="${externalUrl}" allow="clipboard-read; clipboard-write"></iframe>
  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('pv-frame');

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'paperview:openExternal' && msg.url) {
        vscode.postMessage({ type: 'openExternal', url: msg.url });
      } else if (msg.type === 'ext:loadPaperId' && frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'paperview:loadPaperId', paperId: msg.paperId }, '*');
      }
    });
  </script>
</body>
</html>`;
}

async function openReaderWebview(
  context: vscode.ExtensionContext,
  paperId?: string,
  paperTitle?: string
): Promise<void> {
  const baseUrl = await ensureServerRunning(context);
  const targetRaw = paperId
    ? `${baseUrl}/?paperId=${encodeURIComponent(paperId)}`
    : `${baseUrl}/`;
  const resolvedUri = await vscode.env.asExternalUri(vscode.Uri.parse(targetRaw));

  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.Active);
    if (paperTitle) {
      activePanel.title = `PaperView: ${paperTitle.slice(0, 28)}`;
    }
    if (paperId) {
      activePanel.webview.postMessage({ type: 'ext:loadPaperId', paperId });
    }
    return;
  }

  activePanel = vscode.window.createWebviewPanel(
    'paperviewReader',
    paperTitle ? `PaperView: ${paperTitle.slice(0, 28)}` : 'PaperView 리더',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  activePanel.webview.html = buildWebviewHtml(resolvedUri.toString());
  activePanel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === 'openExternal' && msg.url) {
      vscode.env.openExternal(vscode.Uri.parse(msg.url));
    }
  });

  activePanel.onDidDispose(() => {
    activePanel = null;
  });
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('PaperView');

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(book) PaperView';
  statusBar.tooltip = 'PaperView 영어 논문 리더 열기 (Local Claude / Antigravity)';
  statusBar.command = 'paperview.openReader';
  statusBar.show();

  context.subscriptions.push(
    outputChannel,
    statusBar,
    vscode.commands.registerCommand('paperview.openReader', async () => {
      try {
        await openReaderWebview(context);
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message || String(err));
      }
    }),
    vscode.commands.registerCommand('paperview.openPdfInReader', async (uri?: vscode.Uri) => {
      try {
        let targetPath = uri?.fsPath;
        if (!targetPath) {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'PDF Files': ['pdf'] },
            openLabel: 'PaperView로 열기',
          });
          if (!picked || picked.length === 0) return;
          targetPath = picked[0].fsPath;
        }
        const baseUrl = await ensureServerRunning(context);
        const { paperId, title } = await registerLocalPdf(baseUrl, targetPath);
        await openReaderWebview(context, paperId, title);
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message || String(err));
      }
    }),
    vscode.commands.registerCommand('paperview.openInBrowser', async () => {
      try {
        const baseUrl = await ensureServerRunning(context);
        await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message || String(err));
      }
    }),
    vscode.commands.registerCommand('paperview.stopServer', () => {
      if (serverProc) {
        serverProc.kill();
        serverProc = null;
        vscode.window.showInformationMessage('PaperView 로컬 서버를 중지했습니다.');
      } else {
        vscode.window.showInformationMessage('실행 중인 확장 관리 서버 프로세스가 없습니다.');
      }
    })
  );
}

export function deactivate() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}
