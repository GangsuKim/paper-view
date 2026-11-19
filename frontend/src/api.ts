import type {
  AllModelsCatalog,
  ChatMessage,
  CitationMetadataResponse,
  CitationSummaryResponse,
  EngineInfo,
  LoadedPaperBundle,
  PaperOverview,
  PaperSummaryItem,
  QueueStateResponse,
  SentenceAnalysis,
  UsageStatusResponse,
} from './types';

declare global {
  interface Window {
    __PAPERVIEW_API_BASE__?: string;
  }
}

export function getApiBase(): string {
  if (window.__PAPERVIEW_API_BASE__) {
    return window.__PAPERVIEW_API_BASE__.replace(/\/$/, '');
  }
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('apiBase');
  if (fromQuery) {
    return fromQuery.replace(/\/$/, '');
  }
  return '';
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `요청 실패 (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) {
        msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function fetchEngines(): Promise<EngineInfo[]> {
  const res = await fetch(`${getApiBase()}/api/engines`);
  const data = await handleJson<{ engines: EngineInfo[] }>(res);
  return data.engines;
}

export async function fetchModelsCatalog(
  refresh = false
): Promise<{ engines: EngineInfo[]; catalog: AllModelsCatalog }> {
  const res = await fetch(`${getApiBase()}/api/models?refresh=${refresh ? 'true' : 'false'}`);
  return handleJson<{ engines: EngineInfo[]; catalog: AllModelsCatalog }>(res);
}

export async function fetchUsageStatus(refresh = false): Promise<UsageStatusResponse> {
  const res = await fetch(`${getApiBase()}/api/usage?refresh=${refresh ? 'true' : 'false'}`);
  return handleJson<UsageStatusResponse>(res);
}

export async function updateEngineSettings(payload: {
  gemini_api_key?: string;
  claude_model_override?: string;
  claude_effort?: string;
  codex_model?: string;
  codex_effort?: string;
  antigravity_model?: string;
  antigravity_thinking_level?: string;
}): Promise<{ engines: EngineInfo[]; catalog: AllModelsCatalog }> {
  const res = await fetch(`${getApiBase()}/api/settings/engines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson<{ engines: EngineInfo[]; catalog: AllModelsCatalog }>(res);
}

export async function fetchPapersList(): Promise<PaperSummaryItem[]> {
  const res = await fetch(`${getApiBase()}/api/papers`);
  return handleJson<PaperSummaryItem[]>(res);
}

export async function fetchPaperBundle(paperId: string): Promise<LoadedPaperBundle> {
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}`);
  return handleJson<LoadedPaperBundle>(res);
}

export async function uploadPaperFile(file: File): Promise<LoadedPaperBundle> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${getApiBase()}/api/papers/upload`, {
    method: 'POST',
    body: form,
  });
  return handleJson<LoadedPaperBundle>(res);
}

export async function importPaperUrl(urlOrArxiv: string): Promise<LoadedPaperBundle> {
  const res = await fetch(`${getApiBase()}/api/papers/import-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url_or_arxiv: urlOrArxiv }),
  });
  return handleJson<LoadedPaperBundle>(res);
}

export function getPaperPdfUrl(paperId: string): string {
  return `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/pdf`;
}

export function getPaperStreamUrl(paperId: string, engine: string, force = false): string {
  const qs = new URLSearchParams({
    engine,
    force: force ? 'true' : 'false',
  });
  return `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/stream?${qs.toString()}`;
}

export async function stopPaperStream(paperId: string): Promise<{ paper: import('./types').PaperDocument }> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/stop-stream`,
    { method: 'POST' }
  );
  return handleJson<{ paper: import('./types').PaperDocument }>(res);
}

export async function generatePaperOverview(
  paperId: string,
  engine: string,
  force = false
): Promise<PaperOverview> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/overview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force }),
    }
  );
  return handleJson<PaperOverview>(res);
}

export async function analyzeSentence(
  paperId: string,
  sentenceId: string,
  engine: string,
  force = false
): Promise<SentenceAnalysis> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/sentences/${encodeURIComponent(sentenceId)}/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force }),
    }
  );
  return handleJson<SentenceAnalysis>(res);
}

export async function analyzeBatchSentences(
  paperId: string,
  sentenceIds: string[],
  engine: string
): Promise<SentenceAnalysis[]> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/sentences/analyze-batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence_ids: sentenceIds, engine }),
    }
  );
  return handleJson<SentenceAnalysis[]>(res);
}

