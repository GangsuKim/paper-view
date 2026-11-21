import { detectInitialLang, normalizeUiLangCode, type LangCode } from './i18n';
import type {
  ChatMessage,
  CitationMetadataResponse,
  CitationSummaryResponse,
  CitingSentenceSnippet,
  DemoLanguageBundle,
  PaperDocument,
} from './types';

export const PAPER_VIEW_GITHUB_URL = 'https://github.com/GangsuKim/paper-view';

const demoBundleCache = new Map<LangCode, DemoLanguageBundle>();
const demoBundlePending = new Map<LangCode, Promise<DemoLanguageBundle>>();
const demoChatStore = new Map<LangCode, ChatMessage[]>();

/**
 * Returns true when built as the static GitHub Pages demo (`VITE_DEMO_MODE === 'true'`)
 * or when `?demo=1` is present in the URL query string.
 */
export function isDemoMode(): boolean {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return true;
  }
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo') === '1') {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Normalize Vite's `BASE_URL` so `./demo-data/...` resolves cleanly at any subpath
 * (e.g. `https://gangsukim.github.io/paper-view/`, `http://127.0.0.1:8787/demo/`, or `/?demo=1`).
 */
export function getDemoBasePrefix(): string {
  const rawBase = import.meta.env.BASE_URL || './';
  if (rawBase === './' || rawBase === '.' || rawBase === '/') {
    return './';
  }
  return rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
}

