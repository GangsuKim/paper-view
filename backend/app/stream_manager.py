from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Optional

from .ai_service import (
    generate_batch_media_insights,
    generate_paper_overview,
    get_effective_default_lang,
    stream_chunk_section_and_translate,
)
from .citation_service import enrich_author_resource_links
from .lang_profiles import get_lang_profile, normalize_lang_code
from .models import PaperDocument
from .pdf_parser import (
    _build_author_year_index,
    build_ai_sentence_item,
    extract_pdf_prebundle,
    extract_pdf_regions_batch,
    find_media_citing_sentences,
)
from .storage import (
    get_pdf_path,
    load_media_manifest,
    load_paper_doc,
    load_pdf_lines,
    load_raw_chunks,
    save_paper,
    update_paper_doc,
)


def _sse_pack(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


class PaperStreamJob:
    """Single-flight background streaming job for one (paper, lang) pair, fanning out SSE events."""

    def __init__(self, paper_id: str, engine: str, lang: str = "ko") -> None:
        self.paper_id = paper_id
        self.engine = engine
        self.lang = normalize_lang_code(lang)
        self.subscribers: set[asyncio.Queue[Optional[str]]] = set()
        self.task: Optional[asyncio.Task[None]] = None
        self.cancelled_by_user = False

    @property
    def job_key(self) -> str:
        return f"{self.paper_id}:{self.lang}"

    def broadcast(self, event: str, payload: dict[str, Any]) -> None:
        msg = _sse_pack(event, payload)
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except Exception:
                pass

    def close_all(self) -> None:
        for q in list(self.subscribers):
            try:
                q.put_nowait(None)
            except Exception:
                pass


class PaperStreamCoordinator:
    def __init__(self) -> None:
        self._jobs: dict[str, PaperStreamJob] = {}
        self._lock = asyncio.Lock()
        self._insight_locks: dict[str, asyncio.Lock] = {}

    def _resolve_lang(self, lang: Optional[str]) -> str:
        return normalize_lang_code(lang or get_effective_default_lang())

    def _get_insight_lock(self, paper_id: str, lang: str) -> asyncio.Lock:
        key = f"{paper_id}:{lang}"
        lk = self._insight_locks.get(key)
        if lk is None:
            lk = asyncio.Lock()
            self._insight_locks[key] = lk
        return lk

    async def ensure_media_insights(
        self,
        paper_id: str,
        engine: str = "auto",
        force: bool = False,
        lang: Optional[str] = None,
        job: Optional[PaperStreamJob] = None,
    ) -> tuple[dict[str, str], Optional[str], Optional[str]]:
        """Ensure all Figure and Table items in `paper_id` have Author's Core Claim (`insight`) populated."""
        code = self._resolve_lang(lang)
        lock = self._get_insight_lock(paper_id, code)
        async with lock:
            doc = load_paper_doc(paper_id, lang=code)
            if doc is None:
                return {}, None, None

            targets = [
                s
                for s in doc.sentences
                if s.kind in ("figure", "table") and (force or not (s.insight and s.insight.strip()))
            ]
            if not targets:
                return {}, doc.ai_engine, doc.ai_model

            raw_chunks = load_raw_chunks(paper_id)
            prose_sources = (
                [c.text for c in raw_chunks]
                if raw_chunks
                else [s.text for s in doc.sentences if s.kind == "sentence"]
            )
            pdf_path = get_pdf_path(paper_id)
            region_queries = [
                (s.id, s.page, s.bboxes[0] if s.bboxes else None)
                for s in targets
            ]
            inner_map = extract_pdf_regions_batch(pdf_path, region_queries)

            batch_items: list[dict[str, Any]] = []
            for s in targets:
                m_label = s.media_label or ("Table" if s.kind == "table" else "Figure")
                citing = find_media_citing_sentences(
                    label=m_label,
                    kind=s.kind or "figure",
                    prose_texts=prose_sources,
                    max_hits=4,
                )
                batch_items.append(
                    {
                        "sentence_id": s.id,
                        "kind": s.kind or "figure",
                        "label": m_label,
                        "caption_en": s.text,
                        "citing_body_sentences": citing,
                        "internal_labels_text": inner_map.get(s.id, ""),
                    }
                )

            insights_map, used_eng, used_mod = await generate_batch_media_insights(
                paper_title=doc.title,
                items=batch_items,
                paper_tldr=(doc.overview.tldr if doc.overview else ""),
                engine=engine,
                lang=code,
            )

            if insights_map:
                latest_doc = load_paper_doc(paper_id, lang=code) or doc
                for s in latest_doc.sentences:
                    if s.id in insights_map:
                        s.insight = insights_map[s.id]
                        if job is not None:
                            job.broadcast(
                                "sentence",
                                {
                                    "sentence": s.model_dump(),
                                    "sections": latest_doc.sections,
                                    "ai_progress": latest_doc.ai_progress,
                                    "ai_engine": used_eng,
                                    "ai_model": used_mod or latest_doc.ai_model,
                                    "current_section": s.section,
                                },
                            )
                update_paper_doc(latest_doc, lang=code)

            return insights_map, used_eng, used_mod or doc.ai_model

    def _ensure_prebundle_ready(
        self,
        paper_id: str,
        force_reset: bool,
        lang: Optional[str] = None,
    ) -> PaperDocument:
        code = self._resolve_lang(lang)
        doc = load_paper_doc(paper_id, lang=code)
        if doc is None:
            raise ValueError("논문을 찾을 수 없습니다.")

        raw_chunks = load_raw_chunks(paper_id)
        needs_migration = (not raw_chunks) or (doc.format_version < 3)

        if needs_migration:
            pdf_path = get_pdf_path(paper_id)
            if pdf_path is None:
                raise ValueError("원본 PDF 파일을 찾을 수 없습니다.")
            pdf_bytes = pdf_path.read_bytes()
            fresh_doc, pdf_lines, fresh_chunks, media_assets = extract_pdf_prebundle(
                pdf_bytes, filename=doc.filename
            )
            fresh_doc.lang = code
            if doc.references:
                for rk, old_ref in doc.references.items():
                    if old_ref.enriched and rk in fresh_doc.references:
                        fresh_doc.references[rk] = old_ref
                    elif rk not in fresh_doc.references:
                        fresh_doc.references[rk] = old_ref
            if not force_reset and doc.overview is not None:
                fresh_doc.overview = doc.overview
            save_paper(
                pdf_bytes,
                fresh_doc,
                pdf_lines=pdf_lines,
                raw_chunks=fresh_chunks,
                media_assets=media_assets,
            )
            return fresh_doc

        if force_reset:
            # Reset ONLY this language's translation state while preserving extracted PDF chunks/media & other languages!
            doc.lang = code
            doc.overview = None
            doc.sections = []
            doc.sentences = []
            doc.ai_status = "pending"
            doc.ai_progress = 0
            doc.ai_total_chunks = len(raw_chunks)
            doc.ai_completed_chunks = 0
            doc.ai_error = None
            update_paper_doc(doc, lang=code)
            return doc

        return doc

    async def stop_job(self, paper_id: str, lang: Optional[str] = None) -> Optional[PaperDocument]:
        code = self._resolve_lang(lang)
        jkey = f"{paper_id}:{code}"
        async with self._lock:
            job = self._jobs.get(jkey)
            if job and job.task and not job.task.done():
                job.cancelled_by_user = True
                job.task.cancel()
        await asyncio.sleep(0.05)
        return load_paper_doc(paper_id, lang=code)

    async def run_to_completion(
        self,
        paper_id: str,
        engine: str = "auto",
        force: bool = False,
        lang: Optional[str] = None,
    ) -> Optional[PaperDocument]:
        """Run or join a background paper translation job until it finishes (used by TranslationQueueManager)."""
        code = self._resolve_lang(lang)
        jkey = f"{paper_id}:{code}"
        if force:
            await self.stop_job(paper_id, lang=code)

        async with self._lock:
            existing_job = self._jobs.get(jkey)
            if existing_job and existing_job.task and not existing_job.task.done():
                task = existing_job.task
            else:
                doc = self._ensure_prebundle_ready(paper_id, force_reset=force, lang=code)
                if doc.ai_status == "completed" and not force and doc.sentences:
                    if not doc.resource_links_checked:
                        if await enrich_author_resource_links(doc):
                            update_paper_doc(doc, lang=code)
                    if doc.overview is None:
                        raw_chunks = load_raw_chunks(paper_id)
                        try:
                            ov, _ = await generate_paper_overview(
                                doc=doc, raw_chunks=raw_chunks, engine=engine, lang=code
                            )
                            doc.overview = ov
                            update_paper_doc(doc, lang=code)
                        except Exception:
                            pass
                    try:
                        await self.ensure_media_insights(
                            paper_id=paper_id, engine=engine, force=False, lang=code
                        )
                    except Exception:
                        pass
                    return load_paper_doc(paper_id, lang=code) or doc

                job = PaperStreamJob(paper_id=paper_id, engine=engine, lang=code)
                job.task = asyncio.create_task(self._run_job(job))
                self._jobs[jkey] = job
                task = job.task

        try:
            await task
        except asyncio.CancelledError:
            pass
        return load_paper_doc(paper_id, lang=code)

    async def subscribe(
        self,
        paper_id: str,
        engine: str = "auto",
        force: bool = False,
        lang: Optional[str] = None,
    ) -> AsyncIterator[str]:
        code = self._resolve_lang(lang)
        jkey = f"{paper_id}:{code}"
        if force:
            await self.stop_job(paper_id, lang=code)

        async with self._lock:
            existing_job = self._jobs.get(jkey)
            if existing_job and existing_job.task and not existing_job.task.done():
                doc = load_paper_doc(paper_id, lang=code)
                if doc is None:
                    raise ValueError("논문을 찾을 수 없습니다.")
                q: asyncio.Queue[Optional[str]] = asyncio.Queue()
                existing_job.subscribers.add(q)
                job = existing_job
            else:
                doc = self._ensure_prebundle_ready(paper_id, force_reset=force, lang=code)
                if doc.ai_status == "completed" and not force and doc.sentences:
                    yield _sse_pack("snapshot", {"paper": doc.model_dump()})
                    yield _sse_pack("complete", {"paper_id": paper_id, "total_sentences": len(doc.sentences)})
                    return

                q = asyncio.Queue()
                job = PaperStreamJob(paper_id=paper_id, engine=engine, lang=code)
                job.subscribers.add(q)
                job.task = asyncio.create_task(self._run_job(job))
                self._jobs[jkey] = job

        current_doc = load_paper_doc(paper_id, lang=code) or doc
        yield _sse_pack("snapshot", {"paper": current_doc.model_dump()})

        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if msg is None:
                    break
                yield msg
        finally:
            job.subscribers.discard(q)

    async def _run_job(self, job: PaperStreamJob) -> None:
        paper_id = job.paper_id
        code = job.lang
        prof = get_lang_profile(code)
        try:
            doc = load_paper_doc(paper_id, lang=code)
            if doc is None:
                return
            pdf_lines = load_pdf_lines(paper_id)
            raw_chunks = load_raw_chunks(paper_id)
            media_map = load_media_manifest(paper_id)
            used_media_ids: set[str] = {
                s.media_id for s in doc.sentences if s.media_id
            }
            total_chunks = max(1, len(raw_chunks))
            auth_year_idx = _build_author_year_index(doc.references)

            doc.lang = code
            doc.ai_status = "streaming"
            doc.ai_error = None
            doc.ai_total_chunks = len(raw_chunks)
            if not doc.resource_links_checked:
                await enrich_author_resource_links(doc)
            update_paper_doc(doc, lang=code)
            if doc.resource_links or doc.arxiv_id:
                job.broadcast(
                    "resources",
                    {
                        "arxiv_id": doc.arxiv_id,
                        "resource_links": [lk.model_dump() for lk in doc.resource_links],
                    },
                )

            prev_section = doc.sections[-1] if doc.sections else ""
            start_chunk = max(0, min(doc.ai_completed_chunks, len(raw_chunks)))

            # Step 0: Always generate Paper Summary & Core Contributions FIRST before streaming sections!
            if doc.overview is None:
                job.broadcast(
                    "status",
                    {
                        "ai_status": "streaming",
                        "ai_progress": max(3, doc.ai_progress),
                        "chunk_index": start_chunk,
                        "total_chunks": len(raw_chunks),
                        "current_section": prof.overview_section_label,
                    },
                )
                try:
                    overview, clean_title = await generate_paper_overview(
                        doc=doc,
                        raw_chunks=raw_chunks,
                        engine=job.engine,
                        lang=code,
                    )
                    doc.overview = overview
                    if overview.engine:
                        doc.ai_engine = overview.engine
                    if overview.model_name:
                        doc.ai_model = overview.model_name
                    if clean_title and len(clean_title) >= 6 and start_chunk == 0:
                        doc.title = clean_title
                        job.broadcast("title", {"title": doc.title})
                    if start_chunk == 0:
                        doc.ai_progress = max(doc.ai_progress, 8)
                    update_paper_doc(doc, lang=code)
                    job.broadcast(
                        "overview",
                        {
                            "overview": overview.model_dump(),
                            "ai_progress": doc.ai_progress,
                            "ai_model": doc.ai_model,
                            "resource_links": [lk.model_dump() for lk in doc.resource_links],
                        },
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass

            job.broadcast(
                "status",
                {
                    "ai_status": "streaming",
                    "ai_progress": doc.ai_progress,
                    "chunk_index": start_chunk,
                    "total_chunks": len(raw_chunks),
                    "current_section": prev_section or "Abstract",
                },
            )

            for idx in range(start_chunk, len(raw_chunks)):
                chunk = raw_chunks[idx]
                unsaved_count = 0

                async for rec, used_engine in stream_chunk_section_and_translate(
                    paper_title=doc.title,
                    chunk=chunk,
                    total_chunks=len(raw_chunks),
                    prev_section=prev_section,
                    engine=job.engine,
                    lang=code,
                ):
                    doc.ai_engine = used_engine

                    if rec.get("type") == "model_info":
                        m_name = str(rec.get("model") or "").strip()
                        if m_name:
                            doc.ai_model = m_name
                            update_paper_doc(doc, lang=code)
                            job.broadcast(
                                "model_info",
                                {"engine": used_engine, "model": m_name},
                            )
                        continue

                    if rec.get("type") == "meta":
                        new_title = str(rec.get("title") or "").strip()
                        if len(new_title) >= 6:
                            doc.title = new_title
                            job.broadcast("title", {"title": doc.title})
                        continue

                    en_val = str(rec.get("en") or "").strip()
                    ko_val = str(rec.get("ko") or "").strip()
                    if not en_val or len(en_val) < 4:
                        continue

                    sec_val = str(rec.get("section") or prev_section or "Abstract").strip()
                    prev_section = sec_val
                    if sec_val not in doc.sections:
                        doc.sections.append(sec_val)

                    try:
                        p_hint = int(rec.get("page") or chunk.start_page)
                    except (TypeError, ValueError):
                        p_hint = chunk.start_page

                    slash_val = str(rec.get("slash") or "").strip() or None
                    insight_val = str(rec.get("insight") or "").strip() or None
                    # Strip any leaked helper suffix if LLM copied [INTERNAL_LABELS: ...] or [BODY_CLAIMS: ...]
                    if "[INTERNAL_LABELS:" in en_val:
                        en_val = en_val.split("[INTERNAL_LABELS:", 1)[0].strip()
                    if "[BODY_CLAIMS:" in en_val:
                        en_val = en_val.split("[BODY_CLAIMS:", 1)[0].strip()

                    sent_item = build_ai_sentence_item(
                        index=len(doc.sentences),
                        page_hint=p_hint,
                        section=sec_val,
                        en_text=en_val,
                        ko_text=ko_val,
                        slash_en=slash_val,
                        pdf_lines=pdf_lines,
                        references=doc.references,
                        auth_year_idx=auth_year_idx,
                        insight=insight_val,
                    )

                    rec_mid = str(rec.get("media_id") or "").strip()
                    rec_label = str(rec.get("label") or "").strip().lower()
                    matched_asset = media_map.get(rec_mid) if rec_mid else None

                    if matched_asset is None and media_map:
                        en_low = en_val.lower()
                        for cand in media_map.values():
                            if cand.media_id in used_media_ids:
                                continue
                            lbl_low = cand.label.lower()
                            if (rec_label and rec_label == lbl_low) or (
                                abs(cand.page - p_hint) <= 1
                                and (
                                    en_low.startswith(lbl_low + ".")
                                    or en_low.startswith(lbl_low + ":")
                                    or en_low.startswith(lbl_low + " ")
                                )
                            ):
                                matched_asset = cand
                                break

                    if matched_asset is not None and matched_asset.media_id not in used_media_ids:
                        used_media_ids.add(matched_asset.media_id)
                        sent_item.kind = matched_asset.kind
                        sent_item.media_id = matched_asset.media_id
                        sent_item.media_label = matched_asset.label
                        sent_item.page = matched_asset.page
                        sent_item.bboxes = [matched_asset.bbox]
                        if matched_asset.image_filename:
                            sent_item.image_url = (
                                f"/api/papers/{paper_id}/media/{matched_asset.image_filename}"
                            )

                    doc.sentences.append(sent_item)
                    unsaved_count += 1

                    approx_pct = min(
                        99,
                        int(((idx + min(0.9, unsaved_count / 35.0)) / total_chunks) * 100),
                    )
                    doc.ai_progress = max(doc.ai_progress, approx_pct)

                    job.broadcast(
                        "sentence",
                        {
                            "sentence": sent_item.model_dump(),
                            "sections": doc.sections,
                            "ai_progress": doc.ai_progress,
                            "ai_engine": used_engine,
                            "ai_model": doc.ai_model,
                            "current_section": sec_val,
                        },
                    )

                    if unsaved_count % 5 == 0:
                        update_paper_doc(doc, lang=code)

                doc.ai_completed_chunks = idx + 1
                doc.ai_progress = int((doc.ai_completed_chunks / total_chunks) * 100)
                update_paper_doc(doc, lang=code)

                job.broadcast(
                    "status",
                    {
                        "ai_status": "streaming",
                        "ai_progress": doc.ai_progress,
                        "chunk_index": doc.ai_completed_chunks,
                        "total_chunks": len(raw_chunks),
                        "current_section": prev_section,
                    },
                )

            # Ensure any Figure/Table that missed inline `insight` during streaming gets filled before completion
            if any(s.kind in ("figure", "table") and not (s.insight and s.insight.strip()) for s in doc.sentences):
                try:
                    await self.ensure_media_insights(
                        paper_id=paper_id,
                        engine=job.engine,
                        force=False,
                        lang=code,
                        job=job,
                    )
                    doc = load_paper_doc(paper_id, lang=code) or doc
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass

            doc.ai_status = "completed"
            doc.ai_progress = 100
            update_paper_doc(doc, lang=code)
            job.broadcast(
                "complete",
                {
                    "paper_id": paper_id,
                    "total_sentences": len(doc.sentences),
                    "sections": doc.sections,
                },
            )
        except asyncio.CancelledError:
            doc = load_paper_doc(paper_id, lang=code)
            if doc is not None:
                doc.ai_status = "paused"
                update_paper_doc(doc, lang=code)
                job.broadcast(
                    "paused",
                    {
                        "ai_status": "paused",
                        "ai_progress": doc.ai_progress,
                        "completed_chunks": doc.ai_completed_chunks,
                        "total_chunks": doc.ai_total_chunks,
                    },
                )
        except Exception as exc:
            doc = load_paper_doc(paper_id, lang=code)
            if doc is not None:
                doc.ai_status = "error"
                doc.ai_error = str(exc)
                update_paper_doc(doc, lang=code)
            job.broadcast("stream_error", {"detail": str(exc)})
        finally:
            job.close_all()
            async with self._lock:
                if self._jobs.get(job.job_key) is job:
                    self._jobs.pop(job.job_key, None)


stream_coordinator = PaperStreamCoordinator()
