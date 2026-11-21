import {
  appendDemoChatTurn,
  clearDemoChatHistory,
  getDemoChatHistory,
  isDemoMode,
  resolveDemoAssetUrl,
} from './demoMode';
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

export function resolvePaperMediaUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  if (rawUrl.startsWith('demo-data/') || rawUrl.startsWith('./')) {
    return resolveDemoAssetUrl(rawUrl);
  }
  return `${getApiBase()}${rawUrl}`;
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
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
): Promise<{ engines: EngineInfo[]; catalog: AllModelsCatalog; selected_lang?: string }> {
  const res = await fetch(`${getApiBase()}/api/models?refresh=${refresh ? 'true' : 'false'}`);
  return handleJson<{ engines: EngineInfo[]; catalog: AllModelsCatalog; selected_lang?: string }>(res);
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
  default_lang?: string;
}): Promise<{ engines: EngineInfo[]; catalog: AllModelsCatalog; selected_lang?: string }> {
  const res = await fetch(`${getApiBase()}/api/settings/engines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson<{ engines: EngineInfo[]; catalog: AllModelsCatalog; selected_lang?: string }>(res);
}

export async function fetchPapersList(lang?: string): Promise<PaperSummaryItem[]> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(`${getApiBase()}/api/papers${qs}`);
  return handleJson<PaperSummaryItem[]>(res);
}

export async function fetchPaperBundle(paperId: string, lang?: string): Promise<LoadedPaperBundle> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}${qs}`);
  return handleJson<LoadedPaperBundle>(res);
}

export async function uploadPaperFile(file: File, lang?: string): Promise<LoadedPaperBundle> {
  const form = new FormData();
  form.append('file', file);
  if (lang) form.append('lang', lang);
  const res = await fetch(`${getApiBase()}/api/papers/upload`, {
    method: 'POST',
    body: form,
  });
  return handleJson<LoadedPaperBundle>(res);
}

export async function importPaperUrl(urlOrArxiv: string, lang?: string): Promise<LoadedPaperBundle> {
  const res = await fetch(`${getApiBase()}/api/papers/import-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url_or_arxiv: urlOrArxiv, lang }),
  });
  return handleJson<LoadedPaperBundle>(res);
}

export function getPaperPdfUrl(paperId: string): string {
  if (isDemoMode()) {
    return resolveDemoAssetUrl('demo-data/source.pdf');
  }
  return `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/pdf`;
}

export function getPaperStreamUrl(
  paperId: string,
  engine: string,
  force = false,
  lang?: string
): string {
  const qs = new URLSearchParams({
    engine,
    force: force ? 'true' : 'false',
  });
  if (lang) qs.set('lang', lang);
  return `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/stream?${qs.toString()}`;
}

export async function stopPaperStream(
  paperId: string,
  lang?: string
): Promise<{ paper: import('./types').PaperDocument }> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/stop-stream${qs}`,
    { method: 'POST' }
  );
  return handleJson<{ paper: import('./types').PaperDocument }>(res);
}

export async function generatePaperOverview(
  paperId: string,
  engine: string,
  force = false,
  lang?: string
): Promise<PaperOverview> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/overview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force, lang }),
    }
  );
  return handleJson<PaperOverview>(res);
}

export async function generateMediaInsight(
  paperId: string,
  sentenceId: string,
  engine: string,
  force = false,
  lang?: string
): Promise<{ sentence_id: string; insight: string; engine?: string; model_name?: string }> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/sentences/${encodeURIComponent(sentenceId)}/media-insight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force, lang }),
    }
  );
  return handleJson<{ sentence_id: string; insight: string; engine?: string; model_name?: string }>(
    res
  );
}

