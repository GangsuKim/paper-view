from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Optional

from .lang_profiles import normalize_lang_code
from .models import (
    ChatMessage,
    CitationSummaryResponse,
    MediaAsset,
    PaperDocument,
    PaperSummaryItem,
    PdfLineRecord,
    RawBodyChunk,
    SentenceAnalysis,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / ".paperview_data"
PAPERS_DIR = DATA_DIR / "papers"
DOWNLOAD_CACHE_DIR = DATA_DIR / "cited_cache"


def ensure_dirs() -> None:
    PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def compute_paper_id(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()[:16]


def paper_dir(paper_id: str) -> Path:
    ensure_dirs()
    safe_id = "".join(c for c in paper_id if c.isalnum() or c in ("-", "_"))
    d = PAPERS_DIR / safe_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def media_dir(paper_id: str) -> Path:
    md = paper_dir(paper_id) / "media"
    md.mkdir(parents=True, exist_ok=True)
    return md


def _doc_filename(lang: Optional[str]) -> str:
    code = normalize_lang_code(lang)
    return "document.json" if code == "ko" else f"document_{code}.json"


def _cit_filename(lang: Optional[str]) -> str:
    code = normalize_lang_code(lang)
    return "citation_summaries.json" if code == "ko" else f"citation_summaries_{code}.json"


def _ana_filename(lang: Optional[str]) -> str:
    code = normalize_lang_code(lang)
    return "sentence_analyses.json" if code == "ko" else f"sentence_analyses_{code}.json"


def _chat_filename(lang: Optional[str]) -> str:
    code = normalize_lang_code(lang)
    return "chat_history.json" if code == "ko" else f"chat_history_{code}.json"


def save_paper(
    pdf_bytes: bytes,
    doc: PaperDocument,
    pdf_lines: Optional[list[PdfLineRecord]] = None,
    raw_chunks: Optional[list[RawBodyChunk]] = None,
    media_assets: Optional[list[MediaAsset]] = None,
) -> None:
    d = paper_dir(doc.paper_id)
    pdf_path = d / "source.pdf"
    if not pdf_path.exists():
        pdf_path.write_bytes(pdf_bytes)

    code = normalize_lang_code(doc.lang)
    doc.lang = code
    target_doc_path = d / _doc_filename(code)
    target_doc_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")

    # Always ensure base document.json exists as the canonical metadata anchor
    base_doc_path = d / "document.json"
    if code != "ko" and not base_doc_path.exists():
        base_clone = doc.model_copy(
            update={
                "lang": "ko",
                "overview": None,
                "sections": [],
                "sentences": [],
                "ai_status": "pending",
                "ai_progress": 0,
                "ai_completed_chunks": 0,
            }
        )
        base_doc_path.write_text(base_clone.model_dump_json(indent=2), encoding="utf-8")

    if pdf_lines is not None:
        (d / "pdf_lines.json").write_text(
            json.dumps([l.model_dump() for l in pdf_lines], ensure_ascii=False),
            encoding="utf-8",
        )
    if raw_chunks is not None:
        (d / "raw_chunks.json").write_text(
            json.dumps([c.model_dump() for c in raw_chunks], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if media_assets is not None:
        (d / "media_manifest.json").write_text(
            json.dumps([m.model_dump() for m in media_assets], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def load_media_manifest(paper_id: str) -> dict[str, MediaAsset]:
    d = paper_dir(paper_id)
    p = d / "media_manifest.json"
    if not p.exists():
        return {}
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return {x["media_id"]: MediaAsset.model_validate(x) for x in arr}
    except Exception:
        return {}


def get_media_file_path(paper_id: str, filename: str) -> Optional[Path]:
    safe_name = Path(filename).name
    if not safe_name.endswith(".png"):
        return None
    target = media_dir(paper_id) / safe_name
    return target if target.exists() else None


def get_cited_media_file_path(filename: str) -> Optional[Path]:
    ensure_dirs()
    safe_name = Path(filename).name
    if not safe_name.endswith(".png"):
        return None
    target = DOWNLOAD_CACHE_DIR / safe_name
    return target if target.exists() else None


def update_paper_doc(doc: PaperDocument, lang: Optional[str] = None) -> None:
    code = normalize_lang_code(lang or doc.lang)
    doc.lang = code
    d = paper_dir(doc.paper_id)
    doc_path = d / _doc_filename(code)
    doc_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")

    # Sync enriched bibliography entries and refined title back to base document.json
    if code != "ko":
        base_path = d / "document.json"
        if base_path.exists():
            try:
                base_doc = PaperDocument.model_validate_json(base_path.read_text(encoding="utf-8"))
                changed = False
                if doc.title and not doc.title.endswith(".pdf") and base_doc.title.endswith(".pdf"):
                    base_doc.title = doc.title
                    changed = True
                if doc.arxiv_id and not base_doc.arxiv_id:
                    base_doc.arxiv_id = doc.arxiv_id
                    changed = True
                if doc.resource_links and len(doc.resource_links) > len(base_doc.resource_links):
                    base_doc.resource_links = doc.resource_links
                    changed = True
                if doc.resource_links_checked and not base_doc.resource_links_checked:
                    base_doc.resource_links_checked = True
                    changed = True
                for rk, ref in doc.references.items():
                    if ref.enriched and (rk not in base_doc.references or not base_doc.references[rk].enriched):
                        base_doc.references[rk] = ref
                        changed = True
                if changed:
                    base_path.write_text(base_doc.model_dump_json(indent=2), encoding="utf-8")
            except Exception:
                pass


def load_paper_doc(paper_id: str, lang: Optional[str] = None) -> Optional[PaperDocument]:
    ensure_dirs()
    safe_id = "".join(c for c in paper_id if c.isalnum() or c in ("-", "_"))
    p_dir = PAPERS_DIR / safe_id
    if not p_dir.exists():
        return None

    code = normalize_lang_code(lang)
    target_path = p_dir / _doc_filename(code)
    base_path = p_dir / "document.json"

    if target_path.exists():
        doc = PaperDocument.model_validate_json(target_path.read_text(encoding="utf-8"))
        doc.lang = code
        # Pull in any enriched references from base document.json if needed
        if code != "ko" and base_path.exists():
            try:
                base_doc = PaperDocument.model_validate_json(base_path.read_text(encoding="utf-8"))
                if base_doc.arxiv_id and not doc.arxiv_id:
                    doc.arxiv_id = base_doc.arxiv_id
                if base_doc.resource_links and not doc.resource_links:
                    doc.resource_links = base_doc.resource_links
                if base_doc.resource_links_checked and not doc.resource_links_checked:
                    doc.resource_links_checked = True
                for rk, bref in base_doc.references.items():
                    if bref.enriched and (rk not in doc.references or not doc.references[rk].enriched):
                        doc.references[rk] = bref
            except Exception:
                pass
        return doc

    if code != "ko" and base_path.exists():
        base_doc = PaperDocument.model_validate_json(base_path.read_text(encoding="utf-8"))
        chunks_cnt = len(load_raw_chunks(paper_id))
        cloned = PaperDocument(
            paper_id=base_doc.paper_id,
            title=base_doc.title,
            filename=base_doc.filename,
            page_count=base_doc.page_count,
            format_version=base_doc.format_version,
            lang=code,
            arxiv_id=base_doc.arxiv_id,
            resource_links=base_doc.resource_links,
            resource_links_checked=base_doc.resource_links_checked,
            overview=None,
            sections=[],
            sentences=[],
            references=base_doc.references,
            ai_status="pending",
            ai_progress=0,
            ai_total_chunks=chunks_cnt or base_doc.ai_total_chunks,
            ai_completed_chunks=0,
            created_at=base_doc.created_at,
        )
        target_path.write_text(cloned.model_dump_json(indent=2), encoding="utf-8")
        return cloned

    return None


def load_pdf_lines(paper_id: str) -> list[PdfLineRecord]:
    d = paper_dir(paper_id)
    p = d / "pdf_lines.json"
    if not p.exists():
        return []
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return [PdfLineRecord.model_validate(x) for x in arr]
    except Exception:
        return []


def load_raw_chunks(paper_id: str) -> list[RawBodyChunk]:
    d = paper_dir(paper_id)
    p = d / "raw_chunks.json"
    if not p.exists():
        return []
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return [RawBodyChunk.model_validate(x) for x in arr]
    except Exception:
        return []


def get_pdf_path(paper_id: str) -> Optional[Path]:
    ensure_dirs()
    safe_id = "".join(c for c in paper_id if c.isalnum() or c in ("-", "_"))
    pdf_path = PAPERS_DIR / safe_id / "source.pdf"
    return pdf_path if pdf_path.exists() else None


def list_papers(lang: Optional[str] = None) -> list[PaperSummaryItem]:
    ensure_dirs()
    code = normalize_lang_code(lang)
    items: list[PaperSummaryItem] = []
    for d in PAPERS_DIR.iterdir():
        if not d.is_dir():
            continue
        lang_path = d / _doc_filename(code)
        base_path = d / "document.json"
        chosen_path = lang_path if lang_path.exists() else base_path
        if not chosen_path.exists():
            continue
        try:
            doc = PaperDocument.model_validate_json(chosen_path.read_text(encoding="utf-8"))
            items.append(
                PaperSummaryItem(
                    paper_id=doc.paper_id,
                    title=doc.title,
                    filename=doc.filename,
                    page_count=doc.page_count,
                    sentence_count=len(doc.sentences),
                    reference_count=len(doc.references),
                    ai_status=doc.ai_status if chosen_path == lang_path else "pending",
                    created_at=doc.created_at,
                )
            )
        except Exception:
            continue
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def load_sentence_analyses(paper_id: str, lang: Optional[str] = None) -> dict[str, SentenceAnalysis]:
    d = paper_dir(paper_id)
    p = d / _ana_filename(lang)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k: SentenceAnalysis.model_validate(v) for k, v in data.items()}
    except Exception:
        return {}


def save_sentence_analysis(
    paper_id: str,
    analysis: SentenceAnalysis,
    lang: Optional[str] = None,
) -> None:
    code = normalize_lang_code(lang or analysis.lang)
    analysis.lang = code
    all_items = load_sentence_analyses(paper_id, lang=code)
    all_items[analysis.sentence_id] = analysis
    d = paper_dir(paper_id)
    p = d / _ana_filename(code)
    p.write_text(
        json.dumps(
            {k: v.model_dump() for k, v in all_items.items()},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_citation_summaries(
    paper_id: str,
    lang: Optional[str] = None,
) -> dict[str, CitationSummaryResponse]:
    d = paper_dir(paper_id)
    p = d / _cit_filename(lang)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k: CitationSummaryResponse.model_validate(v) for k, v in data.items()}
    except Exception:
        return {}


def save_citation_summary(
    paper_id: str,
    summary: CitationSummaryResponse,
    lang: Optional[str] = None,
) -> None:
    code = normalize_lang_code(lang or summary.lang)
    summary.lang = code
    all_items = load_citation_summaries(paper_id, lang=code)
    all_items[summary.ref_key] = summary
    d = paper_dir(paper_id)
    p = d / _cit_filename(code)
    p.write_text(
        json.dumps(
            {k: v.model_dump() for k, v in all_items.items()},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_chat_history(paper_id: str, lang: Optional[str] = None) -> list[ChatMessage]:
    d = paper_dir(paper_id)
    p = d / _chat_filename(lang)
    if not p.exists():
        return []
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return [ChatMessage.model_validate(x) for x in arr]
    except Exception:
        return []


def save_chat_history(
    paper_id: str,
    messages: list[ChatMessage],
    lang: Optional[str] = None,
) -> None:
    d = paper_dir(paper_id)
    p = d / _chat_filename(lang)
    p.write_text(
        json.dumps([m.model_dump() for m in messages], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_chat_history(paper_id: str, lang: Optional[str] = None) -> None:
    d = paper_dir(paper_id)
    p = d / _chat_filename(lang)
    if p.exists():
        p.unlink()
