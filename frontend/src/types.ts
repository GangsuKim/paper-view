export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface InlineCitation {
  ref_key: string;
  label: string;
  start: number;
  end: number;
}

export interface SentenceItem {
  id: string;
  index: number;
  kind?: 'sentence' | 'figure' | 'table' | string;
  page: number;
  section: string;
  text: string;
  ko: string;
  insight?: string | null;
  slash_en?: string | null;
  media_id?: string | null;
  media_label?: string | null;
  image_url?: string | null;
  bboxes: BBox[];
  citations: InlineCitation[];
}

export interface ReferenceEntry {
  ref_key: string;
  raw_text: string;
  title?: string | null;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  arxiv_id?: string | null;
  doi?: string | null;
  url?: string | null;
  pdf_url?: string | null;
  abstract?: string | null;
  enriched: boolean;
}

export interface SenseChunk {
  en: string;
  ko: string;
  role?: string | null;
}

export interface KeyTerm {
  term: string;
  meaning: string;
}

export interface SentenceAnalysis {
  sentence_id: string;
  engine: string;
  chunks: SenseChunk[];
  natural_ko: string;
  key_terms: KeyTerm[];
}

export interface CitingSentenceSnippet {
  sentence_id: string;
  page: number;
  section: string;
  text: string;
}

export interface CitationSummaryResponse {
  ref_key: string;
  engine: string;
  model_name?: string | null;
  reasoning_effort?: string | null;
  source_type: string;
  source_label: string;
  main_figure_url?: string | null;
  main_figure_caption?: string | null;
  tldr: string;
  summary_points: string[];
  why_cited: string;
}

export interface CitationMetadataResponse {
  ref_key: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  url?: string | null;
  pdf_url?: string | null;
  arxiv_id?: string | null;
  doi?: string | null;
  has_fulltext: boolean;
  has_abstract: boolean;
  raw_reference: string;
  citing_sentences: CitingSentenceSnippet[];
  cached_summary?: CitationSummaryResponse | null;
}

export interface PaperSummaryItem {
  paper_id: string;
  title: string;
  filename: string;
  page_count: number;
  sentence_count: number;
  reference_count: number;
  ai_status?: string;
  created_at: string;
}

export interface PaperResourceLink {
  kind: 'code' | 'huggingface' | 'dataset' | 'project' | string;
  label: string;
  url: string;
  source?: string;
}

export interface PaperOverview {
  tldr: string;
  problem: string;
  method: string;
  contributions: string[];
  results: string;
  lang?: string;
  engine?: string | null;
  model_name?: string | null;
}

export interface PaperDocument {
  paper_id: string;
  title: string;
  filename: string;
  page_count: number;
  lang?: string;
  arxiv_id?: string | null;
  resource_links?: PaperResourceLink[];
  resource_links_checked?: boolean;
  overview?: PaperOverview | null;
  sections: string[];
  sentences: SentenceItem[];
  references: Record<string, ReferenceEntry>;
  ai_status: 'pending' | 'streaming' | 'paused' | 'completed' | 'error' | string;
  ai_progress: number;
  ai_total_chunks: number;
  ai_completed_chunks: number;
  ai_engine?: string | null;
  ai_model?: string | null;
  ai_error?: string | null;
  created_at: string;
}

export interface LoadedPaperBundle {
  paper: PaperDocument;
  analyses: Record<string, SentenceAnalysis>;
  citation_summaries: Record<string, CitationSummaryResponse>;
}

export interface EngineInfo {
  id: 'claude' | 'codex' | 'antigravity' | string;
  name: string;
  available: boolean;
  needs_key?: boolean;
  active_model?: string;
  detected_model?: string;
  configured_model?: string;
  model_override?: string;
  reasoning_effort?: string;
  detail: string;
}

export interface ModelOptionItem {
  id: string;
  label: string;
  group: string;
}

export interface EffortOptionItem {
  id: string;
  label: string;
  desc: string;
}

export interface ProviderModelsCatalog {
  models: ModelOptionItem[];
  efforts: EffortOptionItem[];
  selected_model: string;
  effective_model?: string;
  detected_model?: string;
  configured_model?: string;
  selected_effort: string;
}

export interface AllModelsCatalog {
  claude: ProviderModelsCatalog;
  codex: ProviderModelsCatalog;
  antigravity: ProviderModelsCatalog;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  context_snippet?: string | null;
  engine?: string | null;
  model_name?: string | null;
  created_at: string;
}

export interface UsageQuotaItem {
  key: string;
  label: string;
  used_percent: number;
  remaining_percent: number;
  resets_at?: string | null;
}

export interface UsageStatusResponse {
  available: boolean;
  provider: string;
  subscription_type?: string | null;
  email?: string | null;
  auth_method?: string | null;
  billing_mode: string;
  quotas: UsageQuotaItem[];
  activity_lines: string[];
  local_session_requests: number;
  local_session_tokens: number;
  checked_at: string;
  error?: string | null;
}

export interface QueueItem {
  id: string;
  paper_id: string;
  title: string;
  filename: string;
  engine: string;
  lang?: string;
  force_retranslate: boolean;
  status: 'queued' | 'running' | 'waiting_quota' | 'completed' | 'error' | 'cancelled' | string;
  progress: number;
  error?: string | null;
  added_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface QueueStateResponse {
  paused: boolean;
  scheduled_start_at?: string | null;
  scheduled_time_label?: string | null;
  auto_retry_on_quota: boolean;
  is_worker_busy: boolean;
  items: QueueItem[];
}