export function resolveDemoAssetUrl(relativePath: string): string {
  if (/^https?:\/\//i.test(relativePath)) {
    return relativePath;
  }
  const clean = relativePath.replace(/^\.\//, '').replace(/^\//, '');
  return `${getDemoBasePrefix()}${clean}`;
}

/**
 * Detect initial language in Demo Mode:
 * 1) `?lang=` query parameter
 * 2) `detectInitialLang('en')` (saved preference -> browser language -> `'en'` fallback)
 */
export function detectInitialDemoLang(): LangCode {
  if (typeof window !== 'undefined') {
    try {
      const qLang = normalizeUiLangCode(new URLSearchParams(window.location.search).get('lang'));
      if (qLang) {
        return qLang;
      }
    } catch {
      // ignore
    }
  }
  return detectInitialLang('en');
}

export async function fetchDemoLanguageBundle(lang: LangCode): Promise<DemoLanguageBundle> {
  const code = normalizeUiLangCode(lang) || 'en';
  const cached = demoBundleCache.get(code);
  if (cached) {
    return cached;
  }
  const inflight = demoBundlePending.get(code);
  if (inflight) {
    return inflight;
  }

  const req = (async () => {
    const url = resolveDemoAssetUrl(`demo-data/lang/${code}.json`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load demo bundle (${code}): HTTP ${res.status}`);
    }
    const data = (await res.json()) as DemoLanguageBundle;
    demoBundleCache.set(code, data);
    if (!demoChatStore.has(code)) {
      demoChatStore.set(code, [...(data.chat_messages || [])]);
    }
    return data;
  })();

  demoBundlePending.set(code, req);
  try {
    return await req;
  } finally {
    demoBundlePending.delete(code);
  }
}

/**
 * Compute CitationMetadataResponse client-side in 0ms from the loaded demo paper & summaries.
 */
export function buildDemoCitationMetadata(
  paper: PaperDocument,
  citationSummaries: Record<string, CitationSummaryResponse>,
  refKey: string
): CitationMetadataResponse {
  const entry = paper.references?.[refKey];
  const citingSentences: CitingSentenceSnippet[] = [];

  for (const sent of paper.sentences || []) {
    if (sent.citations?.some((c) => c.ref_key === refKey)) {
      citingSentences.push({
        sentence_id: sent.id,
        page: sent.page,
        section: sent.section,
        text: sent.text,
      });
      if (citingSentences.length >= 6) {
        break;
      }
    }
  }

  const arxivId = entry?.arxiv_id || null;
  const cleanArxiv = arxivId ? arxivId.replace(/v\d+$/i, '') : null;
  const url = entry?.url || (cleanArxiv ? `https://arxiv.org/abs/${cleanArxiv}` : null);
  const pdfUrl = entry?.pdf_url || (cleanArxiv ? `https://arxiv.org/pdf/${cleanArxiv}.pdf` : null);

  return {
    ref_key: refKey,
    title: entry?.title || entry?.raw_text?.slice(0, 120) || `Reference [${refKey}]`,
    authors: entry?.authors || [],
    year: entry?.year ?? null,
    venue: entry?.venue ?? null,
    url,
    pdf_url: pdfUrl,
    arxiv_id: arxivId,
    doi: entry?.doi ?? null,
    has_fulltext: Boolean(arxivId || pdfUrl),
    has_abstract: Boolean(entry?.abstract),
    raw_reference: entry?.raw_text || `Reference [${refKey}]`,
    citing_sentences: citingSentences,
    cached_summary: citationSummaries?.[refKey] || null,
  };
}

const DEMO_STATIC_CHAT_REPLIES: Record<LangCode, string> = {
  en: `This interactive web demo runs 100% statically in your browser to showcase pre-generated **Gemini 4 Carbon** translations, figure/table core claims, and all 40 cited-paper summaries.\n\nTo run **live paper-grounded Q&A** on any PDF or arXiv paper locally with **$0 extra API cost** (powered by your existing Claude / Codex CLI subscription or Antigravity), clone and launch PaperView on your machine:\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  ko: `현재 보고 계신 웹 데모는 서버 없이 브라우저에서 100% 정적으로 동작하며, **Gemini 4 Carbon**으로 사전 생성된 8개 언어 학술 번역·그림/표 핵심 해설·40개 참고문헌 요약을 체험하실 수 있도록 구성되어 있습니다.\n\n원하는 임의의 PDF 논문이나 arXiv 논문에 대해 **추가 API 과금($0) 없이 실시간 논문 Q&A 채팅**을 사용하시려면 로컬 PC에서 PaperView를 실행해 보세요:\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  ja: `このインタラクティブWebデモはサーバー不要でブラウザ上のみで動作し、**Gemini 4 Carbon** によって事前生成された8言語の翻訳・図表の核心解説・全40件の引用論文要約を体験できる静的ショーケースです。\n\n任意のPDF論文や arXiv 論文に対して **追加API費用 $0** でライブ Q&A を実行するには、ローカル環境で PaperView を起動してください：\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  'zh-CN': `当前网页演示为 100% 纯前端静态页面，旨在展示由 **Gemini 4 Carbon** 预生成的 8 语言全文精译、图表核心主张解析以及全部 40 篇引文总结。\n\n若需对任意本地 PDF 或 arXiv 论文进行 **实时交互问答（$0 额外 API 费用）**，欢迎在本地克隆并运行 PaperView：\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  'zh-TW': `目前的網頁展示為 100% 純前端靜態頁面，旨在展示由 **Gemini 4 Carbon** 預先產生的 8 種語言全文精譯、圖表核心主張解析以及全部 40 篇引文摘要。\n\n若需對任意本機 PDF 或 arXiv 論文進行 **即時互動問答（$0 額外 API 費用）**，歡迎在本機複製並執行 PaperView：\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  es: `Esta demostración web interactiva funciona de forma 100 % estática en tu navegador para mostrar las traducciones académicas, ideas clave de figuras/tablas y los 40 resúmenes de citas pregenerados con **Gemini 4 Carbon**.\n\nPara usar **preguntas y respuestas en vivo** sobre cualquier PDF o artículo de arXiv localmente con **$0 de costo adicional de API**, instala y ejecuta PaperView en tu equipo:\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  de: `Diese interaktive Web-Demo läuft zu 100 % statisch im Browser und präsentiert vorab mit **Gemini 4 Carbon** erstellte Übersetzungen, Kernaussagen zu Abbildungen/Tabellen sowie alle 40 Zitatzusammenfassungen.\n\nUm **Live-Q&A** für beliebige PDF- oder arXiv-Paper lokal ohne zusätzliche API-Kosten (**$0 Extra-API-Gebühren**) zu nutzen, starten Sie PaperView lokal:\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
  fr: `Cette démonstration web interactive fonctionne de manière 100 % statique dans votre navigateur pour présenter les traductions scientifiques, les arguments clés des figures/tableaux et les 40 résumés de références pré-générés par **Gemini 4 Carbon**.\n\nPour poser des **questions-réponses en direct** sur n'importe quel PDF ou article arXiv en local avec **0 $ de frais d'API supplémentaires**, lancez PaperView sur votre machine :\n\n- GitHub: [github.com/GangsuKim/paper-view](${PAPER_VIEW_GITHUB_URL})`,
};

export const DEMO_RESTORE_CHAT_LABEL: Record<LangCode, string> = {
  en: 'Restore curated Gemini 4 Carbon Q&A examples',
  ko: 'Gemini 4 Carbon 추천 Q&A 예시 다시 보기',
  ja: 'Gemini 4 Carbon 厳選 Q&A 例を復元',
  'zh-CN': '恢复 Gemini 4 Carbon 精选问答示例',
  'zh-TW': '恢復 Gemini 4 Carbon 精選問答範例',
  es: 'Restaurar ejemplos de Q&A de Gemini 4 Carbon',
  de: 'Kuratierte Gemini 4 Carbon Q&A-Beispiele wiederherstellen',
  fr: 'Restaurer les exemples Q&R Gemini 4 Carbon',
};

export async function getDemoChatHistory(rawLang?: string): Promise<ChatMessage[]> {
  const code = normalizeUiLangCode(rawLang) || 'en';
  if (!demoChatStore.has(code)) {
    const bundle = await fetchDemoLanguageBundle(code);
    demoChatStore.set(code, [...(bundle.chat_messages || [])]);
  }
  return [...(demoChatStore.get(code) || [])];
}

export function clearDemoChatHistory(rawLang?: string): void {
  const code = normalizeUiLangCode(rawLang) || 'en';
  demoChatStore.set(code, []);
}

export async function restoreDemoChatExamples(rawLang?: string): Promise<ChatMessage[]> {
  const code = normalizeUiLangCode(rawLang) || 'en';
  const bundle = await fetchDemoLanguageBundle(code);
  const fresh = [...(bundle.chat_messages || [])];
  demoChatStore.set(code, fresh);
  return [...fresh];
}

export async function appendDemoChatTurn(
  rawLang: string | undefined,
  question: string,
  contextSnippet?: string | null
): Promise<{ userMsg: ChatMessage; assistantMsg: ChatMessage }> {
  const code = normalizeUiLangCode(rawLang) || 'en';
  const current = await getDemoChatHistory(code);
  const now = new Date().toISOString();
  const userMsg: ChatMessage = {
    id: `demo_u_${Date.now()}`,
    role: 'user',
    content: question.trim(),
    context_snippet: contextSnippet || null,
    created_at: now,
  };
  const assistantMsg: ChatMessage = {
    id: `demo_a_${Date.now() + 1}`,
    role: 'assistant',
    content: DEMO_STATIC_CHAT_REPLIES[code] || DEMO_STATIC_CHAT_REPLIES.en,
    engine: 'gemini',
    model_name: 'Gemini 4 Carbon',
    created_at: now,
  };
  demoChatStore.set(code, [...current, userMsg, assistantMsg]);
  return { userMsg, assistantMsg };
}
