from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class BBox(BaseModel):
    """Normalized bounding box (0.0 to 1.0 relative to page width/height)."""
    x0: float
    y0: float
    x1: float
    y1: float


class InlineCitation(BaseModel):
    """Clickable citation occurrence inside a sentence."""
    ref_key: str
    label: str
    start: int
    end: int


class SentenceItem(BaseModel):
    """Single AI-segmented English sentence (or Figure/Table item) with Korean translation & PDF coordinates."""
    id: str
    index: int
    kind: str = "sentence"  # "sentence" | "figure" | "table"
    page: int
    section: str
    text: str
    ko: str = ""
    insight: Optional[str] = None
    slash_en: Optional[str] = None
    media_id: Optional[str] = None
    media_label: Optional[str] = None
    image_url: Optional[str] = None
    bboxes: list[BBox] = Field(default_factory=list)
    citations: list[InlineCitation] = Field(default_factory=list)


class MediaAsset(BaseModel):
    """Extracted Figure or Table visual crop + caption metadata."""
    media_id: str
    kind: str  # "figure" | "table"
    label: str
    page: int
    caption: str
    image_filename: str
    bbox: BBox


class PdfLineRecord(BaseModel):
    """Extracted raw horizontal PDF line used to map AI sentences back to PDF bounding boxes."""
    page: int
    text: str
    norm_text: str
    bbox: BBox


class RawBodyChunk(BaseModel):
    """Manageable slice of paper body text (pre-References) fed sequentially into streaming AI."""
    chunk_index: int
    start_page: int
    end_page: int
    text: str


class ReferenceEntry(BaseModel):
    """Bibliography entry parsed from the paper's References section and enriched on demand."""
    ref_key: str
    raw_text: str
    title: Optional[str] = None
    authors: list[str] = Field(default_factory=list)
    year: Optional[int] = None
    venue: Optional[str] = None
    arxiv_id: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    abstract: Optional[str] = None
    enriched: bool = False
    arxiv_checked: bool = False


class SenseChunk(BaseModel):
    """Meaning-unit (sense group) slice of an English sentence with Korean gloss."""
    en: str
    ko: str
    role: Optional[str] = None


class KeyTerm(BaseModel):
    term: str
    meaning: str


class SentenceAnalysis(BaseModel):
    """Detailed on-demand AI sense-group breakdown for a single sentence."""
    sentence_id: str
    engine: str
    lang: str = "ko"
    chunks: list[SenseChunk] = Field(default_factory=list)
    natural_ko: str
    key_terms: list[KeyTerm] = Field(default_factory=list)


class CitingSentenceSnippet(BaseModel):
    sentence_id: str
    page: int
    section: str
    text: str


class CitationSummaryResponse(BaseModel):
    """Stage 2: On-demand AI summary of a cited paper."""
    ref_key: str
    engine: str
    lang: str = "ko"
    model_name: Optional[str] = None
    reasoning_effort: Optional[str] = None
    source_type: str
    source_label: str
    main_figure_url: Optional[str] = None
    main_figure_caption: Optional[str] = None
    tldr: str
    summary_points: list[str] = Field(default_factory=list)
    why_cited: str


class CitationMetadataResponse(BaseModel):
    """Stage 1: Lightweight metadata shown immediately when clicking a citation number."""
    ref_key: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: Optional[int] = None
    venue: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    arxiv_id: Optional[str] = None
    doi: Optional[str] = None
    has_fulltext: bool = False
    has_abstract: bool = False
    raw_reference: str
    citing_sentences: list[CitingSentenceSnippet] = Field(default_factory=list)
    cached_summary: Optional[CitationSummaryResponse] = None


class PaperSummaryItem(BaseModel):
    paper_id: str
    title: str
    filename: str
    page_count: int
    sentence_count: int
    reference_count: int
    ai_status: str = "completed"
    created_at: str


class PaperOverview(BaseModel):
    """High-level paper summary & core contributions displayed first at the top of ReaderPane."""
    tldr: str
    problem: str = ""
    method: str = ""
    contributions: list[str] = Field(default_factory=list)
    results: str = ""
    lang: str = "ko"
    engine: Optional[str] = None
    model_name: Optional[str] = None


