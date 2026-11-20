from __future__ import annotations

import datetime as dt
import re
import statistics
from pathlib import Path
from typing import Optional, Union
from urllib.parse import urlsplit

try:
    import pymupdf as fitz  # PyMuPDF >= 1.24.3
except ImportError:  # pragma: no cover
    import fitz  # type: ignore

from .models import (
    BBox,
    InlineCitation,
    MediaAsset,
    PaperDocument,
    PaperResourceLink,
    PdfLineRecord,
    RawBodyChunk,
    ReferenceEntry,
    SentenceItem,
)
from .storage import compute_paper_id, media_dir

# Abbreviations that should NOT trigger sentence splits after '.'
ABBREVIATIONS = {
    "al", "fig", "figs", "eq", "eqs", "sec", "secs", "tab", "tabs",
    "eg", "ie", "cf", "vs", "etc", "dr", "prof", "mr", "mrs", "ms",
    "jr", "sr", "inc", "ltd", "co", "no", "nos", "vol", "vols", "pp",
    "ch", "app", "approx", "resp", "st", "ave", "dept", "univ", "proc",
    "trans", "intl", "conf", "jan", "feb", "mar", "apr", "jun", "jul",
    "aug", "sep", "sept", "oct", "nov", "dec",
}

REF_HEADING_RE = re.compile(
    r"^(?:(?:\d+\.?|[IVX]+\.?)\s*)?(?:references|bibliography|literature\s+cited|works\s+cited)\s*$",
    re.IGNORECASE,
)
POST_REF_HEADING_RE = re.compile(
    r"^(?:(?:[A-Z]\.?|\d+\.?)\s*)?(?:appendix|appendices|supplementary|supplemental)\b",
    re.IGNORECASE,
)
SECTION_HEADING_RE = re.compile(
    r"^(?:abstract|(?:\d+(?:\.\d+){0,2}\.?|[IVX]+\.)\s+[A-Z][^\n]{1,80})$",
    re.IGNORECASE,
)

ARXIV_RE = re.compile(
    r"(?:arXiv\s*:\s*|arxiv\.org/(?:abs|pdf)/)(\d{4}\.\d{4,5}(?:v\d+)?)",
    re.IGNORECASE,
)
DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)")
YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})[a-z]?\b")

# Numbered bibliography entry start: "[12] ..." or "12. A. Smith..."
REF_BRACKET_START_RE = re.compile(r"^\[\s*(\d{1,4})\s*\]\s*(.+)$")
REF_DOT_START_RE = re.compile(r"^(\d{1,4})\.\s+([A-Z\"“‘].+)$")

# Inline citations in body sentences
INLINE_BRACKET_RE = re.compile(r"\[(\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*)\]")
INLINE_AUTH_YEAR_GROUP_RE = re.compile(
    r"\(([^()]{4,120}?(?:19|20)\d{2}[a-z]?[^()]{0,40})\)"
)
SINGLE_AUTH_YEAR_RE = re.compile(
    r"([A-Z][A-Za-z'’-]+)(?:\s+et\s+al\.?|\s+(?:and|&)\s+[A-Z][A-Za-z'’-]+)?\s*,?\s*((?:19|20)\d{2})([a-z]?)"
)


