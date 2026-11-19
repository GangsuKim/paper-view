from __future__ import annotations

import asyncio
import hashlib
import re
import time
import xml.etree.ElementTree as ET
from difflib import SequenceMatcher
from typing import Optional
from urllib.parse import quote

import httpx

from .models import (
    CitationMetadataResponse,
    CitingSentenceSnippet,
    PaperDocument,
    ReferenceEntry,
)
from .pdf_parser import (
    ARXIV_RE,
    extract_key_text_from_cited_pdf,
    extract_main_figure_from_cited_pdf,
)
from .storage import (
    DOWNLOAD_CACHE_DIR,
    ensure_dirs,
    load_citation_summaries,
    update_paper_doc,
)

USER_AGENT = "PaperViewAcademicReader/1.0 (https://github.com/paper-view; mailto:contact@paperview.org)"

_TITLE_STOPWORDS = {
    "the", "and", "for", "with", "from", "via", "towards", "toward",
    "using", "based", "into", "over", "under", "study", "analysis",
}

_ARXIV_ATOM_LOCK = asyncio.Lock()
_LAST_ARXIV_ATOM_TS: float = 0.0


def _norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _compact_title(s: str) -> str:
    """Alphanumeric-only title string (handles PDF line-break hyphenation merges like identityobfuscated == identity-obfuscated)."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _titles_match(a: str, b: str, threshold: float = 0.62) -> bool:
    na, nb = _norm_title(a), _norm_title(b)
    if not na or not nb:
        return False
    if na in nb or nb in na:
        return True
    ca, cb = _compact_title(a), _compact_title(b)
    if ca and cb and (ca in cb or cb in ca):
        return True
    return max(
        SequenceMatcher(None, na, nb).ratio(),
        SequenceMatcher(None, ca, cb).ratio(),
    ) >= threshold


def _extract_candidate_title_from_entry(entry: ReferenceEntry) -> str:
    """Extract the cleanest paper title from `entry.title` or IEEE/APA `entry.raw_text` for arXiv search."""
    raw = (entry.raw_text or "").strip()
    # Check quoted title in IEEE style: Author, “Title,” in Proc. IEEE ...
    m_quote = re.search(r"[“\"]([^”\"]{12,240})[”\"]", raw)
    if m_quote:
        qt = m_quote.group(1).strip(" ,.;:")
        if len(qt) >= 12:
            return qt

    t = (entry.title or "").strip(" ,.;:")
    # Strip accidental watermark suffix if present in legacy cached entries
    t = re.sub(r"\s*FOR\s+REVIEW\s+ONLY.*$", "", t, flags=re.IGNORECASE).strip()
    if t and not t.lower().startswith("reference [") and len(t) >= 10:
        return t

    # Fallback: take longest period-delimited segment that doesn't look like venue/authors
    segs = [s.strip() for s in re.split(r"\.\s+", raw) if len(s.strip()) >= 12]
    for seg in segs[1:]:
        low = seg.lower()
        if not low.startswith(("in ", "proc", "ieee", "vol", "pp", "http", "doi")):
            return seg
    return t or raw[:150]


def _author_surname_overlap(entry: ReferenceEntry, cand_authors: list[str]) -> bool:
    if not cand_authors:
        return False
    cand_low = " ".join(cand_authors).lower()
    src_text = " ".join(entry.authors) if entry.authors else (entry.raw_text or "")[:90]
    surnames = [
        tok.lower()
        for tok in re.findall(r"[A-Z][A-Za-z'’-]{2,}", src_text)
        if tok.lower() not in {"proc", "ieee", "cvpr", "iccv", "eccv", "icassp", "miccai", "the", "and"}
    ]
    return any(sn in cand_low for sn in surnames[:4])


def _is_confident_arxiv_title_match(
    query_title: str,
    cand_title: str,
    entry: ReferenceEntry,
    cand_authors: list[str],
    cand_year: Optional[int],
) -> bool:
    na, nb = _norm_title(query_title), _norm_title(cand_title)
    ca, cb = _compact_title(query_title), _compact_title(cand_title)
    if not ca or not cb or len(cb) < 10:
        return False

    sim_spaced = SequenceMatcher(None, na, nb).ratio()
    sim_compact = SequenceMatcher(None, ca, cb).ratio()
    best_sim = max(sim_spaced, sim_compact)

    if best_sim >= 0.82:
        return True

    # Prefix before ':' match (handles slight subtitle change between arXiv preprint & IEEE camera-ready)
    prefix_a = _compact_title(query_title.split(":")[0])
    prefix_b = _compact_title(cand_title.split(":")[0])
    if len(prefix_a) >= 18 and prefix_a == prefix_b:
        words_a = set(na.split())
        words_b = set(nb.split())
        jaccard = len(words_a & words_b) / max(1, len(words_a | words_b))
        if jaccard >= 0.55 or _author_surname_overlap(entry, cand_authors):
            return True

    # Borderline high similarity (0.72..0.82) confirmed by matching author surname & year proximity
    if best_sim >= 0.72 and _author_surname_overlap(entry, cand_authors):
        if entry.year and cand_year and abs(entry.year - cand_year) > 3:
            return False
        return True

    return False


def _format_datacite_creator_name(raw_name: str) -> str:
    s = (raw_name or "").strip()
    if "," in s:
        parts = [p.strip() for p in s.split(",", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            return f"{parts[1]} {parts[0]}"
    return s


def _apply_arxiv_match_to_entry(
    entry: ReferenceEntry,
    arxiv_id: str,
    title: Optional[str] = None,
    authors: Optional[list[str]] = None,
    year: Optional[int] = None,
    abstract: Optional[str] = None,
) -> None:
    base_id = re.sub(r"v\d+$", "", arxiv_id.strip())
    entry.arxiv_id = base_id
    if title and title.lower() != "error":
        entry.title = title
    if authors:
        entry.authors = authors
    if year and not entry.year:
        entry.year = year
    if abstract and len(abstract.strip()) >= 40:
        entry.abstract = abstract.strip()

    # Always prioritize arXiv URL & PDF so IEEE / paywalled venues never block viewing or full-PDF summarization!
    entry.url = f"https://arxiv.org/abs/{base_id}"
    entry.pdf_url = f"https://arxiv.org/pdf/{base_id}.pdf"
    if not entry.venue:
        entry.venue = f"arXiv:{base_id}"


async def _enrich_from_datacite_arxiv_id(client: httpx.AsyncClient, entry: ReferenceEntry) -> bool:
    """Fast (<300ms) metadata + abstract lookup for a known arXiv ID via official DataCite 10.48550 registry."""
    if not entry.arxiv_id:
        return False
    base_id = re.sub(r"v\d+$", "", entry.arxiv_id.strip())
    try:
        r = await client.get(
            f"https://api.datacite.org/dois/10.48550/arxiv.{quote(base_id)}",
            timeout=6.0,
        )
        if r.status_code != 200:
            return False
        attrs = (r.json().get("data") or {}).get("attributes") or {}
        titles = attrs.get("titles") or []
        cand_title = str(titles[0].get("title") or "").strip() if titles else None
        creators = [
            _format_datacite_creator_name(c.get("name") or "")
            for c in (attrs.get("creators") or [])[:12]
            if c.get("name")
        ]
        pub_year = int(attrs["publicationYear"]) if attrs.get("publicationYear") else None
        descs = attrs.get("descriptions") or []
        abs_txt = None
        for d in descs:
            if d.get("description"):
                abs_txt = re.sub(r"\s+", " ", str(d["description"])).strip()
                break
        _apply_arxiv_match_to_entry(entry, base_id, cand_title, creators, pub_year, abs_txt)
        return True
    except Exception:
        return False


async def _search_arxiv_by_title_datacite(
    client: httpx.AsyncClient,
    entry: ReferenceEntry,
    query_title: str,
) -> bool:
    """
    Search arXiv's official DataCite 10.48550 index by paper title first!
    Fast (~300ms), no 429 rate-limit, and returns arXiv ID + authors + full abstract in one call.
    """
    # Drop words > 16 chars first so PDF line-break merged words (e.g. 'identityobfuscated') don't block recall
    raw_words = re.findall(r"[A-Za-z0-9]{2,}", query_title)
    clean_words = [
        w for w in raw_words if w.lower() not in _TITLE_STOPWORDS and len(w) <= 16
    ]
    if len(clean_words) < 2:
        clean_words = [w for w in raw_words if len(w) >= 2]
    if not clean_words:
        return False

    q_str = " ".join(clean_words[:10])
    try:
        r = await client.get(
            "https://api.datacite.org/dois",
            params={
                "prefix": "10.48550",
                "query": f"titles.title:({q_str})",
                "page[size]": 6,
            },
            timeout=7.0,
        )
        if r.status_code != 200:
            return False

        for item in r.json().get("data") or []:
            attrs = item.get("attributes") or {}
            doi_str = str(attrs.get("doi") or "")
            m_aid = re.search(r"10\.48550/arxiv\.([0-9]{4}\.[0-9]{4,5}|[a-z\-]+/[0-9]{7})", doi_str, re.IGNORECASE)
            if not m_aid:
                continue
            arxiv_id = m_aid.group(1)
            titles = attrs.get("titles") or []
            cand_title = re.sub(r"\s+", " ", str(titles[0].get("title") or "")).strip() if titles else ""
            creators = [
                _format_datacite_creator_name(c.get("name") or "")
                for c in (attrs.get("creators") or [])[:12]
                if c.get("name")
            ]
            pub_year = int(attrs["publicationYear"]) if attrs.get("publicationYear") else None

            if _is_confident_arxiv_title_match(query_title, cand_title, entry, creators, pub_year):
                abs_txt = None
                for d in attrs.get("descriptions") or []:
                    if d.get("description"):
                        abs_txt = re.sub(r"\s+", " ", str(d["description"])).strip()
                        break
                _apply_arxiv_match_to_entry(entry, arxiv_id, cand_title, creators, pub_year, abs_txt)
                return True
        return False
    except Exception:
        return False


async def _enrich_or_search_arxiv_atom_api(
    client: httpx.AsyncClient,
    entry: ReferenceEntry,
    query_title: Optional[str] = None,
) -> bool:
    """Paced fallback to `export.arxiv.org/api/query` (respecting 3.1s spacing to avoid 429)."""
    global _LAST_ARXIV_ATOM_TS

    async with _ARXIV_ATOM_LOCK:
        elapsed = time.monotonic() - _LAST_ARXIV_ATOM_TS
        if elapsed < 3.1:
            await asyncio.sleep(3.1 - elapsed)

        try:
            if entry.arxiv_id:
                base_id = re.sub(r"v\d+$", "", entry.arxiv_id.strip())
                resp = await client.get(
                    f"https://export.arxiv.org/api/query?id_list={quote(base_id)}",
                    timeout=8.0,
                )
            elif query_title:
                words = [
                    w
                    for w in re.findall(r"[A-Za-z0-9]{3,}", query_title.lower())
                    if w not in _TITLE_STOPWORDS and len(w) <= 16
                ][:5]
                if len(words) < 2:
                    return False
                sq = "+AND+".join(f"ti:{quote(w)}" for w in words)
                resp = await client.get(
                    f"https://export.arxiv.org/api/query?search_query={sq}&max_results=5",
                    timeout=8.0,
                )
            else:
                return False
        except Exception:
            return False
        finally:
            _LAST_ARXIV_ATOM_TS = time.monotonic()

    if resp.status_code != 200 or not resp.text.lstrip().startswith("<"):
        return False

    try:
        root = ET.fromstring(resp.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for atom_entry in root.findall("atom:entry", ns):
            id_el = atom_entry.find("atom:id", ns)
            title_el = atom_entry.find("atom:title", ns)
            summary_el = atom_entry.find("atom:summary", ns)
            published_el = atom_entry.find("atom:published", ns)
            author_els = atom_entry.findall("atom:author/atom:name", ns)

            cand_title = (
                re.sub(r"\s+", " ", title_el.text).strip()
                if (title_el is not None and title_el.text)
                else ""
            )
            if not cand_title or cand_title.lower() == "error":
                continue

            cand_authors = [a.text.strip() for a in author_els if a.text]
            cand_year: Optional[int] = None
            if published_el is not None and published_el.text and len(published_el.text) >= 4:
                try:
                    cand_year = int(published_el.text[:4])
                except ValueError:
                    pass

            m_aid = ARXIV_RE.search(id_el.text or "") if id_el is not None else None
            cand_aid = re.sub(r"v\d+$", "", m_aid.group(1)) if m_aid else entry.arxiv_id
            if not cand_aid:
                continue

            if entry.arxiv_id or (
                query_title
                and _is_confident_arxiv_title_match(
                    query_title, cand_title, entry, cand_authors, cand_year
                )
            ):
                abs_txt = (
                    re.sub(r"\s+", " ", summary_el.text).strip()
                    if (summary_el is not None and summary_el.text)
                    else None
                )
                _apply_arxiv_match_to_entry(
                    entry, cand_aid, cand_title, cand_authors, cand_year, abs_txt
                )
                return True
        return False
    except Exception:
        return False


async def check_arxiv_first_for_entry(client: httpx.AsyncClient, entry: ReferenceEntry) -> bool:
    """
    Step 1 (ALWAYS FIRST): Check whether the cited paper exists on arXiv by its ID or Title!
    Prevents IEEE / paywalled conference citations from failing full-text access when an arXiv version exists.
    """
    entry.arxiv_checked = True

    if entry.arxiv_id:
        ok = await _enrich_from_datacite_arxiv_id(client, entry)
        if not ok or not entry.abstract:
            await _enrich_or_search_arxiv_atom_api(client, entry)
        return bool(entry.arxiv_id)

    query_title = _extract_candidate_title_from_entry(entry)
    if len(query_title) < 10:
        return False

    # 1. Fast official DataCite 10.48550 arXiv title search (~300ms)
    found = await _search_arxiv_by_title_datacite(client, entry, query_title)
    if found:
        return True

    # 2. Direct export.arxiv.org Atom API title search fallback
    found_atom = await _enrich_or_search_arxiv_atom_api(client, entry, query_title=query_title)
    return found_atom


def _reconstruct_openalex_abstract(inv_idx: Optional[dict]) -> Optional[str]:
    if not inv_idx or not isinstance(inv_idx, dict):
        return None
    pos_to_word: dict[int, str] = {}
    for word, positions in inv_idx.items():
        if isinstance(positions, list):
            for p in positions:
                if isinstance(p, int):
                    pos_to_word[p] = word
    if not pos_to_word:
        return None
    max_pos = max(pos_to_word.keys())
    words = [pos_to_word.get(i, "") for i in range(max_pos + 1)]
    return re.sub(r"\s+", " ", " ".join(w for w in words if w)).strip()


async def _enrich_from_crossref(client: httpx.AsyncClient, entry: ReferenceEntry) -> bool:
    """Fast fallback metadata lookup for non-arXiv IEEE / journal papers via Crossref."""
    try:
        item: Optional[dict] = None
        if entry.doi:
            r = await client.get(
                f"https://api.crossref.org/works/{quote(entry.doi, safe='/')}",
                timeout=6.0,
            )
            if r.status_code == 200:
                item = (r.json().get("message") or {})
        else:
            q_title = _extract_candidate_title_from_entry(entry)
            r = await client.get(
                "https://api.crossref.org/works",
                params={"query.title": q_title[:160], "rows": 3},
                timeout=6.0,
            )
            if r.status_code == 200:
                for cand in (r.json().get("message") or {}).get("items") or []:
                    tlist = cand.get("title") or []
                    ct = tlist[0] if tlist else ""
                    if ct and _titles_match(q_title, ct, 0.72):
                        item = cand
                        break

        if not item:
            return False

        tlist = item.get("title") or []
        if tlist and not entry.arxiv_id:
            entry.title = re.sub(r"\s+", " ", str(tlist[0])).strip()

        if not entry.authors:
            c_auths = []
            for a in (item.get("author") or [])[:10]:
                given = (a.get("given") or "").strip()
                fam = (a.get("family") or "").strip()
                full = f"{given} {fam}".strip()
                if full:
                    c_auths.append(full)
            if c_auths:
                entry.authors = c_auths

        if not entry.year:
            for date_key in ("published-print", "published-online", "issued", "created"):
                parts = ((item.get(date_key) or {}).get("date-parts") or [[]])[0]
                if parts and isinstance(parts[0], int):
                    entry.year = parts[0]
                    break

        containers = item.get("container-title") or []
        if containers and (not entry.venue or entry.venue.startswith("arXiv:")):
            # Keep venue informative (e.g. IEEE TMI) even if arXiv PDF is used!
            entry.venue = str(containers[0]).strip()

        c_doi = item.get("DOI")
        if c_doi and isinstance(c_doi, str):
            entry.doi = entry.doi or c_doi.strip()
            if not entry.url:
                entry.url = f"https://doi.org/{entry.doi}"

        if not entry.abstract and item.get("abstract"):
            raw_abs = re.sub(r"<[^>]+>", " ", str(item["abstract"]))
            raw_abs = re.sub(r"\s+", " ", raw_abs).strip()
            if len(raw_abs) >= 50:
                entry.abstract = raw_abs

        return True
    except Exception:
        return False


async def _enrich_from_openalex(client: httpx.AsyncClient, entry: ReferenceEntry) -> bool:
    try:
        work: Optional[dict] = None
        if entry.doi:
            resp = await client.get(
                f"https://api.openalex.org/works/https://doi.org/{quote(entry.doi, safe='/')}",
                timeout=6.0,
            )
            if resp.status_code == 200:
                work = resp.json()

        if work is None:
            search_q = _extract_candidate_title_from_entry(entry)
            resp = await client.get(
                "https://api.openalex.org/works",
                params={"search": search_q[:160], "per-page": 3},
                timeout=6.0,
            )
            if resp.status_code == 200:
                results = resp.json().get("results") or []
                for cand in results:
                    cand_title = cand.get("display_name") or cand.get("title") or ""
                    if _titles_match(search_q, cand_title, 0.65):
                        work = cand
                        break

        if not work:
            return False

        w_title = work.get("display_name") or work.get("title")
        if w_title and not entry.arxiv_id:
            entry.title = w_title

        if not entry.authors:
            auths = []
            for a in (work.get("authorships") or [])[:10]:
                name = ((a.get("author") or {}).get("display_name") or "").strip()
                if name:
                    auths.append(name)
            if auths:
                entry.authors = auths

        if work.get("publication_year") and not entry.year:
            entry.year = int(work["publication_year"])

        loc = work.get("primary_location") or {}
        src = loc.get("source") or {}
        if src.get("display_name"):
            entry.venue = src["display_name"]

        doi_val = work.get("doi")
        if doi_val and isinstance(doi_val, str):
            clean_doi = doi_val.replace("https://doi.org/", "").strip()
            entry.doi = entry.doi or clean_doi
            if not entry.url:
                entry.url = doi_val

        # Scan ALL locations (including secondary arXiv / PMC / institutional OA preprints!)
        all_locs = list(work.get("locations") or [])
        if work.get("best_oa_location"):
            all_locs.insert(0, work["best_oa_location"])
        oa = work.get("open_access") or {}
        candidate_urls = [oa.get("oa_url"), loc.get("pdf_url"), loc.get("landing_page_url")]
        for l_item in all_locs:
            if isinstance(l_item, dict):
                candidate_urls.append(l_item.get("pdf_url"))
                candidate_urls.append(l_item.get("landing_page_url"))

        for cu in candidate_urls:
            if not cu or not isinstance(cu, str):
                continue
            m_arx = ARXIV_RE.search(cu) or re.search(r"10\.48550/arxiv\.(\d{4}\.\d{4,5})", cu, re.IGNORECASE)
            if m_arx and not entry.arxiv_id:
                _apply_arxiv_match_to_entry(entry, m_arx.group(1))
                break
            if not entry.pdf_url and (cu.lower().endswith(".pdf") or "/pdf" in cu.lower()):
                entry.pdf_url = cu

        if not entry.abstract:
            abs_text = _reconstruct_openalex_abstract(work.get("abstract_inverted_index"))
            if abs_text:
                entry.abstract = abs_text

        return True
    except Exception:
        return False


async def _enrich_from_semantic_scholar(client: httpx.AsyncClient, entry: ReferenceEntry) -> bool:
    fields = "title,authors,year,venue,url,openAccessPdf,externalIds,abstract"
    try:
        paper_data: Optional[dict] = None
        if entry.arxiv_id:
            base_id = re.sub(r"v\d+$", "", entry.arxiv_id)
            r = await client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/ARXIV:{base_id}",
                params={"fields": fields},
                timeout=6.0,
            )
            if r.status_code == 200:
                paper_data = r.json()
        elif entry.doi:
            r = await client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/DOI:{entry.doi}",
                params={"fields": fields},
                timeout=6.0,
            )
            if r.status_code == 200:
                paper_data = r.json()
        else:
            q = _extract_candidate_title_from_entry(entry)[:160]
            r = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params={"query": q, "limit": 3, "fields": fields},
                timeout=6.0,
            )
            if r.status_code == 200:
                for cand in r.json().get("data") or []:
                    ct = cand.get("title") or ""
                    if _titles_match(q, ct, 0.65):
                        paper_data = cand
                        break

        if not paper_data:
            return False

        if paper_data.get("title") and not entry.arxiv_id:
            entry.title = paper_data["title"]
        s2_authors = [a.get("name") for a in (paper_data.get("authors") or []) if a.get("name")]
        if s2_authors and not entry.authors:
            entry.authors = s2_authors
        if paper_data.get("year") and not entry.year:
            entry.year = int(paper_data["year"])
        if paper_data.get("venue") and (not entry.venue or entry.venue.startswith("arXiv:")):
            entry.venue = paper_data["venue"]
        if paper_data.get("abstract") and not entry.abstract:
            entry.abstract = paper_data["abstract"]
        if paper_data.get("url") and not entry.url:
            entry.url = paper_data["url"]

        ext = paper_data.get("externalIds") or {}
        if ext.get("ArXiv") and not entry.arxiv_id:
            _apply_arxiv_match_to_entry(entry, str(ext["ArXiv"]))
        if ext.get("DOI") and not entry.doi:
            entry.doi = str(ext["DOI"])

        oa_pdf = (paper_data.get("openAccessPdf") or {}).get("url")
        if oa_pdf and not entry.pdf_url:
            entry.pdf_url = oa_pdf

        return True
    except Exception:
        return False


def collect_citing_sentences(doc: PaperDocument, ref_key: str) -> list[CitingSentenceSnippet]:
    snippets: list[CitingSentenceSnippet] = []
    seen_ids: set[str] = set()
    for s in doc.sentences:
        if any(c.ref_key == ref_key for c in s.citations):
            if s.id not in seen_ids:
                seen_ids.add(s.id)
                snippets.append(
                    CitingSentenceSnippet(
                        sentence_id=s.id,
                        page=s.page,
                        section=s.section,
                        text=s.text,
                    )
                )
    return snippets


async def resolve_citation_metadata(
    doc: PaperDocument,
    ref_key: str,
    force_arxiv_check: bool = False,
) -> CitationMetadataResponse:
    """
    Stage 1 & Pre-Stage 2: Always check arXiv by title FIRST so IEEE / paywalled references
    automatically resolve to their readable arXiv version whenever available.
    """
    entry = doc.references.get(ref_key)
    if entry is None:
        entry = ReferenceEntry(
            ref_key=ref_key,
            raw_text=f"Reference [{ref_key}] (본문 References 섹션에서 원문 서지 항목을 찾지 못했습니다)",
            title=f"Reference [{ref_key}]",
            enriched=True,
            arxiv_checked=True,
        )
    else:
        needs_arxiv_lookup = (not entry.arxiv_id) and (not entry.arxiv_checked or force_arxiv_check)
        if not entry.enriched or needs_arxiv_lookup:
            async with httpx.AsyncClient(
                headers={"User-Agent": USER_AGENT},
                follow_redirects=True,
            ) as client:
                # 1. ALWAYS check arXiv by ID or Title FIRST!
                await check_arxiv_first_for_entry(client, entry)

                # 2. Enrich remaining metadata (venue/DOI/abstract if not on arXiv)
                if not entry.abstract or not entry.authors or not entry.doi:
                    await _enrich_from_crossref(client, entry)
                if not entry.abstract or not entry.pdf_url:
                    await _enrich_from_openalex(client, entry)
                if not entry.abstract or not entry.pdf_url:
                    await _enrich_from_semantic_scholar(client, entry)

                # 3. If Crossref/OpenAlex/S2 cleaned the title or found an arXiv ID, ensure arXiv URLs win!
                if entry.arxiv_id:
                    base_id = re.sub(r"v\d+$", "", entry.arxiv_id.strip())
                    entry.url = f"https://arxiv.org/abs/{base_id}"
                    entry.pdf_url = f"https://arxiv.org/pdf/{base_id}.pdf"
                    if not entry.abstract:
                        await _enrich_from_datacite_arxiv_id(client, entry)

            entry.enriched = True
            entry.arxiv_checked = True
            doc.references[ref_key] = entry
            update_paper_doc(doc)

    citing = collect_citing_sentences(doc, ref_key)
    cached_summaries = load_citation_summaries(doc.paper_id)

    return CitationMetadataResponse(
        ref_key=ref_key,
        title=entry.title or entry.raw_text[:120],
        authors=entry.authors,
        year=entry.year,
        venue=entry.venue,
        url=entry.url,
        pdf_url=entry.pdf_url,
        arxiv_id=entry.arxiv_id,
        doi=entry.doi,
        has_fulltext=bool(entry.arxiv_id or entry.pdf_url),
        has_abstract=bool(entry.abstract),
        raw_reference=entry.raw_text,
        citing_sentences=citing,
        cached_summary=cached_summaries.get(ref_key),
    )


async def fetch_cited_paper_content(
    entry: ReferenceEntry,
) -> tuple[str, str, str, Optional[str], Optional[str]]:
    """
    Stage 2 helper: Ensure paper title is checked on arXiv FIRST, then fetch arXiv / OA full-text PDF
    + extract Main Figure image, falling back cleanly to abstract if no OA PDF exists.
    Returns: (extracted_content, source_type, source_label, main_figure_url, main_figure_caption)
    """
    ensure_dirs()

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=15.0,
    ) as client:
        # Safety guarantee: before summarizing, ALWAYS verify arXiv by title if arxiv_id is missing!
        if not entry.arxiv_id and not entry.arxiv_checked:
            await check_arxiv_first_for_entry(client, entry)

        candidate_pdf_urls: list[tuple[str, str]] = []
        if entry.arxiv_id:
            base_id = re.sub(r"v\d+$", "", entry.arxiv_id.strip())
            candidate_pdf_urls.append(
                (f"https://arxiv.org/pdf/{base_id}.pdf", f"arXiv 원문 PDF ({base_id}) 기반")
            )
        if entry.pdf_url and all(entry.pdf_url != u for u, _ in candidate_pdf_urls):
            candidate_pdf_urls.append((entry.pdf_url, "오픈액세스 원문 PDF 기반"))

        for pdf_url, label in candidate_pdf_urls:
            cache_key = hashlib.sha256(pdf_url.encode("utf-8")).hexdigest()[:16]
            cache_file = DOWNLOAD_CACHE_DIR / f"{cache_key}.pdf"
            fig_filename = f"{cache_key}_main_fig.png"
            fig_file = DOWNLOAD_CACHE_DIR / fig_filename
            cap_meta_file = DOWNLOAD_CACHE_DIR / f"{cache_key}_main_fig.txt"

            pdf_bytes: Optional[bytes] = None
            if cache_file.exists():
                pdf_bytes = cache_file.read_bytes()
            else:
                try:
                    resp = await client.get(pdf_url)
                    if resp.status_code == 200 and resp.content[:4] == b"%PDF":
                        pdf_bytes = resp.content
                        cache_file.write_bytes(pdf_bytes)
                except Exception:
                    pdf_bytes = None

            if pdf_bytes:
                try:
                    extracted = extract_key_text_from_cited_pdf(pdf_bytes, max_chars=14000)
                    if len(extracted.strip()) >= 250:
                        main_fig_url: Optional[str] = None
                        main_fig_cap: Optional[str] = None
                        if fig_file.exists():
                            main_fig_url = f"/api/cited-media/{fig_filename}"
                            if cap_meta_file.exists():
                                main_fig_cap = cap_meta_file.read_text(encoding="utf-8").strip() or None
                        else:
                            try:
                                cap = extract_main_figure_from_cited_pdf(pdf_bytes, fig_file)
                                if cap and fig_file.exists():
                                    main_fig_url = f"/api/cited-media/{fig_filename}"
                                    main_fig_cap = cap
                                    cap_meta_file.write_text(cap, encoding="utf-8")
                            except Exception:
                                pass
                        return extracted, "fulltext_pdf", label, main_fig_url, main_fig_cap
                except Exception:
                    continue

    if entry.abstract and len(entry.abstract.strip()) >= 60:
        meta_header = (
            f"Title: {entry.title}\n"
            f"Authors: {', '.join(entry.authors)}\n"
            f"Year: {entry.year or 'Unknown'} | Venue: {entry.venue or 'Unknown'}\n\n"
            f"Abstract:\n{entry.abstract}"
        )
        return meta_header, "abstract", "논문 초록(Abstract) 기반", None, None

    return entry.raw_text, "citation_context_only", "서지 정보 및 인용 문맥 기반", None, None


async def download_pdf_from_url_or_arxiv(url_or_arxiv: str) -> tuple[bytes, str]:
    """Download a paper PDF given an arXiv ID (e.g. '1706.03762'), arXiv abs URL, or direct PDF URL."""
    raw = url_or_arxiv.strip()
    m_id = re.fullmatch(r"(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)", raw, re.IGNORECASE)
    if m_id:
        aid = m_id.group(1)
        pdf_url = f"https://arxiv.org/pdf/{aid}.pdf"
        filename = f"arxiv_{aid}.pdf"
    else:
        m_abs = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)", raw, re.IGNORECASE)
        if m_abs:
            aid = m_abs.group(1)
            pdf_url = f"https://arxiv.org/pdf/{aid}.pdf"
            filename = f"arxiv_{aid}.pdf"
        else:
            pdf_url = raw
            filename = raw.rstrip("/").split("/")[-1]
            if not filename.lower().endswith(".pdf"):
                filename = f"{filename or 'paper'}.pdf"

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=25.0,
    ) as client:
        resp = await client.get(pdf_url)
        resp.raise_for_status()
        if resp.content[:4] != b"%PDF":
            raise ValueError("해당 URL에서 유효한 PDF 파일을 가져오지 못했습니다.")
        return resp.content, filename