class PaperDocument(BaseModel):
    paper_id: str
    title: str
    filename: str
    page_count: int
    format_version: int = 1
    lang: str = "ko"
    overview: Optional[PaperOverview] = None
    sections: list[str] = Field(default_factory=list)
    sentences: list[SentenceItem] = Field(default_factory=list)
    references: dict[str, ReferenceEntry] = Field(default_factory=dict)
    ai_status: str = "pending"  # "pending" | "streaming" | "completed" | "error"
    ai_progress: int = 0
    ai_total_chunks: int = 0
    ai_completed_chunks: int = 0
    ai_engine: Optional[str] = None
    ai_model: Optional[str] = None
    ai_error: Optional[str] = None
    created_at: str


class OpenLocalRequest(BaseModel):
    file_path: str
    lang: Optional[str] = None


class ImportUrlRequest(BaseModel):
    url_or_arxiv: str
    lang: Optional[str] = None


class AnalyzeSentenceRequest(BaseModel):
    engine: str = "auto"
    force: bool = False
    lang: Optional[str] = None


class AnalyzeBatchRequest(BaseModel):
    sentence_ids: list[str]
    engine: str = "auto"
    lang: Optional[str] = None


class SummarizeCitationRequest(BaseModel):
    engine: str = "auto"
    force: bool = False
    lang: Optional[str] = None


class GenerateOverviewRequest(BaseModel):
    engine: str = "auto"
    force: bool = False
    lang: Optional[str] = None


class MediaInsightResponse(BaseModel):
    sentence_id: str
    insight: str
    engine: Optional[str] = None
    model_name: Optional[str] = None


class EngineSettingsRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    claude_model_override: Optional[str] = None
    claude_effort: Optional[str] = None
    codex_model: Optional[str] = None
    codex_effort: Optional[str] = None
    antigravity_model: Optional[str] = None
    antigravity_thinking_level: Optional[str] = None
    default_lang: Optional[str] = None


class ChatMessage(BaseModel):
    id: str
    role: str  # "user" | "assistant"
    content: str
    context_snippet: Optional[str] = None
    engine: Optional[str] = None
    model_name: Optional[str] = None
    lang: str = "ko"
    created_at: str


class ChatStreamRequest(BaseModel):
    message: str
    context_snippet: Optional[str] = None
    engine: str = "auto"
    response_style: str = "concise"  # "concise" | "detailed"
    lang: Optional[str] = None


class UsageQuotaItem(BaseModel):
    key: str
    label: str
    used_percent: float
    remaining_percent: float
    resets_at: Optional[str] = None


class UsageStatusResponse(BaseModel):
    available: bool = False
    provider: str = "claude"
    subscription_type: Optional[str] = None
    email: Optional[str] = None
    auth_method: Optional[str] = None
    billing_mode: str = "subscription_oauth"
    quotas: list[UsageQuotaItem] = Field(default_factory=list)
    activity_lines: list[str] = Field(default_factory=list)
    local_session_requests: int = 0
    local_session_tokens: int = 0
    checked_at: str = ""
    error: Optional[str] = None


class QueueItem(BaseModel):
    id: str
    paper_id: str
    title: str
    filename: str
    engine: str = "claude"
    lang: str = "ko"
    force_retranslate: bool = False
    status: str = "queued"  # "queued" | "running" | "waiting_quota" | "completed" | "error" | "cancelled"
    progress: int = 0
    error: Optional[str] = None
    added_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class QueueStateResponse(BaseModel):
    paused: bool = False
    scheduled_start_at: Optional[str] = None
    scheduled_time_label: Optional[str] = None
    auto_retry_on_quota: bool = True
    is_worker_busy: bool = False
    items: list[QueueItem] = Field(default_factory=list)


class QueueAddUrlsRequest(BaseModel):
    urls_or_arxivs: list[str]
    engine: str = "claude"
    lang: Optional[str] = None
    force: bool = False


class QueueAddPapersRequest(BaseModel):
    paper_ids: list[str]
    engine: str = "claude"
    lang: Optional[str] = None
    force: bool = False


class QueueControlRequest(BaseModel):
    action: Optional[str] = None  # "pause" | "resume" | "start_now" | "clear_done"
    scheduled_time: Optional[str] = None  # "HH:MM" or "" to clear
    auto_retry_on_quota: Optional[bool] = None


class QueueMoveItemRequest(BaseModel):
    direction: str  # "up" | "down"