def _clean_spaces(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\u200b", "")
    # Normalize common PDF ligatures
    for src, dst in (
        ("\ufb00", "ff"),
        ("\ufb01", "fi"),
        ("\ufb02", "fl"),
        ("\ufb03", "ffi"),
        ("\ufb04", "ffl"),
    ):
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def _is_horizontal_line(line: dict) -> bool:
    direction = line.get("dir", (1.0, 0.0))
    return abs(direction[0]) >= 0.85


WATERMARK_RE = re.compile(
    r"^(?:FOR\s+REVIEW\s+ONLY|CONFIDENTIAL|DRAFT|PREPRINT|DO\s+NOT\s+DISTRIBUTE)[\s.:;!-]*$",
    re.IGNORECASE,
)
FIG_CAPTION_RE = re.compile(
    r"^(?:Fig\.?|Figure)\s*(\d+[A-Za-z]?)\s*(?:[.:–—-]|\s{2,})\s*(.+)$",
    re.IGNORECASE,
)
TAB_CAPTION_RE = re.compile(
    r"^(?:Table|Tab\.?)\s*(\d+|[IVX]+)\s*(?:[.:–—-]|\s{2,})\s*(.+)$",
    re.IGNORECASE,
)


def _is_light_watermark_color(color_int: int) -> bool:
    r = (color_int >> 16) & 255
    g = (color_int >> 8) & 255
    b = color_int & 255
    return ((r + g + b) / 3.0) > 205.0


def _col_kind_coords(x0: float, x1: float, pw: float) -> str:
    """
    Classify horizontal span as 'full' ONLY if it genuinely straddles the two-column center gutter.
    Centered short headings or equations inside a single column remain 'left' or 'right'.
    """
    if x0 < pw * 0.44 and x1 > pw * 0.56:
        return "full"
    center_x = (x0 + x1) * 0.5
    return "left" if center_x < pw * 0.50 else "right"


def _extract_page_blocks(page: fitz.Page) -> list[dict]:
    """Extract clean, watermark-free, reading-order sorted text blocks from a PDF page."""
    rect = page.rect
    pw, ph = max(rect.width, 1.0), max(rect.height, 1.0)
    raw = page.get_text("dict", flags=fitz.TEXT_PRESERVE_LIGATURES)

    cleaned_blocks: list[dict] = []
    for blk_idx, b in enumerate(raw.get("blocks", [])):
        if b.get("type") != 0:
            continue
        bx0, by0, bx1, by1 = b["bbox"]
        # Skip vertical margin stamps (e.g. arXiv stamp on far left/right)
        if bx1 < pw * 0.055 or bx0 > pw * 0.945:
            continue

        lines_out: list[dict] = []
        font_sizes: list[float] = []
        is_bold_votes: list[bool] = []

        for ln in b.get("lines", []):
            if not _is_horizontal_line(ln):
                continue
            lx0, ly0, lx1, ly1 = ln["bbox"]
            spans_text = []
            for sp in ln.get("spans", []):
                t = sp.get("text", "")
                if not t:
                    continue
                if _is_light_watermark_color(int(sp.get("color", 0))):
                    continue
                spans_text.append(t)
                sz = float(sp.get("size", 10.0))
                font_sizes.append(sz)
                flags = int(sp.get("flags", 0))
                font_name = (sp.get("font") or "").lower()
                is_bold_votes.append(bool(flags & 16) or "bold" in font_name or "medi" in font_name)

            line_str = _clean_spaces("".join(spans_text))
            if not line_str or WATERMARK_RE.match(line_str):
                continue
            lines_out.append(
                {
                    "text": line_str,
                    "bbox": (lx0, ly0, lx1, ly1),
                    "norm_bbox": BBox(
                        x0=round(max(0.0, min(1.0, lx0 / pw)), 4),
                        y0=round(max(0.0, min(1.0, ly0 / ph)), 4),
                        x1=round(max(0.0, min(1.0, lx1 / pw)), 4),
                        y1=round(max(0.0, min(1.0, ly1 / ph)), 4),
                    ),
                }
            )

        if not lines_out:
            continue

        block_text = " ".join(l["text"] for l in lines_out).strip()
        if WATERMARK_RE.match(block_text):
            continue

        # Skip running headers & footers at top/bottom 6.2% of page (conference banners, page numbers)
        if (by1 < ph * 0.062 or by0 > ph * 0.938) and len(lines_out) <= 3:
            continue

        avg_size = statistics.median(font_sizes) if font_sizes else 10.0
        bold_ratio = (sum(is_bold_votes) / len(is_bold_votes)) if is_bold_votes else 0.0

        cleaned_blocks.append(
            {
                "id": blk_idx,
                "bbox": (bx0, by0, bx1, by1),
                "lines": lines_out,
                "font_size": avg_size,
                "is_bold": bold_ratio >= 0.5,
                "pw": pw,
                "ph": ph,
            }
        )

    return _sort_blocks_reading_order(cleaned_blocks, pw)


def _is_single_column_page(blocks: list[dict], pw: float) -> bool:
    """
    Automatically detect whether a page uses a 1-column layout vs 2-column layout.
    Returns True for 1-column pages (e.g. NeurIPS, ICLR, JMLR, arXiv single-column, or 1-column appendices).
    """
    full_prose = 0
    left_col_prose = 0
    right_col_prose = 0

    for b in blocks:
        if len(b["lines"]) < 2:
            continue
        x0, _, x1, _ = b["bbox"]
        w = x1 - x0
        if w < pw * 0.24:
            continue
        if x0 < pw * 0.42 and x1 > pw * 0.58:
            full_prose += 1
        elif x1 <= pw * 0.53:
            left_col_prose += 1
        elif x0 >= pw * 0.47:
            right_col_prose += 1

    # A 2-column page has multi-line column prose on BOTH left and right halves (or solely confined to one column)
    if left_col_prose >= 1 and right_col_prose >= 1:
        return False
    if full_prose == 0 and (left_col_prose >= 2 or right_col_prose >= 2):
        return False
    return True


def _sort_blocks_reading_order(blocks: list[dict], pw: float) -> list[dict]:
    """Automatically handle both 1-column and 2-column (including hybrid full-width + 2-col) pages."""
    if len(blocks) <= 1:
        return blocks

    blocks_by_y = sorted(blocks, key=lambda b: (round(b["bbox"][1], 1), round(b["bbox"][0], 1)))

    # Pure 1-column page: keep strict top-to-bottom vertical reading order
    if _is_single_column_page(blocks_by_y, pw):
        return blocks_by_y

    result: list[dict] = []
    band_left: list[dict] = []
    band_right: list[dict] = []

    def flush_band() -> None:
        if band_left or band_right:
            band_left.sort(key=lambda b: (round(b["bbox"][1], 1), round(b["bbox"][0], 1)))
            band_right.sort(key=lambda b: (round(b["bbox"][1], 1), round(b["bbox"][0], 1)))
            result.extend(band_left)
            result.extend(band_right)
            band_left.clear()
            band_right.clear()

    for b in blocks_by_y:
        x0, _, x1, _ = b["bbox"]
        k = _col_kind_coords(x0, x1, pw)
        if k == "full":
            flush_band()
            result.append(b)
        elif k == "left":
            band_left.append(b)
        else:
            band_right.append(b)

    flush_band()
    return result


def _detect_title(doc: fitz.Document, first_page_blocks: list[dict], fallback_name: str) -> str:
    # Look for largest font block in top 35% of page 1, merging immediately adjacent title lines
    candidates = [
        b
        for b in first_page_blocks
        if b["bbox"][1] < b["ph"] * 0.35
        and len(" ".join(l["text"] for l in b["lines"])) >= 6
    ]
    if candidates:
        top_sorted = sorted(candidates, key=lambda b: b["bbox"][1])
        best = max(top_sorted, key=lambda b: (round(b["font_size"], 2), -b["bbox"][1]))
        merged_parts = [" ".join(l["text"] for l in best["lines"])]
        last_y1 = best["bbox"][3]

        for b in top_sorted:
            if b is best or b["bbox"][1] < best["bbox"][1]:
                continue
            gap = b["bbox"][1] - last_y1
            if 0 <= gap <= 6.5 and abs(b["font_size"] - best["font_size"]) <= 0.6:
                merged_parts.append(" ".join(l["text"] for l in b["lines"]))
                last_y1 = b["bbox"][3]
            elif gap > 6.5:
                break

        title_str = _clean_spaces(" ".join(merged_parts))
        if 6 <= len(title_str) <= 320 and not title_str.lower().startswith("abstract"):
            return title_str

    meta_title = _clean_spaces((doc.metadata or {}).get("title") or "")
    if meta_title and meta_title.lower() not in {"untitled", "paper", "main"} and not meta_title.lower().endswith(".pdf"):
        return meta_title

    return fallback_name.rsplit(".", 1)[0]


def _should_split_sentence(prefix: str, next_char: str) -> bool:
    """Determine if a period/question/exclamation at end of `prefix` ends a sentence."""
    if not next_char or not (next_char.isupper() or next_char in "\"“‘'(["):
        return False

    # Check token immediately preceding the period
    m = re.search(r"([A-Za-z0-9.]+)\.$", prefix.strip())
    if not m:
        return True
    last_tok = m.group(1)
    norm_tok = last_tok.replace(".", "").lower()
    if norm_tok in ABBREVIATIONS:
        return False
    # Single capital initial like "A. Vaswani"
    if len(last_tok) == 1 and last_tok.isupper():
        return False
    return True


def _split_block_into_sentences(lines: list[dict]) -> list[tuple[str, list[BBox]]]:
    """Join lines (de-hyphenating line breaks) and split into sentences with exact line BBoxes."""
    full_chars: list[str] = []
    char_line_idx: list[int] = []

    for idx, ln in enumerate(lines):
        t = ln["text"].strip()
        if not t:
            continue
        if full_chars:
            # De-hyphenate across line break if word-hyphen + lowercase continuation
            if (
                full_chars[-1] in "-‐‑"
                and len(full_chars) >= 2
                and full_chars[-2].isalpha()
                and t[0].islower()
            ):
                full_chars.pop()
                char_line_idx.pop()
            else:
                full_chars.append(" ")
                char_line_idx.append(idx)

        for ch in t:
            full_chars.append(ch)
            char_line_idx.append(idx)

    text = "".join(full_chars)
    if not text:
        return []

    sentences: list[tuple[str, list[BBox]]] = []
    n = len(text)
    sent_start = 0
    i = 0

    while i < n:
        ch = text[i]
        if ch in ".?!":
            # Look ahead past closing quotes/brackets and whitespace
            j = i + 1
            while j < n and text[j] in "\"”’')]":
                j += 1
            ws_start = j
            while j < n and text[j].isspace():
                j += 1

            if j >= n:
                # End of block
                end_pos = ws_start
                seg = text[sent_start:end_pos].strip()
                if seg:
                    bboxes = _collect_bboxes(lines, char_line_idx, sent_start, end_pos)
                    sentences.append((seg, bboxes))
                sent_start = n
                break

            if ws_start < j:
                prefix = text[sent_start : i + 1]
                next_ch = text[j]
                if ch in "?!" or _should_split_sentence(prefix, next_ch):
                    end_pos = ws_start
                    seg = text[sent_start:end_pos].strip()
                    if seg:
                        bboxes = _collect_bboxes(lines, char_line_idx, sent_start, end_pos)
                        sentences.append((seg, bboxes))
                    sent_start = j
                    i = j
                    continue
        i += 1

    if sent_start < n:
        seg = text[sent_start:n].strip()
        if seg:
            bboxes = _collect_bboxes(lines, char_line_idx, sent_start, n)
            sentences.append((seg, bboxes))

    return sentences


def _collect_bboxes(
    lines: list[dict],
    char_line_idx: list[int],
    start: int,
    end: int,
) -> list[BBox]:
    seen: list[int] = []
    for pos in range(max(0, start), min(len(char_line_idx), end)):
        li = char_line_idx[pos]
        if not seen or seen[-1] != li:
            seen.append(li)
    return [lines[li]["norm_bbox"] for li in seen if 0 <= li < len(lines)]


def _is_meaningful_sentence(text: str) -> bool:
    """Filter out page numbers, standalone math fragments, or figure axis ticks."""
    if len(text) < 12:
        return False
    alpha_count = sum(c.isalpha() for c in text)
    if alpha_count < 6:
        return False
    if alpha_count / max(len(text), 1) < 0.32:
        return False
    return True


def _parse_reference_metadata_heuristic(ref_key: str, raw_text: str) -> ReferenceEntry:
    """Extract best-effort title, authors, year, arXiv ID, and DOI directly from bibliography text."""
    clean = _clean_spaces(raw_text)

    arxiv_match = ARXIV_RE.search(clean)
    arxiv_id = arxiv_match.group(1) if arxiv_match else None

    doi_match = DOI_RE.search(clean)
    doi = doi_match.group(1).rstrip(".,;)") if doi_match else None

    years = [int(m.group(1)) for m in YEAR_RE.finditer(clean) if 1950 <= int(m.group(1)) <= 2035]
    year = years[0] if years else None

    # Heuristic title extraction:
    # 1) Quoted title: “Title...” or "Title..."
    title: Optional[str] = None
    q_match = re.search(r"[“\"]([^”\"]{12,240})[”\"]", clean)
    if q_match:
        title = q_match.group(1).strip(" .,:;")

    authors_list: list[str] = []
    if not title:
        # 2) Author (2020). Title. Venue... OR Author. Title. In Proceedings...
        yr_split = re.search(r"\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?\s*(.+)", clean)
        if yr_split:
            author_part = clean[: yr_split.start()].strip(" .,:;")
            rest = yr_split.group(1)
            parts = [p.strip() for p in re.split(r"\.\s+", rest) if len(p.strip()) >= 8]
            if parts:
                title = parts[0].strip(" .")
            if author_part:
                authors_list = [a.strip() for a in re.split(r",\s*(?:and\s+)?|\s+and\s+", author_part) if a.strip()][:6]
        else:
            # Split by period: typically [Authors]. [Title]. [Venue, Year].
            segments = [s.strip() for s in re.split(r"\.\s+", clean) if s.strip()]
            if len(segments) >= 2:
                authors_part = segments[0]
                # Choose first non-author-looking segment of reasonable length
                for seg in segments[1:]:
                    if len(seg) >= 12 and not seg.lower().startswith(("in ", "proc", "arxiv", "vol", "http")):
                        title = seg.strip(" .")
                        break
                authors_list = [a.strip() for a in re.split(r",\s*(?:and\s+)?|\s+and\s+", authors_part) if len(a.strip()) >= 2][:6]

    url = None
    pdf_url = None
    if arxiv_id:
        base_id = re.sub(r"v\d+$", "", arxiv_id)
        url = f"https://arxiv.org/abs/{base_id}"
        pdf_url = f"https://arxiv.org/pdf/{base_id}.pdf"
    elif doi:
        url = f"https://doi.org/{doi}"

    return ReferenceEntry(
        ref_key=ref_key,
        raw_text=clean,
        title=title or (clean[:140] + ("..." if len(clean) > 140 else "")),
        authors=authors_list,
        year=year,
        arxiv_id=arxiv_id,
        doi=doi,
        url=url,
        pdf_url=pdf_url,
        enriched=False,
    )


def _parse_reference_lines(ref_lines: list[tuple[float, str]]) -> dict[str, ReferenceEntry]:
    """Group bibliography lines into individual ReferenceEntry objects."""
    if not ref_lines:
        return {}

    # Also split lines where a PDF merged "... 2017. [2] Author..." onto a single line
    expanded_lines: list[tuple[float, str]] = []
    for x0, t in ref_lines:
        parts = re.split(r"(?<=[.)])\s+(?=\[\s*\d{1,4}\s*\]\s+[A-Z\"“‘])", t)
        for p in parts:
            if p.strip():
                expanded_lines.append((x0, p.strip()))
    ref_lines = expanded_lines

    # Check if bracket-numbered or dot-numbered references are present
    bracket_hits = sum(1 for _, t in ref_lines if REF_BRACKET_START_RE.match(t))
    dot_hits = sum(1 for _, t in ref_lines if REF_DOT_START_RE.match(t))

    entries: dict[str, ReferenceEntry] = {}

    if bracket_hits >= 1 or dot_hits >= 2 or (dot_hits >= 1 and len(ref_lines) <= 4):
        use_bracket = bracket_hits >= dot_hits
        current_key: Optional[str] = None
        current_parts: list[str] = []

        def flush_num() -> None:
            if current_key and current_parts:
                joined = _clean_spaces(" ".join(current_parts))
                # De-hyphenate inside reference entry
                joined = re.sub(r"([A-Za-z])-\s+([a-z])", r"\1\2", joined)
                entries[current_key] = _parse_reference_metadata_heuristic(current_key, joined)

        for _, txt in ref_lines:
            m = REF_BRACKET_START_RE.match(txt) if use_bracket else REF_DOT_START_RE.match(txt)
            if m:
                flush_num()
                current_key = m.group(1)
                current_parts = [m.group(2)]
            elif current_key is not None:
                current_parts.append(txt)
        flush_num()
    else:
        # Author-year / hanging-indent bibliography
        # Estimate column left margin clusters (for 1-col or 2-col references)
        xs = sorted(x for x, _ in ref_lines)
        # Split into left/right column x-Anchors if bimodal
        left_xs = [x for x in xs if x < 260]
        right_xs = [x for x in xs if x >= 260]
        left_margin = statistics. quantiles(left_xs, n=10)[0] if len(left_xs) >= 5 else (min(left_xs) if left_xs else 0.0)
        right_margin = statistics.quantiles(right_xs, n=10)[0] if len(right_xs) >= 5 else (min(right_xs) if right_xs else 300.0)

        raw_entries: list[str] = []
        buf: list[str] = []

        for x0, txt in ref_lines:
            anchor = left_margin if x0 < 260 else right_margin
            is_outdent = (x0 <= anchor + 5.5) and bool(re.match(r"^[A-Z]", txt))
            if is_outdent and buf:
                joined = re.sub(r"([A-Za-z])-\s+([a-z])", r"\1\2", _clean_spaces(" ".join(buf)))
                if len(joined) >= 20:
                    raw_entries.append(joined)
                buf = [txt]
            else:
                buf.append(txt)
        if buf:
            joined = re.sub(r"([A-Za-z])-\s+([a-z])", r"\1\2", _clean_spaces(" ".join(buf)))
            if len(joined) >= 20:
                raw_entries.append(joined)

        for idx, raw_e in enumerate(raw_entries, start=1):
            # Build author-year key like "vaswani2017"
            surname_m = re.match(r"^([A-Z][A-Za-z'’-]+)", raw_e)
            year_m = YEAR_RE.search(raw_e)
            if surname_m and year_m:
                base_key = f"{surname_m.group(1).lower()}{year_m.group(1)}"
            else:
                base_key = f"ref_{idx}"
            key = base_key
            suffix_num = 2
            while key in entries:
                key = f"{base_key}_{suffix_num}"
                suffix_num += 1
            entries[key] = _parse_reference_metadata_heuristic(key, raw_e)

    return entries


def _build_author_year_index(references: dict[str, ReferenceEntry]) -> dict[str, str]:
    """Map normalized 'surname:year' -> ref_key for matching author-year citations."""
    index: dict[str, str] = {}
    for ref_key, entry in references.items():
        if not entry.year:
            continue
        # Extract first surname from raw_text or authors
        source = entry.authors[0] if entry.authors else entry.raw_text
        # Handle "A. Vaswani" vs "Vaswani, A."
        tokens = re.findall(r"[A-Z][A-Za-z'’-]{1,}", source[:60])
        for tok in tokens[:2]:
            norm = f"{tok.lower()}:{entry.year}"
            index.setdefault(norm, ref_key)
    return index


def _extract_inline_citations(
    sentence_text: str,
    references: dict[str, ReferenceEntry],
    auth_year_idx: dict[str, str],
) -> list[InlineCitation]:
    found: list[InlineCitation] = []

    # Ignore brackets located inside explicit LaTeX math spans ($...$, $$...$$, \(...\), \[...\])
    math_spans: list[tuple[int, int]] = [
        (mm.start(), mm.end())
        for mm in re.finditer(
            r"\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\|\$)\$(?!\$)(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\$)",
            sentence_text,
        )
    ]

    # 1. Bracketed numeric citations: [12], [1, 4, 9], [3-5]
    for m in INLINE_BRACKET_RE.finditer(sentence_text):
        if any(m.start() < me and m.end() > ms for ms, me in math_spans):
            continue
        inner = m.group(1)
        # Expand individual numbers inside brackets while tracking exact offsets where possible
        # First check if any 0 appears (e.g. math interval [0, 1]) -> skip!
        raw_parts = [p.strip() for p in inner.split(",")]
        nums_with_labels: list[str] = []
        skip_math = False
        for part in raw_parts:
            rng = re.match(r"^(\d{1,3})\s*[-–—]\s*(\d{1,3})$", part)
            if rng:
                a, b = int(rng.group(1)), int(rng.group(2))
                if a == 0 or b < a or (b - a) > 15:
                    skip_math = True
                    break
                for k in range(a, b + 1):
                    nums_with_labels.append(str(k))
            elif part.isdigit():
                val = int(part)
                if val == 0 or val > 500:
                    skip_math = True
                    break
                nums_with_labels.append(str(val))
            else:
                skip_math = True
                break

        if skip_math or not nums_with_labels:
            continue

        # Locate sub-spans inside "[...]" when comma-separated, else attach to whole bracket
        if len(nums_with_labels) == 1:
            rk = nums_with_labels[0]
            found.append(
                InlineCitation(
                    ref_key=rk,
                    label=m.group(0),
                    start=m.start(),
                    end=m.end(),
                )
            )
        else:
            # Find individual token spans inside the bracket for clean per-number clicking
            cursor = m.start() + 1
            bracket_end = m.end() - 1
            sub_slice = sentence_text[cursor:bracket_end]
            matched_sub = False
            for sub_m in re.finditer(r"(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?", sub_slice):
                s_abs = cursor + sub_m.start()
                e_abs = cursor + sub_m.end()
                if sub_m.group(2):
                    a, b = int(sub_m.group(1)), int(sub_m.group(2))
                    for k in range(a, b + 1):
                        found.append(
                            InlineCitation(
                                ref_key=str(k),
                                label=f"[{k}]",
                                start=s_abs,
                                end=e_abs,
                            )
                        )
                else:
                    rk = sub_m.group(1)
                    found.append(
                        InlineCitation(
                            ref_key=rk,
                            label=f"[{rk}]",
                            start=s_abs,
                            end=e_abs,
                        )
                    )
                matched_sub = True
            if not matched_sub:
                for rk in nums_with_labels:
                    found.append(
                        InlineCitation(
                            ref_key=rk,
                            label=f"[{rk}]",
                            start=m.start(),
                            end=m.end(),
                        )
                    )

    # 2. Author-year citations: (Vaswani et al., 2017; Devlin et al., 2019)
    if auth_year_idx:
        for grp in INLINE_AUTH_YEAR_GROUP_RE.finditer(sentence_text):
            grp_start = grp.start()
            inner = grp.group(1)
            for sub in SINGLE_AUTH_YEAR_RE.finditer(inner):
                surname = sub.group(1).lower()
                year = sub.group(2)
                lookup = f"{surname}:{year}"
                rk = auth_year_idx.get(lookup)
                if rk and rk in references:
                    found.append(
                        InlineCitation(
                            ref_key=rk,
                            label=sub.group(0).strip(),
                            start=grp_start + 1 + sub.start(),
                            end=grp_start + 1 + sub.end(),
                        )
                    )

    found.sort(key=lambda c: (c.start, c.end))
    return found


def parse_pdf_bytes(pdf_bytes: bytes, filename: str) -> PaperDocument:
    """Parse a research paper PDF into structured sentences, PDF bboxes, and bibliography entries."""
    paper_id = compute_paper_id(pdf_bytes)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    try:
        all_pages_blocks: list[tuple[int, list[dict]]] = []
        all_font_sizes: list[float] = []

        for page_idx in range(len(doc)):
            p_blocks = _extract_page_blocks(doc[page_idx])
            all_pages_blocks.append((page_idx + 1, p_blocks))
            for b in p_blocks:
                all_font_sizes.append(b["font_size"])

        body_font_size = statistics.median(all_font_sizes) if all_font_sizes else 10.0
        first_blocks = all_pages_blocks[0][1] if all_pages_blocks else []
        title = _detect_title(doc, first_blocks, filename)
        detected_arxiv_id, detected_links = _extract_links_from_fitz_doc(
            doc, title=title, filename=filename
        )

        sections: list[str] = []
        current_section = "Overview"
        in_references = False

        raw_sentences: list[tuple[int, str, str, list[BBox]]] = []
        ref_lines: list[tuple[float, str]] = []

        for page_num, p_blocks in all_pages_blocks:
            for b in p_blocks:
                block_text = _clean_spaces(" ".join(l["text"] for l in b["lines"]))
                if not block_text:
                    continue

                # Check if this block is a section heading
                is_single_or_short = len(b["lines"]) <= 2 and len(block_text) <= 85
                looks_like_heading = is_single_or_short and (
                    REF_HEADING_RE.match(block_text)
                    or POST_REF_HEADING_RE.match(block_text)
                    or (
                        (b["font_size"] >= body_font_size * 1.07 or b["is_bold"])
                        and SECTION_HEADING_RE.match(block_text)
                    )
                )

                if looks_like_heading:
                    if REF_HEADING_RE.match(block_text):
                        in_references = True
                        continue
                    if in_references and POST_REF_HEADING_RE.match(block_text):
                        in_references = False
                    if not in_references:
                        current_section = block_text
                        if current_section not in sections:
                            sections.append(current_section)
                        continue

                if in_references:
                    for ln in b["lines"]:
                        ref_lines.append((ln["bbox"][0], ln["text"]))
                    continue

                # Skip exact duplicate of paper title on page 1
                if page_num == 1 and block_text == title:
                    continue

                # Segment body block into sentences
                for sent_text, bboxes in _split_block_into_sentences(b["lines"]):
                    if not _is_meaningful_sentence(sent_text):
                        continue
                    if current_section not in sections:
                        sections.append(current_section)
                    raw_sentences.append((page_num, current_section, sent_text, bboxes))

        references = _parse_reference_lines(ref_lines)
        auth_year_idx = _build_author_year_index(references)

        sentences: list[SentenceItem] = []
        for idx, (page_num, sec, stext, bboxes) in enumerate(raw_sentences):
            citations = _extract_inline_citations(stext, references, auth_year_idx)
            sentences.append(
                SentenceItem(
                    id=f"s_{idx:04d}",
                    index=idx,
                    page=page_num,
                    section=sec,
                    text=stext,
                    bboxes=bboxes,
                    citations=citations,
                )
            )

        return PaperDocument(
            paper_id=paper_id,
            title=title,
            filename=filename,
            page_count=len(doc),
            sections=sections,
            sentences=sentences,
            references=references,
            created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        )
    finally:
        doc.close()


def extract_key_text_from_cited_pdf(pdf_bytes: bytes, max_chars: int = 14000) -> str:
    """Extract Abstract, Introduction, Method overview, and Conclusion from a cited PDF for fast AI summarization."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        chunks: list[str] = []
        total = 0
        # First pages (Title, Abstract, Introduction, Method overview)
        front_pages = min(len(doc), 5)
        for p_idx in range(front_pages):
            txt = _clean_spaces(doc[p_idx].get_text("text"))
            if not txt:
                continue
            take = txt[: max(0, (max_chars * 3 // 4) - total)]
            if take:
                chunks.append(f"[Page {p_idx + 1}]\n{take}")
                total += len(take)
            if total >= max_chars * 3 // 4:
                break

        # Also grab Conclusion / Discussion pages near the end (before References)
        if len(doc) > front_pages and total < max_chars:
            for p_idx in range(max(front_pages, len(doc) - 4), len(doc)):
                txt = _clean_spaces(doc[p_idx].get_text("text"))
                # Trim off References tail if present
                ref_pos = re.search(r"\b(?:References|Bibliography)\b", txt)
                if ref_pos and ref_pos.start() > 200:
                    txt = txt[: ref_pos.start()]
                take = txt[: max(0, max_chars - total)]
                if take:
                    chunks.append(f"[Page {p_idx + 1}]\n{take}")
                    total += len(take)
                if total >= max_chars:
                    break

        return "\n\n".join(chunks)
    finally:
        doc.close()


def extract_main_figure_from_cited_pdf(
    pdf_bytes: bytes,
    out_png_path: Union[Path, str],
) -> Optional[str]:
    """
    Extract the Main Figure (preferring Fig. 1 / Figure 1, or first clear figure on pages 1-6)
    from a cited paper PDF and save as PNG to `out_png_path`. Returns caption text if extracted.
    """
    from pathlib import Path

    out_file = Path(out_png_path)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        max_pages = min(len(doc), 6)
        fallback_candidate: Optional[tuple[fitz.Page, fitz.Rect, str]] = None

        for p_idx in range(max_pages):
            page = doc[p_idx]
            pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
            blocks = _extract_page_blocks(page)
            raw = page.get_text("dict")

            img_rects = [
                tuple(b["bbox"])
                for b in raw.get("blocks", [])
                if b.get("type") == 1
                and (b["bbox"][2] - b["bbox"][0]) >= 28
                and (b["bbox"][3] - b["bbox"][1]) >= 28
                and ((b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1])) < 0.82 * pw * ph
            ]
            draw_rects = []
            for d in page.get_drawings():
                r = d.get("rect")
                if not r:
                    continue
                x0, y0, x1, y1 = float(r.x0), float(r.y0), float(r.x1), float(r.y1)
                if x1 < pw * 0.04 or x0 > pw * 0.96 or y1 < ph * 0.055 or y0 > ph * 0.94:
                    continue
                if (x1 - x0) * (y1 - y0) > 0.72 * pw * ph:
                    continue
                if (x1 - x0) >= 6.0 or (y1 - y0) >= 6.0:
                    draw_rects.append((x0, y0, x1, y1))

            for b in blocks:
                sents = _split_block_into_sentences(b["lines"])
                cap_clean = (
                    " ".join(s for s, _ in sents).strip()
                    if sents
                    else _clean_spaces(" ".join(l["text"] for l in b["lines"]))
                )
                m_fig = FIG_CAPTION_RE.match(cap_clean)
                if not m_fig:
                    continue

                fig_num = m_fig.group(1)
                cx0, cy0, cx1, cy1 = b["bbox"]
                cb_col = "full" if _is_single_column_page(blocks, pw) else _col_kind_coords(cx0, cx1, pw)
                scope_x0 = 0.0 if cb_col in ("left", "full") else pw * 0.475
                scope_x1 = pw if cb_col in ("right", "full") else pw * 0.525

                # Find ceiling above caption
                y_ceiling = ph * 0.062
                for ob in blocks:
                    if ob is b:
                        continue
                    ox0, oy0, ox1, oy1 = ob["bbox"]
                    if min(ox1, scope_x1) - max(ox0, scope_x0) <= 12.0:
                        continue
                    if oy1 <= cy0 + 2.0 and len(ob["lines"]) >= 3:
                        widths = [ln["bbox"][2] - ln["bbox"][0] for ln in ob["lines"]]
                        if (statistics.median(widths) if widths else 0) >= pw * 0.25:
                            y_ceiling = max(y_ceiling, oy1)

                vis_above = [
                    r
                    for r in (img_rects + draw_rects)
                    if (min(r[2], scope_x1) - max(r[0], scope_x0)) >= 18.0
                    and (cb_col == "full" or (r[2] - r[0]) <= pw * 0.56)
                    and r[1] >= y_ceiling - 5.0
                    and r[3] <= cy0 + 6.0
                ]
                if not vis_above:
                    continue

                vx0 = min(r[0] for r in vis_above)
                vy0 = min(r[1] for r in vis_above)
                vx1 = max(r[2] for r in vis_above)
                vy1 = max(r[3] for r in vis_above)
                if (vx1 - vx0) < 40 or (vy1 - vy0) < 35:
                    continue

                clip_rect = fitz.Rect(
                    max(0.0, vx0 - 6.0),
                    max(0.0, vy0 - 6.0),
                    min(pw, vx1 + 6.0),
                    max(vy0 + 12.0, min(cy0 - 1.5, vy1 + 6.0)),
                )

                if fig_num.startswith("1"):
                    pix = page.get_pixmap(clip=clip_rect, dpi=180)
                    pix.save(str(out_file))
                    return cap_clean
                elif fallback_candidate is None:
                    fallback_candidate = (page, clip_rect, cap_clean)

        if fallback_candidate is not None:
            pg, rect_c, cap_c = fallback_candidate
            pix = pg.get_pixmap(clip=rect_c, dpi=180)
            pix.save(str(out_file))
            return cap_c

        # Final fallback: largest bitmap diagram on pages 1-3
        for p_idx in range(min(len(doc), 3)):
            page = doc[p_idx]
            pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
            imgs = [
                b["bbox"]
                for b in page.get_text("dict").get("blocks", [])
                if b.get("type") == 1
                and 9000 <= (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1]) <= 0.75 * pw * ph
            ]
            if imgs:
                best_img = max(imgs, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
                pix = page.get_pixmap(clip=fitz.Rect(best_img), dpi=180)
                pix.save(str(out_file))
                return "Main Figure (원문에서 추출됨)"

        return None
    finally:
        doc.close()


def _norm_words(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _detect_and_crop_page_media(
    page: fitz.Page,
    page_num: int,
    blocks: list[dict],
    paper_id: str,
) -> tuple[list[dict], list[MediaAsset]]:
    """
    Detect Figure and Table captions on `page`, locate and crop high-DPI PNG images of each
    Figure (images/vector plots) and Table (booktabs horizontal rules + tabular cells),
    remove consumed interior diagram/table text blocks so they don't pollute prose,
    and re-sort remaining blocks in exact two-column / full-width reading order.
    """
    pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
    raw = page.get_text("dict")

    img_rects: list[tuple[float, float, float, float]] = []
    for b in raw.get("blocks", []):
        if b.get("type") == 1:
            x0, y0, x1, y1 = b["bbox"]
            if (x1 - x0) >= 16 and (y1 - y0) >= 16 and ((x1 - x0) * (y1 - y0)) < 0.82 * pw * ph:
                img_rects.append((x0, y0, x1, y1))

    draw_rects: list[tuple[float, float, float, float]] = []
    h_rules: list[tuple[float, float, float, float]] = []
    for d in page.get_drawings():
        r = d.get("rect")
        if not r:
            continue
        x0, y0, x1, y1 = float(r.x0), float(r.y0), float(r.x1), float(r.y1)
        if x1 < pw * 0.04 or x0 > pw * 0.96 or y1 < ph * 0.055 or y0 > ph * 0.94:
            continue
        w, h = x1 - x0, y1 - y0
        if w * h > 0.72 * pw * ph:
            continue
        if h <= 3.5 and w >= 45.0:
            h_rules.append((x0, y0, x1, y1))
        if w >= 6.0 or h >= 6.0:
            draw_rects.append((x0, y0, x1, y1))

    # Identify caption blocks first
    caption_entries: list[tuple[dict, str, str, str]] = []  # (block, kind, label, full_caption)
    caption_ids: set[int] = set()

    for b in blocks:
        joined = _clean_spaces(" ".join(l["text"] for l in b["lines"]))
        # De-hyphenate caption text cleanly
        sents = _split_block_into_sentences(b["lines"])
        cap_clean = " ".join(s for s, _ in sents).strip() if sents else joined

        m_fig = FIG_CAPTION_RE.match(cap_clean)
        if m_fig:
            num = m_fig.group(1)
            caption_entries.append((b, "figure", f"Fig. {num}", cap_clean))
            caption_ids.add(b["id"])
            continue

        m_tab = TAB_CAPTION_RE.match(cap_clean)
        if m_tab:
            num = m_tab.group(1)
            caption_entries.append((b, "table", f"Table {num}", cap_clean))
            caption_ids.add(b["id"])

    if not caption_entries:
        return blocks, []

    def is_anchor_prose(b: dict) -> bool:
        if b["id"] in caption_ids:
            return True
        txt = _clean_spaces(" ".join(l["text"] for l in b["lines"]))
        if len(b["lines"]) <= 2 and (
            SECTION_HEADING_RE.match(txt) or REF_HEADING_RE.match(txt)
        ):
            return True
        if len(b["lines"]) >= 2:
            widths = [ln["bbox"][2] - ln["bbox"][0] for ln in b["lines"]]
            med_w = statistics.median(widths) if widths else 0.0
            alpha_cnt = sum(ch.isalpha() for ch in txt)
            if med_w >= pw * 0.26 and (alpha_cnt / max(len(txt), 1)) >= 0.62:
                return True
        return False

    is_one_col = _is_single_column_page(blocks, pw)
    consumed_ids: set[int] = set()
    media_assets: list[MediaAsset] = []
    out_media_dir = media_dir(paper_id)

    for seq_idx, (cb, kind, label, cap_clean) in enumerate(caption_entries, start=1):
        cx0, cy0, cx1, cy1 = cb["bbox"]
        cb_col = "full" if is_one_col else _col_kind_coords(cx0, cx1, pw)
        if cb_col == "left":
            scope_x0, scope_x1 = 0.0, pw * 0.525
        elif cb_col == "right":
            scope_x0, scope_x1 = pw * 0.475, pw
        else:
            scope_x0, scope_x1 = 0.0, pw

        def in_x_scope(rx0: float, rx1: float) -> bool:
            w = max(rx1 - rx0, 1.0)
            ov = min(rx1, scope_x1) - max(rx0, scope_x0)
            if ov < min(18.0, w * 0.5):
                return False
            if cb_col != "full" and w > pw * 0.56:
                return False
            return True

        # Find nearest anchor prose ceiling above caption and floor below caption
        y_ceiling = ph * 0.062
        y_floor = ph * 0.938
        for ob in blocks:
            if ob is cb or ob["id"] in consumed_ids:
                continue
            ox0, oy0, ox1, oy1 = ob["bbox"]
            # Check horizontal overlap with scope
            if min(ox1, scope_x1) - max(ox0, scope_x0) <= 12.0:
                continue
            if not is_anchor_prose(ob):
                continue
            if oy1 <= cy0 + 2.0:
                y_ceiling = max(y_ceiling, oy1)
            elif oy0 >= cy1 - 2.0:
                y_floor = min(y_floor, oy0)

        crop_box: Optional[tuple[float, float, float, float]] = None
        table_hint_text = ""

        if kind == "figure":
            # Look above caption first (standard academic layout)
            vis_above = [
                r
                for r in (img_rects + draw_rects)
                if in_x_scope(r[0], r[2]) and r[1] >= y_ceiling - 5.0 and r[3] <= cy0 + 8.0
            ]
            if vis_above:
                vx0 = min(r[0] for r in vis_above)
                vy0 = min(r[1] for r in vis_above)
                vx1 = max(r[2] for r in vis_above)
                vy1 = max(r[3] for r in vis_above)
                fig_snippets: list[str] = []
                # Absorb interior diagram text labels (axis ticks, (a)/(b), module boxes, correlation scores)
                for ob in blocks:
                    if ob is cb or ob["id"] in caption_ids or is_anchor_prose(ob):
                        continue
                    ox0, oy0, ox1, oy1 = ob["bbox"]
                    if in_x_scope(ox0, ox1) and oy0 >= max(y_ceiling - 2.0, vy0 - 14.0) and oy1 <= cy0 + 2.0:
                        vx0, vy0 = min(vx0, ox0), min(vy0, oy0)
                        vx1, vy1 = max(vx1, ox1), max(vy1, oy1)
                        consumed_ids.add(ob["id"])
                        fig_snippets.append(_clean_spaces(" ".join(l["text"] for l in ob["lines"])))
                crop_box = (vx0, vy0, vx1, vy1)
                table_hint_text = " | ".join(fig_snippets)[:450]
            else:
                # Fallback: figure placed below caption
                vis_below = [
                    r
                    for r in (img_rects + draw_rects)
                    if in_x_scope(r[0], r[2]) and r[1] >= cy1 - 4.0 and r[3] <= y_floor + 5.0
                ]
                if vis_below:
                    vx0 = min(r[0] for r in vis_below)
                    vy0 = min(r[1] for r in vis_below)
                    vx1 = max(r[2] for r in vis_below)
                    vy1 = max(r[3] for r in vis_below)
                    fig_snippets_below: list[str] = []
                    for ob in blocks:
                        if ob is cb or ob["id"] in caption_ids or is_anchor_prose(ob):
                            continue
                        ox0, oy0, ox1, oy1 = ob["bbox"]
                        if in_x_scope(ox0, ox1) and oy0 >= cy1 - 2.0 and oy1 <= min(y_floor + 2.0, vy1 + 14.0):
                            vx0, vy0 = min(vx0, ox0), min(vy0, oy0)
                            vx1, vy1 = max(vx1, ox1), max(vy1, oy1)
                            consumed_ids.add(ob["id"])
                            fig_snippets_below.append(_clean_spaces(" ".join(l["text"] for l in ob["lines"])))
                    crop_box = (vx0, vy0, vx1, vy1)
                    table_hint_text = " | ".join(fig_snippets_below)[:450]

        else:  # kind == "table"
            # 1) Check below caption (standard IEEE/CVPR/NeurIPS booktabs table)
            rules_below = [
                r
                for r in h_rules
                if in_x_scope(r[0], r[2]) and r[1] >= cy1 - 4.0 and r[3] <= y_floor + 4.0
            ]
            if rules_below:
                tx0 = min(r[0] for r in rules_below)
                ty0 = min(r[1] for r in rules_below)
                tx1 = max(r[2] for r in rules_below)
                ty1 = max(r[3] for r in rules_below)
            else:
                # 2) Check above caption (bottom-captioned table)
                rules_above = [
                    r
                    for r in h_rules
                    if in_x_scope(r[0], r[2]) and r[1] >= y_ceiling - 4.0 and r[3] <= cy0 + 4.0
                ]
                if rules_above:
                    tx0 = min(r[0] for r in rules_above)
                    ty0 = min(r[1] for r in rules_above)
                    tx1 = max(r[2] for r in rules_above)
                    ty1 = max(r[3] for r in rules_above)
                else:
                    tx0, ty0, tx1, ty1 = cx0, cy1, cx1, cy1

            # Absorb tabular cell text blocks overlapping [ty0..ty1] (or immediately below caption up to y_floor)
            cell_snippets: list[str] = []
            search_y0 = min(ty0 - 6.0, cy1 - 2.0) if rules_below else (ty0 - 6.0)
            search_y1 = (ty1 + 6.0) if (rules_below or tx1 > cx0) else y_floor

            for ob in blocks:
                if ob is cb or ob["id"] in caption_ids or is_anchor_prose(ob):
                    continue
                ox0, oy0, ox1, oy1 = ob["bbox"]
                if in_x_scope(ox0, ox1) and oy0 >= search_y0 and oy1 <= max(search_y1, ty1 + 8.0):
                    tx0, ty0 = min(tx0, ox0), min(ty0, oy0)
                    tx1, ty1 = max(tx1, ox1), max(ty1, oy1)
                    consumed_ids.add(ob["id"])
                    cell_snippets.append(_clean_spaces(" ".join(l["text"] for l in ob["lines"])))

            if ty1 > ty0 + 8.0:
                crop_box = (tx0, ty0, tx1, ty1)
            table_hint_text = " | ".join(cell_snippets)[:450]

        safe_slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
        media_id = f"p{page_num}_{safe_slug}_{seq_idx}"
        img_filename = f"{media_id}.png"

        if crop_box is not None:
            pad = 6.0
            top_y = max(0.0, crop_box[1] - pad)
            bot_y = min(ph, crop_box[3] + pad)
            # Prevent caption text pixels from bleeding into visual crop edge
            if crop_box[1] >= cy0:
                top_y = max(cy1 + 1.0, top_y)
            elif crop_box[3] <= cy1:
                bot_y = min(cy0 - 1.5, bot_y)

            clip_rect = fitz.Rect(
                max(0.0, crop_box[0] - pad),
                top_y,
                min(pw, crop_box[2] + pad),
                max(top_y + 8.0, bot_y),
            )
            union_x0 = min(cx0, clip_rect.x0)
            union_y0 = min(cy0, clip_rect.y0)
            union_x1 = max(cx1, clip_rect.x1)
            union_y1 = max(cy1, clip_rect.y1)
        else:
            clip_rect = fitz.Rect(
                max(0.0, cx0 - 4.0),
                max(0.0, cy0 - 4.0),
                min(pw, cx1 + 4.0),
                min(ph, cy1 + 4.0),
            )
            union_x0, union_y0, union_x1, union_y1 = cx0, cy0, cx1, cy1

        try:
            pix = page.get_pixmap(clip=clip_rect, dpi=200 if kind == "table" else 180)
            pix.save(str(out_media_dir / img_filename))
        except Exception:
            img_filename = ""

        norm_union = BBox(
            x0=round(max(0.0, min(1.0, union_x0 / pw)), 4),
            y0=round(max(0.0, min(1.0, union_y0 / ph)), 4),
            x1=round(max(0.0, min(1.0, union_x1 / pw)), 4),
            y1=round(max(0.0, min(1.0, union_y1 / ph)), 4),
        )

        asset = MediaAsset(
            media_id=media_id,
            kind=kind,
            label=label,
            page=page_num,
            caption=cap_clean,
            image_filename=img_filename,
            bbox=norm_union,
        )
        media_assets.append(asset)
        cb["media_asset"] = asset
        cb["table_hint"] = table_hint_text

    remaining = [b for b in blocks if b["id"] not in consumed_ids]
    return _sort_blocks_reading_order(remaining, pw), media_assets


def find_media_citing_sentences(label: str, kind: str, prose_texts: list[str], max_hits: int = 4) -> list[str]:
    """Find sentences in the paper body that explicitly reference `Fig. N` / `Figure N` or `Table N`."""
    m_num = re.search(r"([A-Za-z]?\d+[A-Za-z]?)", label or "")
    if not m_num:
        return []
    num = m_num.group(1)
    if kind == "table":
        pat = re.compile(rf"\b(?:Tab\.?|Tabs\.?|Table|Tables)\s*{re.escape(num)}(?![0-9])", re.IGNORECASE)
    else:
        pat = re.compile(rf"\b(?:Fig\.?|Figs\.?|Figure|Figures)\s*{re.escape(num)}(?![0-9])", re.IGNORECASE)

    hits: list[str] = []
    seen: set[str] = set()
    for block in prose_texts:
        if block.startswith("[[MEDIA "):
            continue
        for raw_sent in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])", block):
            s = _clean_spaces(raw_sent)
            if len(s) < 25 or len(s) > 520:
                continue
            if FIG_CAPTION_RE.match(s) or TAB_CAPTION_RE.match(s):
                continue
            if pat.search(s):
                key = s[:80].lower()
                if key not in seen:
                    seen.add(key)
                    hits.append(s)
                    if len(hits) >= max_hits:
                        return hits
    return hits


def extract_pdf_region_text(pdf_path: Path, page_num: int, bbox: Optional[BBox]) -> str:
    """Extract interior labels/numbers from a Figure/Table region on `source.pdf` for on-demand insight generation."""
    if bbox is None or not pdf_path.exists():
        return ""
    doc = fitz.open(str(pdf_path))
    try:
        idx = max(0, min(len(doc) - 1, page_num - 1))
        page = doc[idx]
        pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
        rect = fitz.Rect(bbox.x0 * pw, bbox.y0 * ph, bbox.x1 * pw, bbox.y1 * ph)
        blocks = page.get_text("blocks", clip=rect)
        parts: list[str] = []
        for b in blocks:
            if len(b) >= 5 and isinstance(b[4], str):
                txt = _clean_spaces(b[4])
                if txt and not FIG_CAPTION_RE.match(txt) and not TAB_CAPTION_RE.match(txt):
                    parts.append(txt)
        return " | ".join(parts)[:650]
    except Exception:
        return ""
    finally:
        doc.close()


def extract_pdf_regions_batch(
    pdf_path: Optional[Path],
    targets: list[tuple[str, int, Optional[BBox]]],
) -> dict[str, str]:
    """Extract interior labels/numbers for multiple Figure/Table regions opening `source.pdf` only once."""
    if pdf_path is None or not pdf_path.exists() or not targets:
        return {}
    out: dict[str, str] = {}
    doc = fitz.open(str(pdf_path))
    try:
        for sid, page_num, bbox in targets:
            if bbox is None:
                out[sid] = ""
                continue
            try:
                idx = max(0, min(len(doc) - 1, page_num - 1))
                page = doc[idx]
                pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
                rect = fitz.Rect(bbox.x0 * pw, bbox.y0 * ph, bbox.x1 * pw, bbox.y1 * ph)
                blocks = page.get_text("blocks", clip=rect)
                parts: list[str] = []
                for b in blocks:
                    if len(b) >= 5 and isinstance(b[4], str):
                        txt = _clean_spaces(b[4])
                        if txt and not FIG_CAPTION_RE.match(txt) and not TAB_CAPTION_RE.match(txt):
                            parts.append(txt)
                out[sid] = " | ".join(parts)[:650]
            except Exception:
                out[sid] = ""
        return out
    finally:
        doc.close()


_GENERIC_FRAMEWORK_REPOS = {
    "pytorch/pytorch",
    "tensorflow/tensorflow",
    "google/jax",
    "huggingface/transformers",
    "huggingface/diffusers",
    "huggingface/peft",
    "huggingface/accelerate",
    "huggingface/datasets",
    "open-mmlab/mmdetection",
    "open-mmlab/mmsegmentation",
    "facebookresearch/detectron2",
    "ultralytics/ultralytics",
    "langchain-ai/langchain",
    "vllm-project/vllm",
}

_TITLE_STOP_TOKENS = {
    "the", "and", "for", "with", "from", "via", "using", "based", "towards", "toward",
    "into", "over", "under", "learning", "deep", "neural", "network", "networks",
    "model", "models", "modeling", "large", "language", "vision", "image", "images",
    "video", "data", "analysis", "framework", "method", "methods", "efficient",
    "fast", "novel", "multi", "multimodal", "self", "supervised", "pre", "training",
    "generation", "prediction", "classification", "segmentation", "detection",
}

_TEXT_RESOURCE_URL_RE = re.compile(
    r"(?:https?://(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|codeocean\.com|huggingface\.co|hf\.co|zenodo\.org|figshare\.com|osf\.io|[a-z0-9\-]+\.github\.io|[a-z0-9\-]+\.gitlab\.io)/[^\s<>\"'\]\)\}]+)"
    r"|(?:(?<![A-Za-z0-9@/])(?:github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|hf\.co)/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-/]+)",
    re.IGNORECASE,
)

_AUTHOR_OWNERSHIP_CUES = (
    "our code",
    "our source code",
    "our implementation",
    "our model",
    "our models",
    "our dataset",
    "our data",
    "our project",
    "our repository",
    "our weights",
    "our checkpoints",
    "we release",
    "we open-source",
    "we open source",
    "we make our",
    "we provide our",
    "code we used",
    "code is available",
    "source code is available",
    "implementation is available",
    "models are available",
    "weights are available",
    "data and code",
    "code and data",
    "code and models",
    "code and weights",
    "publicly available at",
    "publicly released",
    "open-sourced at",
    "code availability",
    "data availability",
    "reproducibility",
    "project page",
    "project website",
    "official implementation",
    "code:",
    "github:",
    "huggingface:",
    "hugging face:",
)

_THIRD_PARTY_BASELINE_CUES = (
    "adapted from",
    "borrowed from",
    "downloaded from",
    "obtained from",
    "taken from",
    "retrieved from",
    "baseline implementation",
    "existing package",
    "following the implementation",
)


def normalize_and_classify_resource_url(raw_url: str) -> Optional[tuple[str, str, str]]:
    """
    Validate and canonicalize a candidate Code / Hugging Face / Dataset / Project URL.
    Returns `(kind, display_label, canonical_url)` or `None` if invalid/boilerplate.
    """
    if not raw_url:
        return None
    u = raw_url.strip().rstrip(".,;:!?)>]}'\"”’")
    u = u.lstrip("(<[{'\"“‘")
    if not u:
        return None
    if not u.lower().startswith(("http://", "https://")):
        u = "https://" + u

    try:
        sp = urlsplit(u)
    except Exception:
        return None

    host = (sp.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = re.sub(r"/+", "/", sp.path or "").rstrip("/")
    parts = [p for p in path.split("/") if p]

    # 1. Hugging Face (Models / Datasets / Spaces / Collections / Org)
    if host in ("huggingface.co", "hf.co"):
        if not parts:
            return None
        first = parts[0].lower()
        if first in ("papers", "docs", "blog", "join", "login", "pricing", "settings", "tasks", "chat"):
            return None
        if first in ("datasets", "spaces", "collections"):
            if len(parts) < 2:
                return None
            slug = "/".join(parts[1:3])
            return ("huggingface", f"{first}/{slug}", f"https://huggingface.co/{first}/{slug}")
        slug = "/".join(parts[:2])
        if len(parts) == 1 and len(parts[0]) < 3:
            return None
        return ("huggingface", slug, f"https://huggingface.co/{slug}")

    # 2. Code Repositories (GitHub / GitLab / Bitbucket / Code Ocean)
    if host in ("github.com", "gitlab.com", "bitbucket.org"):
        if not parts:
            return None
        owner = parts[0]
        if owner.lower() in {
            "orgs", "topics", "features", "about", "pricing", "login",
            "settings", "site", "sponsors", "explore", "marketplace", "trending",
        }:
            return None
        if len(parts) == 1:
            if len(owner) < 3:
                return None
            return ("code", owner, f"https://{host}/{owner}")
        repo = re.sub(r"\.git$", "", parts[1], flags=re.IGNORECASE)
        if not repo:
            return None
        # Preserve monorepo subdirectories (e.g. google-research/google-research/tree/master/project)
        if len(parts) >= 4 and parts[2].lower() == "tree":
            sub_path = "/".join(parts[2:])
            leaf = parts[-1]
            return ("code", f"{owner}/{leaf}", f"https://{host}/{owner}/{repo}/{sub_path}")
        return ("code", f"{owner}/{repo}", f"https://{host}/{owner}/{repo}")

    if host == "codeocean.com" and parts and parts[0].lower() == "capsule":
        slug = "/".join(parts[:2])
        return ("code", "Code Ocean", f"https://codeocean.com/{slug}")

    # 3. Dataset Archives (Zenodo / Figshare / OSF)
    if host in ("zenodo.org", "figshare.com", "osf.io") and parts:
        return ("dataset", host.split(".")[0].capitalize(), f"https://{host}{path}")

    # 4. Official Project Pages (*.github.io / *.gitlab.io)
    if (host.endswith(".github.io") or host.endswith(".gitlab.io")):
        sub = host.split(".")[0]
        if sub and sub not in ("pages", "www"):
            lbl = f"{host}{path}" if path else host
            return ("project", lbl[:42], f"https://{host}{path}")

    return None


def _distinctive_title_tokens(title: str) -> set[str]:
    tokens: set[str] = set()
    if not title:
        return tokens
    # Capture acronyms / method names before colon (e.g., "MCToGene: ...", "SAMP-Net: ...")
    head = title.split(":", 1)[0].strip()
    if 3 <= len(head) <= 24:
        clean_head = re.sub(r"[^a-z0-9]+", "", head.lower())
        if len(clean_head) >= 3 and clean_head not in _TITLE_STOP_TOKENS:
            tokens.add(clean_head)
    for raw_w in re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]{2,}", title):
        w = raw_w.lower().replace("-", "")
        if len(w) >= 4 and w not in _TITLE_STOP_TOKENS:
            tokens.add(w)
    return tokens


def _extract_links_from_fitz_doc(
    doc: fitz.Document,
    title: str = "",
    filename: str = "",
) -> tuple[Optional[str], list[PaperResourceLink]]:
    """Extract paper's own arXiv ID and author-provided Code / Hugging Face / Project links from an open fitz.Document."""
    arxiv_id: Optional[str] = None
    if len(doc) > 0:
        p1_raw = doc[0].get_text("text") or ""
        m_arx = ARXIV_RE.search(p1_raw)
        if m_arx:
            arxiv_id = re.sub(r"v\d+$", "", m_arx.group(1), flags=re.IGNORECASE)
    if not arxiv_id and filename:
        m_fn = re.search(r"(?:^|arxiv[_-]|/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$", Path(filename).name, re.IGNORECASE)
        if m_fn:
            arxiv_id = m_fn.group(1)

    # Locate References boundary `(ref_page_idx, ref_y0)` so bibliography URLs are excluded
    ref_page_idx: Optional[int] = None
    ref_y0: float = 0.0
    for p_idx in range(len(doc)):
        for b in doc[p_idx].get_text("blocks"):
            if len(b) < 5 or not isinstance(b[4], str):
                continue
            b_txt = _clean_spaces(b[4])
            if b_txt and len(b_txt) <= 85 and REF_HEADING_RE.match(b_txt):
                ref_page_idx = p_idx
                ref_y0 = float(b[1])
                break
        if ref_page_idx is not None:
            break

    title_tokens = _distinctive_title_tokens(title)
    best_by_url: dict[str, tuple[int, int, PaperResourceLink]] = {}  # canonical_url -> (score, order, link)
    order_seq = 0

    for p_idx in range(len(doc)):
        if ref_page_idx is not None and p_idx > ref_page_idx:
            break
        page = doc[p_idx]
        pw, ph = max(page.rect.width, 1.0), max(page.rect.height, 1.0)
        y_limit = (ref_y0 - 3.0) if (ref_page_idx == p_idx) else (ph + 10.0)

        candidates_on_page: list[tuple[str, str]] = []  # (raw_url, surrounding_context)

        # 1) Exact PDF hyperlink annotations (`\href{...}`, `\url{...}`)
        for lk in page.get_links():
            uri = str(lk.get("uri") or "").strip()
            if not uri:
                continue
            from_rect = lk.get("from")
            if from_rect is not None and float(from_rect.y0) >= y_limit:
                continue
            ctx = ""
            if from_rect is not None:
                ctx_rect = fitz.Rect(
                    0.0,
                    max(0.0, float(from_rect.y0) - 28.0),
                    pw,
                    min(y_limit, float(from_rect.y1) + 28.0),
                )
                ctx = _clean_spaces(page.get_text("text", clip=ctx_rect) or "")
            candidates_on_page.append((uri, ctx))

        # 2) Plain-text URLs (repairing PDF column line-wraps inside URLs)
        clip_area = fitz.Rect(0.0, 0.0, pw, max(1.0, y_limit))
        raw_page_txt = page.get_text("text", clip=clip_area) or ""
        repaired_txt = re.sub(
            r"(https?://[^\s\n]*[/\-_.])\s*\n\s*([A-Za-z0-9])",
            r"\1\2",
            raw_page_txt,
        )
        repaired_txt = re.sub(
            r"((?:github\.com|gitlab\.com|huggingface\.co|hf\.co)/[A-Za-z0-9_.\-]*[/\-_])\s*\n\s*([A-Za-z0-9])",
            r"\1\2",
            repaired_txt,
            flags=re.IGNORECASE,
        )
        for m_url in _TEXT_RESOURCE_URL_RE.finditer(repaired_txt):
            u_str = m_url.group(0)
            s_pos = max(0, m_url.start() - 160)
            e_pos = min(len(repaired_txt), m_url.end() + 120)
            ctx = _clean_spaces(repaired_txt[s_pos:e_pos])
            candidates_on_page.append((u_str, ctx))

        for raw_u, ctx in candidates_on_page:
            classified = normalize_and_classify_resource_url(raw_u)
            if classified is None:
                continue
            kind, label, canonical_url = classified
            slug_compact = re.sub(r"[^a-z0-9]+", "", label.lower())
            ctx_low = (ctx or "").lower()

            has_title_match = any(tok in slug_compact for tok in title_tokens)
            if label.lower() in _GENERIC_FRAMEWORK_REPOS and not has_title_match:
                continue

            score = 0
            if p_idx == 0:
                score += 4
            elif p_idx == 1:
                score += 1
            if has_title_match:
                score += 5
            if any(cue in ctx_low for cue in _AUTHOR_OWNERSHIP_CUES):
                score += 4
            elif "available at" in ctx_low or "released at" in ctx_low or "open-source" in ctx_low:
                score += 2
            if kind == "huggingface" and p_idx <= 2:
                score += 2

            if any(neg in ctx_low for neg in _THIRD_PARTY_BASELINE_CUES) and "our " not in ctx_low:
                score -= 5

            if score < 2:
                continue

            key = canonical_url.lower()
            prev = best_by_url.get(key)
            if prev is None or score > prev[0]:
                order_seq += 1
                best_by_url[key] = (
                    score,
                    prev[1] if prev is not None else order_seq,
                    PaperResourceLink(
                        kind=kind,
                        label=label,
                        url=canonical_url,
                        source="pdf",
                    ),
                )

    kind_rank = {"code": 0, "huggingface": 1, "project": 2, "dataset": 3}
    sorted_items = sorted(
        best_by_url.values(),
        key=lambda item: (kind_rank.get(item[2].kind, 9), -item[0], item[1]),
    )
    return arxiv_id, [item[2] for item in sorted_items[:6]]


def extract_author_resource_links_from_pdf(
    pdf_source: Union[bytes, Path, str],
    title: str = "",
    filename: str = "",
) -> tuple[Optional[str], list[PaperResourceLink]]:
    """Open `pdf_source` (bytes or file path) and extract `(arxiv_id, resource_links)`."""
    if isinstance(pdf_source, (bytes, bytearray)):
        doc = fitz.open(stream=bytes(pdf_source), filetype="pdf")
    else:
        p = Path(pdf_source)
        if not p.exists():
            return None, []
        doc = fitz.open(str(p))
    try:
        return _extract_links_from_fitz_doc(doc, title=title, filename=filename)
    finally:
        doc.close()


def extract_pdf_prebundle(
    pdf_bytes: bytes,
    filename: str,
    max_chunk_chars: int = 4600,
) -> tuple[PaperDocument, list[PdfLineRecord], list[RawBodyChunk], list[MediaAsset]]:
    """
    Fast (<0.5s) pre-extraction for AI-first pipeline:
    1) Strips watermarks/headers and extracts column-ordered body paragraphs + Figure/Table crops
    2) Extracts all PDF line bounding boxes so AI-segmented sentences map back to exact PDF highlights
    3) Parses the References section for instant Stage-1 citation lookup
    """
    paper_id = compute_paper_id(pdf_bytes)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    try:
        all_pages_blocks: list[tuple[int, list[dict]]] = []
        all_media_assets: list[MediaAsset] = []

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            p_blocks = _extract_page_blocks(page)
            p_blocks, p_media = _detect_and_crop_page_media(
                page, page_idx + 1, p_blocks, paper_id
            )
            all_pages_blocks.append((page_idx + 1, p_blocks))
            all_media_assets.extend(p_media)

        first_blocks = all_pages_blocks[0][1] if all_pages_blocks else []
        title = _detect_title(doc, first_blocks, filename)
        detected_arxiv_id, detected_links = _extract_links_from_fitz_doc(
            doc, title=title, filename=filename
        )

        in_references = False
        ref_lines: list[tuple[float, str]] = []
        pdf_lines: list[PdfLineRecord] = []
        body_paragraphs: list[tuple[int, str]] = []

        for page_num, p_blocks in all_pages_blocks:
            for b in p_blocks:
                block_text = _clean_spaces(" ".join(l["text"] for l in b["lines"]))
                if not block_text:
                    continue

                is_short = len(b["lines"]) <= 2 and len(block_text) <= 85
                if is_short and REF_HEADING_RE.match(block_text):
                    in_references = True
                    continue
                if in_references and is_short and POST_REF_HEADING_RE.match(block_text):
                    break

                if in_references:
                    for ln in b["lines"]:
                        ref_lines.append((ln["bbox"][0], ln["text"]))
                    continue

                media_asset: Optional[MediaAsset] = b.get("media_asset")
                if media_asset is not None:
                    hint = b.get("table_hint") or ""
                    hint_suffix = f" [INTERNAL_LABELS: {hint}]" if hint else ""
                    marker = (
                        f'[[MEDIA id="{media_asset.media_id}" kind="{media_asset.kind}" '
                        f'label="{media_asset.label}" page={page_num}]] '
                        f"{media_asset.caption}{hint_suffix}"
                    )
                    body_paragraphs.append((page_num, marker))
                    continue

                for ln in b["lines"]:
                    nt = _norm_words(ln["text"])
                    if nt:
                        pdf_lines.append(
                            PdfLineRecord(
                                page=page_num,
                                text=ln["text"],
                                norm_text=nt,
                                bbox=ln["norm_bbox"],
                            )
                        )

                # Join lines in paragraph cleanly (de-hyphenating line breaks)
                joined_sents = _split_block_into_sentences(b["lines"])
                if joined_sents:
                    para_str = " ".join(s for s, _ in joined_sents).strip()
                else:
                    para_str = block_text
                if para_str:
                    body_paragraphs.append((page_num, para_str))

        references = _parse_reference_lines(ref_lines)

        # Enrich [[MEDIA ...]] markers with body sentences across the paper that discuss that Figure/Table
        prose_only = [txt for _, txt in body_paragraphs if not txt.startswith("[[MEDIA ")]
        enriched_paragraphs: list[tuple[int, str]] = []
        for p_num, txt in body_paragraphs:
            if txt.startswith("[[MEDIA "):
                m_meta = re.match(
                    r'^\[\[MEDIA id="[^"]+" kind="(figure|table)" label="([^"]+)" page=\d+\]\]',
                    txt,
                )
                if m_meta:
                    m_kind, m_label = m_meta.group(1), m_meta.group(2)
                    mentions = find_media_citing_sentences(m_label, m_kind, prose_only, max_hits=3)
                    if mentions:
                        txt = f"{txt} [BODY_CLAIMS: {' / '.join(mentions)[:650]}]"
            enriched_paragraphs.append((p_num, txt))
        body_paragraphs = enriched_paragraphs

        # Group body paragraphs into ~4,600-char chunks with [Page X] tags
        raw_chunks: list[RawBodyChunk] = []
        buf_parts: list[str] = []
        buf_len = 0
        chunk_start_page = 1
        chunk_end_page = 1
        last_marked_page = 0

        def flush_chunk() -> None:
            nonlocal buf_len
            if not buf_parts:
                return
            raw_chunks.append(
                RawBodyChunk(
                    chunk_index=len(raw_chunks),
                    start_page=chunk_start_page,
                    end_page=chunk_end_page,
                    text="\n\n".join(buf_parts),
                )
            )
            buf_parts.clear()
            buf_len = 0

        for p_num, para in body_paragraphs:
            if not buf_parts:
                chunk_start_page = p_num
                last_marked_page = 0
            if buf_len + len(para) > max_chunk_chars and buf_parts:
                flush_chunk()
                chunk_start_page = p_num
                last_marked_page = 0

            if p_num != last_marked_page:
                entry = f"[Page {p_num}]\n{para}"
                last_marked_page = p_num
            else:
                entry = para

            buf_parts.append(entry)
            buf_len += len(entry) + 2
            chunk_end_page = p_num

        flush_chunk()

        paper_doc = PaperDocument(
            paper_id=paper_id,
            title=title,
            filename=filename,
            page_count=len(doc),
            format_version=3,
            arxiv_id=detected_arxiv_id,
            resource_links=detected_links,
            resource_links_checked=False,
            sections=[],
            sentences=[],
            references=references,
            ai_status="pending",
            ai_progress=0,
            ai_total_chunks=len(raw_chunks),
            ai_completed_chunks=0,
            created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        )
        return paper_doc, pdf_lines, raw_chunks, all_media_assets
    finally:
        doc.close()


def _strip_latex_for_matching(s: str) -> str:
    """Strip LaTeX macro names (\\mathbb, \\times, etc.) so AI LaTeX-enriched sentences still align with PDF lines."""
    if not s or "\\" not in s:
        return s or ""
    return re.sub(r"\\[a-zA-Z]+", " ", s)


def match_sentence_to_pdf_lines(
    en_text: str,
    page_hint: int,
    pdf_lines: list[PdfLineRecord],
) -> tuple[int, list[BBox]]:
    """Map an AI-cleaned English sentence back to its exact PDF page and line bounding boxes."""
    target_words = _norm_words(_strip_latex_for_matching(en_text)).split()
    if not target_words or not pdf_lines:
        return max(1, page_hint), []

    target_set = set(target_words)
    # Candidate lines on page_hint first, plus adjacent pages
    candidates = [
        ln for ln in pdf_lines if abs(ln.page - page_hint) <= 1
    ] or pdf_lines

    best_score = 0.0
    best_slice: list[PdfLineRecord] = []

    # Estimate how many PDF lines this sentence spans (1 to 6 lines)
    max_span = min(6, max(2, (len(en_text) // 55) + 2))
    n = len(candidates)

    first_anchor = target_words[0]
    second_anchor = target_words[1] if len(target_words) > 1 else ""

    for i in range(n):
        ln0 = candidates[i]
        # Quick prefilter: first line should contain at least one early word or overlap
        w0 = ln0.norm_text.split()
        if not w0:
            continue
        if first_anchor not in w0 and (not second_anchor or second_anchor not in w0):
            # Allow fallback check if overlap >= 2 words
            if len(target_set.intersection(w0)) < 2:
                continue

        combined_words: list[str] = []
        cur_page = ln0.page
        for span_len in range(1, max_span + 1):
            j = i + span_len - 1
            if j >= n or candidates[j].page != cur_page:
                break
            combined_words.extend(candidates[j].norm_text.split())
            if not combined_words:
                continue
            inter = sum(1 for w in target_words if w in set(combined_words))
            recall = inter / len(target_words)
            precision = inter / max(len(combined_words), 1)
            score = (recall * 0.72) + (precision * 0.28)
            if score > best_score:
                best_score = score
                best_slice = candidates[i : j + 1]

    if best_score >= 0.38 and best_slice:
        return best_slice[0].page, [ln.bbox for ln in best_slice]
    return max(1, page_hint), []


def build_ai_sentence_item(
    index: int,
    page_hint: int,
    section: str,
    en_text: str,
    ko_text: str,
    slash_en: Optional[str],
    pdf_lines: list[PdfLineRecord],
    references: dict[str, ReferenceEntry],
    auth_year_idx: Optional[dict[str, str]] = None,
    insight: Optional[str] = None,
) -> SentenceItem:
    if auth_year_idx is None:
        auth_year_idx = _build_author_year_index(references)
    matched_page, bboxes = match_sentence_to_pdf_lines(en_text, page_hint, pdf_lines)
    citations = _extract_inline_citations(en_text, references, auth_year_idx)
    return SentenceItem(
        id=f"s_{index:04d}",
        index=index,
        page=matched_page,
        section=section.strip() or "Overview",
        text=en_text.strip(),
        ko=ko_text.strip(),
        insight=(insight.strip() if insight else None),
        slash_en=(slash_en.strip() if slash_en else None),
        bboxes=bboxes,
        citations=citations,
    )