export async function ensurePaperMediaInsights(
  paperId: string,
  engine: string,
  force = false,
  lang?: string
): Promise<{ insights: Record<string, string>; engine?: string; model_name?: string }> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/media-insights/ensure`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force, lang }),
    }
  );
  return handleJson<{ insights: Record<string, string>; engine?: string; model_name?: string }>(
    res
  );
}

export async function analyzeSentence(
  paperId: string,
  sentenceId: string,
  engine: string,
  force = false,
  lang?: string
): Promise<SentenceAnalysis> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/sentences/${encodeURIComponent(sentenceId)}/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force, lang }),
    }
  );
  return handleJson<SentenceAnalysis>(res);
}

export async function analyzeBatchSentences(
  paperId: string,
  sentenceIds: string[],
  engine: string,
  lang?: string
): Promise<SentenceAnalysis[]> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/sentences/analyze-batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence_ids: sentenceIds, engine, lang }),
    }
  );
  return handleJson<SentenceAnalysis[]>(res);
}

export async function fetchCitationMetadata(
  paperId: string,
  refKey: string,
  lang?: string
): Promise<CitationMetadataResponse> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/citations/${encodeURIComponent(refKey)}${qs}`
  );
  return handleJson<CitationMetadataResponse>(res);
}

export async function summarizeCitation(
  paperId: string,
  refKey: string,
  engine: string,
  force = false,
  lang?: string
): Promise<CitationSummaryResponse> {
  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/citations/${encodeURIComponent(refKey)}/summarize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine, force, lang }),
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

export async function fetchPaperChatHistory(paperId: string, lang?: string): Promise<ChatMessage[]> {
  if (isDemoMode()) {
    return getDemoChatHistory(lang);
  }
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/chat${qs}`);
  const data = await handleJson<{ messages: ChatMessage[] }>(res);
  return data.messages;
}

export async function clearPaperChatHistory(paperId: string, lang?: string): Promise<void> {
  if (isDemoMode()) {
    clearDemoChatHistory(lang);
    return;
  }
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await fetch(`${getApiBase()}/api/papers/${encodeURIComponent(paperId)}/chat${qs}`, {
    method: 'DELETE',
  });
  await handleJson<{ messages: ChatMessage[] }>(res);
}

export async function streamPaperChatMessage(params: {
  paperId: string;
  message: string;
  contextSnippet?: string | null;
  engine: string;
  lang?: string;
  responseStyle?: 'concise' | 'detailed';
  signal?: AbortSignal;
  onUserSaved?: (userMsg: ChatMessage, assistantId: string) => void;
  onModel?: (engine: string, model: string) => void;
  onDelta: (delta: string) => void;
  onDone?: (assistantMsg: ChatMessage) => void;
}): Promise<void> {
  if (isDemoMode()) {
    const { userMsg, assistantMsg } = await appendDemoChatTurn(
      params.lang,
      params.message,
      params.contextSnippet
    );
    params.onUserSaved?.(userMsg, assistantMsg.id);
    params.onModel?.('gemini', 'Gemini 4 Carbon');
    params.onDelta(assistantMsg.content);
    params.onDone?.(assistantMsg);
    return;
  }

  const res = await fetch(
    `${getApiBase()}/api/papers/${encodeURIComponent(params.paperId)}/chat/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        context_snippet: params.contextSnippet || null,
        engine: params.engine,
        lang: params.lang,
        response_style: params.responseStyle || 'concise',
      }),
      signal: params.signal,
    }
  );

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Chat request failed (${res.status})`);
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
      throw new Error(payload.detail || 'Chat stream error');
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
  force = false,
  lang?: string
): Promise<QueueStateResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  form.append('engine', engine);
  form.append('force', force ? 'true' : 'false');
  if (lang) form.append('lang', lang);
  const res = await fetch(`${getApiBase()}/api/queue/upload`, {
    method: 'POST',
    body: form,
  });
  return handleJson<QueueStateResponse>(res);
}

export async function enqueueUrlsOrArxivs(
  urlsOrArxivs: string[],
  engine: string,
  force = false,
  lang?: string
): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls_or_arxivs: urlsOrArxivs, engine, force, lang }),
  });
  return handleJson<QueueStateResponse>(res);
}

export async function enqueuePaperIds(
  paperIds: string[],
  engine: string,
  force = false,
  lang?: string
): Promise<QueueStateResponse> {
  const res = await fetch(`${getApiBase()}/api/queue/papers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper_ids: paperIds, engine, force, lang }),
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
