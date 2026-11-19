from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Optional

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
    doc_path = d / "document.json"
    doc_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")

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


def update_paper_doc(doc: PaperDocument) -> None:
    d = paper_dir(doc.paper_id)
    doc_path = d / "document.json"
    doc_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")


def load_paper_doc(paper_id: str) -> Optional[PaperDocument]:
    ensure_dirs()
    safe_id = "".join(c for c in paper_id if c.isalnum() or c in ("-", "_"))
    doc_path = PAPERS_DIR / safe_id / "document.json"
    if not doc_path.exists():
        return None
    raw = doc_path.read_text(encoding="utf-8")
    return PaperDocument.model_validate_json(raw)


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


def list_papers() -> list[PaperSummaryItem]:
    ensure_dirs()
    items: list[PaperSummaryItem] = []
    for d in PAPERS_DIR.iterdir():
        if not d.is_dir():
            continue
        doc_path = d / "document.json"
        if not doc_path.exists():
            continue
        try:
            doc = PaperDocument.model_validate_json(doc_path.read_text(encoding="utf-8"))
            items.append(
                PaperSummaryItem(
                    paper_id=doc.paper_id,
                    title=doc.title,
                    filename=doc.filename,
                    page_count=doc.page_count,
                    sentence_count=len(doc.sentences),
                    reference_count=len(doc.references),
                    ai_status=doc.ai_status,
                    created_at=doc.created_at,
                )
            )
        except Exception:
            continue
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def load_sentence_analyses(paper_id: str) -> dict[str, SentenceAnalysis]:
    d = paper_dir(paper_id)
    p = d / "sentence_analyses.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k: SentenceAnalysis.model_validate(v) for k, v in data.items()}
    except Exception:
        return {}


def save_sentence_analysis(paper_id: str, analysis: SentenceAnalysis) -> None:
    all_items = load_sentence_analyses(paper_id)
    all_items[analysis.sentence_id] = analysis
    d = paper_dir(paper_id)
    p = d / "sentence_analyses.json"
    p.write_text(
        json.dumps(
            {k: v.model_dump() for k, v in all_items.items()},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_citation_summaries(paper_id: str) -> dict[str, CitationSummaryResponse]:
    d = paper_dir(paper_id)
    p = d / "citation_summaries.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return {k: CitationSummaryResponse.model_validate(v) for k, v in data.items()}
    except Exception:
        return {}


def save_citation_summary(paper_id: str, summary: CitationSummaryResponse) -> None:
    all_items = load_citation_summaries(paper_id)
    all_items[summary.ref_key] = summary
    d = paper_dir(paper_id)
    p = d / "citation_summaries.json"
    p.write_text(
        json.dumps(
            {k: v.model_dump() for k, v in all_items.items()},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def load_chat_history(paper_id: str) -> list[ChatMessage]:
    d = paper_dir(paper_id)
    p = d / "chat_history.json"
    if not p.exists():
        return []
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return [ChatMessage.model_validate(x) for x in arr]
    except Exception:
        return []


def save_chat_history(paper_id: str, messages: list[ChatMessage]) -> None:
    d = paper_dir(paper_id)
    p = d / "chat_history.json"
    p.write_text(
        json.dumps([m.model_dump() for m in messages], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_chat_history(paper_id: str) -> None:
    d = paper_dir(paper_id)
    p = d / "chat_history.json"
    if p.exists():
        p.unlink()