export async function fetchCitationMetadata(
  paperId: string,
  refKey: string
): Promise<CitationMetadataResponse> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/citations/${encodeURIComponent(refKey)}`
  );
  return handleJson<CitationMetadataResponse>(res);
}

export async function summarizeCitation(
  paperId: string,
  refKey: string,
  engine: string,
  force = false
): Promise<CitationSummaryResponse> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/citations/${encodeURIComponent(refKey)}/summarize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force }),
    }
  );
  return handleJson<CitationSummaryResponse>(res);
}

export function openExternalUrl(url: string): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'paperview:openExternal', url }, '*');
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function fetchPaperChatHistory(paperId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/chat`);
  const data = await handleJson<{ messages: ChatMessage[] }>(res);
  return data.messages;
}

export async function clearPaperChatHistory(paperId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/chat`, {
    method: 'DELETE',
  });
  await handleJson<{ messages: ChatMessage[] }>(res);
}

export async function streamPaperChatMessage(params: {
  paperId: string;
  message: string;
  contextSnippet?: string | null;
  engine: string;
  responseStyle?: 'concise' | 'detailed';
  signal?: AbortSignal;
  onUserSaved?: (userMsg: ChatMessage, assistantId: string) => void;
  onModel?: (engine: string, model: string) => void;
  onDelta: (delta: string) => void;
  onDone?: (assistantMsg: ChatMessage) => void;
}): Promise<void> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(params.paperId)}/chat/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        context_snippet: params.contextSnippet || null,
        engine: params.engine,
        response_style: params.responseStyle || 'concise',
      }),
      signal: params.signal,
    }
  );

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `채팅 요청 실패 (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const processBlock = (block: string) => {
    const lines = block.split('\n');
    let eventName = '';
    let dataStr = '';
    for (const ln of lines) {
      if (ln.startsWith('event:')) {
        eventName = ln.slice(6).trim();
      } else if (ln.startsWith('data:')) {
        dataStr += ln.slice(5).trim();
      }
    }
    if (!eventName || !dataStr) return;
    const payload = JSON.parse(dataStr);
    if (eventName === 'user_saved' && params.onUserSaved) {
      params.onUserSaved(payload.user_message, payload.assistant_id);
    } else if (eventName === 'model' && params.onModel) {
      params.onModel(payload.engine, payload.model);
    } else if (eventName === 'delta' && payload.text) {
      params.onDelta(String(payload.text));
    } else if (eventName === 'done' && params.onDone) {
      params.onDone(payload.assistant_message);
    } else if (eventName === 'error') {
      throw new Error(payload.detail || '채팅 스트리밍 오류');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIdx).trim();
      buffer = buffer.slice(sepIdx + 2);
      if (block) processBlock(block);
    }
  }
  if (buffer.trim()) {
    processBlock(buffer.trim());
  }
}

export async function fetchQueueState(): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue`);
  return handleJson<QueueStateResponse>(res);
}

export async function enqueuePdfFiles(
  files: File[],
  engine: string,
  force = false
): Promise<QueueStateResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  form.append('engine', engine);
  form.append('force', force ? 'true' : 'false');
  const res = await fetch(`${getApiBase()}/api/queue/upload`, {
    method: 'POST',
    body: form,
  });
  return handleJson<QueueStateResponse>(res);
}

export async function enqueueUrlsOrArxivs(
  urlsOrArxivs: string[],
  engine: string,
  force = false
): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls_or_arxivs: urlsOrArxivs, engine, force }),
  });
  return handleJson<QueueStateResponse>(res);
}

export async function enqueuePaperIds(
  paperIds: string[],
  engine: string,
  force = false
): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue/papers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds, engine, force }),
  });
  return handleJson<QueueStateResponse>(res);
}

export async function controlTranslationQueue(payload: {
  action?: 'pause' | 'resume' | 'start_now' | 'clear_done';
  scheduled_time?: string;
  auto_retry_on_quota?: boolean;
}): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson<QueueStateResponse>(res);
}

export async function removeQueueItem(itemId: string): Promise<QueueStateResponse> {
  const res = await fetch(
    `${getApiBase()}/api/queue/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' }
  );
  return handleJson<QueueStateResponse>(res);
}

export async function moveQueueItem(
  itemId: string,
  direction: 'up' | 'down'
): Promise<QueueStateResponse> {
  const res = await fetch(
    `${getApiBase()}/api/queue/items/${encodeURIComponent(itemId)}/move`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    }
  );
  return handleJson<QueueStateResponse>(res);
}

export async function retryQueueItem(itemId: string): Promise<QueueStateResponse> {
  const res = await fetch(
    `${getApiBase()}/api/queue/items/${encodeURIComponent(itemId)}/retry`,
    { method: 'POST' }
  );
  return handleJson<QueueStateResponse>(res);
}
