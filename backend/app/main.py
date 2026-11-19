from __future__ import annotations

from contextlib import asynccontextmanager
import datetime as dt
import json
import mimetypes
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

# Ensure Windows serves PDF.js .mjs ES module workers with proper JavaScript MIME type
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .ai_service import (
    analyze_batch_sentences,
    analyze_sentence_sense_groups,
    discover_all_models_catalog,
    fetch_usage_status,
    generate_media_author_insight,
    generate_paper_overview,
    get_claude_model_summary,
    get_effective_antigravity_model,
    get_effective_default_lang,
    get_engines_status,
    resolve_display_model_for_engine,
    save_local_settings,
    stream_paper_chat_reply,
    summarize_cited_paper,
)
from .lang_profiles import list_supported_languages, normalize_lang_code
from .citation_service import (
    collect_citing_sentences,
    download_pdf_from_url_or_arxiv,
    fetch_cited_paper_content,
    resolve_citation_metadata,
)
from .models import (
    AnalyzeBatchRequest,
    AnalyzeSentenceRequest,
    ChatMessage,
    ChatStreamRequest,
    CitationMetadataResponse,
    CitationSummaryResponse,
    EngineSettingsRequest,
    GenerateOverviewRequest,
    ImportUrlRequest,
    MediaInsightResponse,
    OpenLocalRequest,
    PaperDocument,
    PaperOverview,
    PaperSummaryItem,
    QueueAddPapersRequest,
    QueueAddUrlsRequest,
    QueueControlRequest,
    QueueMoveItemRequest,
    QueueStateResponse,
    ReferenceEntry,
    SentenceAnalysis,
    SummarizeCitationRequest,
    UsageStatusResponse,
)
from .pdf_parser import (
    extract_pdf_prebundle,
    extract_pdf_region_text,
    find_media_citing_sentences,
)
from .queue_manager import queue_manager
from .storage import (
    PROJECT_ROOT,
    clear_chat_history,
    compute_paper_id,
    get_cited_media_file_path,
    get_media_file_path,
    get_pdf_path,
    list_papers,
    load_chat_history,
    load_citation_summaries,
    load_paper_doc,
    load_raw_chunks,
    load_sentence_analyses,
    save_chat_history,
    save_citation_summary,
    save_paper,
    save_sentence_analysis,
    update_paper_doc,
)
from .stream_manager import stream_coordinator

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    queue_manager.start_worker()
    yield


app = FastAPI(
    title="PaperView Local API",
    description="Local AI academic paper reader powered by Claude CLI, Codex CLI & Antigravity SDK",
    version="0.1.0",
    lifespan=_lifespan,
)

# Allow local browser, Vite dev server, and VS Code Webview origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ingest_pdf_bytes(
    pdf_bytes: bytes,
    filename: str,
    lang: str | None = None,
) -> PaperDocument:
    if len(pdf_bytes) < 16 or pdf_bytes[:4] != b"%PDF":
        raise HTTPException(status_code=400, detail="유효한 PDF 파일이 아닙니다.")
    code = normalize_lang_code(lang or get_effective_default_lang())
    paper_id = compute_paper_id(pdf_bytes)
    existing_base = load_paper_doc(paper_id, lang="ko")
    if existing_base is not None:
        has_chunks = bool(load_raw_chunks(paper_id))
        if has_chunks and existing_base.format_version >= 3:
            return load_paper_doc(paper_id, lang=code) or existing_base

    doc, pdf_lines, raw_chunks, media_assets = extract_pdf_prebundle(pdf_bytes, filename=filename)
    doc.lang = code
    if existing_base is not None and existing_base.references:
        doc.references = existing_base.references
    save_paper(
        pdf_bytes,
        doc,
        pdf_lines=pdf_lines,
        raw_chunks=raw_chunks,
        media_assets=media_assets,
    )
    return doc


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "paper-view",
        "engines": get_engines_status(),
    }


@app.get("/api/engines")
async def engines() -> dict:
    return {
        "engines": get_engines_status(),
        "languages": list_supported_languages(),
        "selected_lang": get_effective_default_lang(),
    }


@app.get("/api/models")
async def get_available_models(refresh: bool = False) -> dict:
    return {
        "engines": get_engines_status(),
        "catalog": discover_all_models_catalog(refresh=refresh),
        "languages": list_supported_languages(),
        "selected_lang": get_effective_default_lang(),
    }


@app.get("/api/usage", response_model=UsageStatusResponse)
async def get_usage(refresh: bool = False) -> UsageStatusResponse:
    return await fetch_usage_status(refresh=refresh)


@app.post("/api/settings/engines")
async def update_engine_settings(req: EngineSettingsRequest) -> dict:
    updates = {}
    if req.gemini_api_key is not None:
        updates["gemini_api_key"] = req.gemini_api_key.strip()
    if req.claude_model_override is not None:
        updates["claude_model_override"] = req.claude_model_override.strip()
        updates["last_detected_claude_model"] = ""
    if req.claude_effort is not None:
        updates["claude_effort"] = req.claude_effort.strip()
    if req.codex_model is not None:
        updates["codex_model"] = req.codex_model.strip()
    if req.codex_effort is not None:
        updates["codex_effort"] = req.codex_effort.strip()
    if req.antigravity_model is not None:
        updates["antigravity_model"] = req.antigravity_model.strip()
    if req.antigravity_thinking_level is not None:
        updates["antigravity_thinking_level"] = req.antigravity_thinking_level.strip()
    if req.default_lang is not None:
        updates["default_lang"] = normalize_lang_code(req.default_lang)
    save_local_settings(updates)
    return {
        "engines": get_engines_status(),
        "catalog": discover_all_models_catalog(refresh=False),
        "languages": list_supported_languages(),
        "selected_lang": get_effective_default_lang(),
    }


@app.get("/api/papers", response_model=list[PaperSummaryItem])
async def get_papers(lang: str | None = None) -> list[PaperSummaryItem]:
    code = normalize_lang_code(lang or get_effective_default_lang())
    return list_papers(lang=code)


@app.post("/api/papers/upload")
async def upload_paper(
    file: UploadFile = File(...),
    lang: str | None = Form(None),
) -> dict:
    code = normalize_lang_code(lang or get_effective_default_lang())
    pdf_bytes = await file.read()
    filename = file.filename or "uploaded_paper.pdf"
    doc = _ingest_pdf_bytes(pdf_bytes, filename, lang=code)
    return {
        "paper": doc,
        "analyses": load_sentence_analyses(doc.paper_id, lang=code),
        "citation_summaries": load_citation_summaries(doc.paper_id, lang=code),
    }


@app.post("/api/papers/open-local")
async def open_local_pdf(req: OpenLocalRequest) -> dict:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    path = Path(req.file_path).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {path}")
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="PDF 파일(.pdf)만 열 수 있습니다.")
    pdf_bytes = path.read_bytes()
    doc = _ingest_pdf_bytes(pdf_bytes, path.name, lang=code)
    return {
        "paper": doc,
        "analyses": load_sentence_analyses(doc.paper_id, lang=code),
        "citation_summaries": load_citation_summaries(doc.paper_id, lang=code),
    }


@app.post("/api/papers/import-url")
async def import_paper_from_url(req: ImportUrlRequest) -> dict:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    try:
        pdf_bytes, filename = await download_pdf_from_url_or_arxiv(req.url_or_arxiv)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"논문 다운로드 실패: {exc}") from exc
    doc = _ingest_pdf_bytes(pdf_bytes, filename, lang=code)
    return {
        "paper": doc,
        "analyses": load_sentence_analyses(doc.paper_id, lang=code),
        "citation_summaries": load_citation_summaries(doc.paper_id, lang=code),
    }


@app.get("/api/papers/{paper_id}")
async def get_paper(paper_id: str, lang: str | None = None) -> dict:
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    if doc.format_version < 3:
        doc = stream_coordinator._ensure_prebundle_ready(paper_id, force_reset=False, lang=code)
    return {
        "paper": doc,
        "analyses": load_sentence_analyses(paper_id, lang=code),
        "citation_summaries": load_citation_summaries(paper_id, lang=code),
    }


@app.get("/api/papers/{paper_id}/pdf")
async def get_paper_pdf(paper_id: str) -> FileResponse:
    pdf_path = get_pdf_path(paper_id)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="원본 PDF 파일을 찾을 수 없습니다.")
    return FileResponse(pdf_path, media_type="application/pdf", filename=f"{paper_id}.pdf")


@app.get("/api/papers/{paper_id}/media/{filename}")
async def get_paper_media(paper_id: str, filename: str) -> FileResponse:
    media_path = get_media_file_path(paper_id, filename)
    if media_path is None:
        raise HTTPException(status_code=404, detail="Figure/Table 이미지를 찾을 수 없습니다.")
    return FileResponse(media_path, media_type="image/png")


@app.get("/api/cited-media/{filename}")
async def get_cited_paper_media(filename: str) -> FileResponse:
    media_path = get_cited_media_file_path(filename)
    if media_path is None:
        raise HTTPException(status_code=404, detail="인용 논문 이미지를 찾을 수 없습니다.")
    return FileResponse(media_path, media_type="image/png")


@app.get("/api/papers/{paper_id}/stream")
async def stream_paper_translation(
    paper_id: str,
    engine: str = "auto",
    force: bool = False,
    lang: str | None = None,
) -> StreamingResponse:
    """
    SSE endpoint that runs AI section segmentation (Abstract / Introduction / ...)
    and streams sentence-by-sentence translations in the chosen target language.
    """
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    return StreamingResponse(
        stream_coordinator.subscribe(paper_id=paper_id, engine=engine, force=force, lang=code),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/papers/{paper_id}/stop-stream")
async def stop_paper_stream(paper_id: str, lang: str | None = None) -> dict:
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = await stream_coordinator.stop_job(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    return {"paper": doc}


@app.post("/api/papers/{paper_id}/overview", response_model=PaperOverview)
async def create_or_refresh_paper_overview(
    paper_id: str,
    req: GenerateOverviewRequest,
) -> PaperOverview:
    """Generate or refresh the top-of-paper Summary & Contributions card."""
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    if not req.force and doc.overview is not None and normalize_lang_code(doc.overview.lang) == code:
        return doc.overview

    if doc.format_version < 3 or not load_raw_chunks(paper_id):
        doc = stream_coordinator._ensure_prebundle_ready(paper_id, force_reset=False, lang=code)

    raw_chunks = load_raw_chunks(paper_id)
    try:
        overview, clean_title = await generate_paper_overview(
            doc=doc,
            raw_chunks=raw_chunks,
            engine=req.engine,
            lang=code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    latest_doc = load_paper_doc(paper_id, lang=code) or doc
    latest_doc.overview = overview
    if clean_title and len(clean_title) >= 6 and latest_doc.title.endswith(".pdf"):
        latest_doc.title = clean_title
    update_paper_doc(latest_doc, lang=code)
    return overview


@app.post(
    "/api/papers/{paper_id}/sentences/{sentence_id}/media-insight",
    response_model=MediaInsightResponse,
)
async def create_or_refresh_media_insight(
    paper_id: str,
    sentence_id: str,
    req: GenerateOverviewRequest,
) -> MediaInsightResponse:
    """Generate or refresh the Author's Core Claim / Takeaway explanation for a Figure or Table."""
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    target = next((s for s in doc.sentences if s.id == sentence_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="해당 Figure/Table 항목을 찾을 수 없습니다.")

    if not req.force and target.insight:
        return MediaInsightResponse(
            sentence_id=target.id,
            insight=target.insight,
            engine=doc.ai_engine,
            model_name=doc.ai_model,
        )

    raw_chunks = load_raw_chunks(paper_id)
    prose_sources = (
        [c.text for c in raw_chunks]
        if raw_chunks
        else [s.text for s in doc.sentences if s.kind == "sentence"]
    )
    media_label = target.media_label or ("Table" if target.kind == "table" else "Figure")
    citing_sents = find_media_citing_sentences(
        label=media_label,
        kind=target.kind or "figure",
        prose_texts=prose_sources,
        max_hits=5,
    )

    pdf_path = get_pdf_path(paper_id)
    inner_text = ""
    if pdf_path is not None and target.bboxes:
        inner_text = extract_pdf_region_text(pdf_path, target.page, target.bboxes[0])

    try:
        insight_txt, used_eng, used_mod = await generate_media_author_insight(
            paper_title=doc.title,
            media_kind=target.kind or "figure",
            media_label=media_label,
            caption_en=target.text,
            citing_body_sentences=citing_sents,
            internal_labels_text=inner_text,
            paper_tldr=(doc.overview.tldr if doc.overview else ""),
            engine=req.engine,
            lang=code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    latest_doc = load_paper_doc(paper_id, lang=code) or doc
    for s in latest_doc.sentences:
        if s.id == sentence_id:
            s.insight = insight_txt
            break
    update_paper_doc(latest_doc, lang=code)

    return MediaInsightResponse(
        sentence_id=sentence_id,
        insight=insight_txt,
        engine=used_eng,
        model_name=used_mod,
    )


@app.post(
    "/api/papers/{paper_id}/sentences/{sentence_id}/analyze",
    response_model=SentenceAnalysis,
)
async def analyze_sentence(
    paper_id: str,
    sentence_id: str,
    req: AnalyzeSentenceRequest,
) -> SentenceAnalysis:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    if not req.force:
        cached = load_sentence_analyses(paper_id, lang=code).get(sentence_id)
        if cached is not None and (req.engine == "auto" or cached.engine == req.engine):
            return cached

    target = next((s for s in doc.sentences if s.id == sentence_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="문장을 찾을 수 없습니다.")

    try:
        analysis = await analyze_sentence_sense_groups(
            paper_title=doc.title,
            section=target.section,
            sentence=target,
            engine=req.engine,
            lang=code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    save_sentence_analysis(paper_id, analysis, lang=code)
    return analysis


@app.post(
    "/api/papers/{paper_id}/sentences/analyze-batch",
    response_model=list[SentenceAnalysis],
)
async def analyze_sentences_batch(
    paper_id: str,
    req: AnalyzeBatchRequest,
) -> list[SentenceAnalysis]:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    existing = load_sentence_analyses(paper_id, lang=code)
    by_id = {s.id: s for s in doc.sentences}

    to_run = [
        by_id[sid]
        for sid in req.sentence_ids
        if sid in by_id and sid not in existing
    ]
    already = [existing[sid] for sid in req.sentence_ids if sid in existing]

    if not to_run:
        return already

    try:
        fresh = await analyze_batch_sentences(
            paper_title=doc.title,
            sentences=to_run[:8],
            engine=req.engine,
            lang=code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    for item in fresh:
        save_sentence_analysis(paper_id, item, lang=code)

    return already + fresh


@app.get(
    "/api/papers/{paper_id}/citations/{ref_key}",
    response_model=CitationMetadataResponse,
)
async def get_citation_metadata(
    paper_id: str,
    ref_key: str,
    lang: str | None = None,
) -> CitationMetadataResponse:
    """Stage 1: Return citation title, authors, year, venue, links, and citing context WITHOUT running AI summary."""
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    return await resolve_citation_metadata(doc, ref_key, lang=code)


@app.post(
    "/api/papers/{paper_id}/citations/{ref_key}/summarize",
    response_model=CitationSummaryResponse,
)
async def summarize_citation(
    paper_id: str,
    ref_key: str,
    req: SummarizeCitationRequest,
) -> CitationSummaryResponse:
    """Stage 2: Triggered when user clicks Quick Summary — fetches full-text/abstract and generates concise AI summary."""
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")

    await resolve_citation_metadata(doc, ref_key, force_arxiv_check=req.force, lang=code)
    doc = load_paper_doc(paper_id, lang=code) or doc

    ref_entry = doc.references.get(ref_key)
    if ref_entry is None:
        ref_entry = ReferenceEntry(
            ref_key=ref_key,
            raw_text=f"Reference [{ref_key}]",
            title=f"Reference [{ref_key}]",
            enriched=True,
            arxiv_checked=True,
        )

    if not req.force:
        cached = load_citation_summaries(paper_id, lang=code).get(ref_key)
        has_newly_found_arxiv_pdf = bool(ref_entry.arxiv_id) and (
            cached is not None and cached.source_type != "fulltext_pdf"
        )
        if (
            cached is not None
            and not has_newly_found_arxiv_pdf
            and (req.engine == "auto" or cached.engine == req.engine)
        ):
            if cached.main_figure_url is None and (ref_entry.arxiv_id or ref_entry.pdf_url):
                _, _, _, m_url, m_cap = await fetch_cited_paper_content(ref_entry, lang=code)
                if m_url:
                    cached.main_figure_url = m_url
                    cached.main_figure_caption = m_cap
                    save_citation_summary(paper_id, cached, lang=code)
            return cached

    (
        cited_content,
        source_type,
        source_label,
        main_fig_url,
        main_fig_cap,
    ) = await fetch_cited_paper_content(ref_entry, lang=code)
    citing_contexts = collect_citing_sentences(doc, ref_key)
    if not citing_contexts and code != "ko":
        base_doc = load_paper_doc(paper_id, lang="ko")
        if base_doc and base_doc.sentences:
            citing_contexts = collect_citing_sentences(base_doc, ref_key)

    try:
        summary = await summarize_cited_paper(
            current_paper_title=doc.title,
            citing_contexts=citing_contexts,
            ref_entry=ref_entry,
            cited_content=cited_content,
            source_type=source_type,
            source_label=source_label,
            engine=req.engine,
            main_figure_url=main_fig_url,
            main_figure_caption=main_fig_cap,
            lang=code,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    save_citation_summary(paper_id, summary, lang=code)
    return summary


@app.get("/api/papers/{paper_id}/chat")
async def get_paper_chat(paper_id: str, lang: str | None = None) -> dict:
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    return {"messages": load_chat_history(paper_id, lang=code)}


@app.delete("/api/papers/{paper_id}/chat")
async def reset_paper_chat(paper_id: str, lang: str | None = None) -> dict:
    code = normalize_lang_code(lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    clear_chat_history(paper_id, lang=code)
    return {"messages": []}


@app.post("/api/papers/{paper_id}/chat/stream")
async def stream_paper_chat(paper_id: str, req: ChatStreamRequest) -> StreamingResponse:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    doc = load_paper_doc(paper_id, lang=code)
    if doc is None:
        raise HTTPException(status_code=404, detail="논문을 찾을 수 없습니다.")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="질문 내용을 입력해주세요.")

    if doc.format_version < 3 or not load_raw_chunks(paper_id):
        doc = stream_coordinator._ensure_prebundle_ready(paper_id, force_reset=False, lang=code)

    raw_chunks = load_raw_chunks(paper_id)
    history = load_chat_history(paper_id, lang=code)

    user_msg = ChatMessage(
        id=f"u_{uuid.uuid4().hex[:10]}",
        role="user",
        content=req.message.strip(),
        context_snippet=(req.context_snippet.strip() if req.context_snippet else None),
        lang=code,
        created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
    )
    history.append(user_msg)
    save_chat_history(paper_id, history, lang=code)

    async def _gen():
        assistant_id = f"a_{uuid.uuid4().hex[:10]}"
        yield f"event: user_saved\ndata: {json.dumps({'user_message': user_msg.model_dump(), 'assistant_id': assistant_id}, ensure_ascii=False)}\n\n"

        reply_parts: list[str] = []
        used_engine = req.engine
        detected_model: str = ""

        try:
            async for delta, eng_id, m_name in stream_paper_chat_reply(
                doc=doc,
                raw_chunks=raw_chunks,
                history=history[:-1],
                user_message=user_msg.content,
                context_snippet=user_msg.context_snippet,
                engine=req.engine,
                response_style=req.response_style,
                lang=code,
            ):
                used_engine = eng_id
                if m_name and m_name != detected_model:
                    detected_model = m_name
                    yield f"event: model\ndata: {json.dumps({'engine': eng_id, 'model': m_name}, ensure_ascii=False)}\n\n"
                if delta:
                    reply_parts.append(delta)
                    yield f"event: delta\ndata: {json.dumps({'text': delta}, ensure_ascii=False)}\n\n"

            full_reply = "".join(reply_parts).strip()
            final_model = detected_model or resolve_display_model_for_engine(used_engine)[0]
            assistant_msg = ChatMessage(
                id=assistant_id,
                role="assistant",
                content=full_reply or "(Empty reply)",
                engine=used_engine,
                model_name=final_model,
                lang=code,
                created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
            )
            updated_hist = load_chat_history(paper_id, lang=code)
            updated_hist.append(assistant_msg)
            save_chat_history(paper_id, updated_hist, lang=code)
            yield f"event: done\ndata: {json.dumps({'assistant_message': assistant_msg.model_dump()}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/queue", response_model=QueueStateResponse)
async def get_translation_queue() -> QueueStateResponse:
    queue_manager.start_worker()
    return queue_manager.get_state()


@app.post("/api/queue/upload", response_model=QueueStateResponse)
async def enqueue_uploaded_pdfs(
    files: list[UploadFile] = File(...),
    engine: str = Form("claude"),
    force: bool = Form(False),
    lang: str | None = Form(None),
) -> QueueStateResponse:
    if not files:
        raise HTTPException(status_code=400, detail="업로드할 PDF 파일을 선택해주세요.")
    code = normalize_lang_code(lang or get_effective_default_lang())
    for f in files:
        pdf_bytes = await f.read()
        if len(pdf_bytes) < 16 or pdf_bytes[:4] != b"%PDF":
            continue
        doc = _ingest_pdf_bytes(pdf_bytes, f.filename or "queued_paper.pdf", lang=code)
        await queue_manager.enqueue_paper(doc, engine=engine, force=force, lang=code)
    return queue_manager.get_state()


@app.post("/api/queue/urls", response_model=QueueStateResponse)
async def enqueue_urls_or_arxivs(req: QueueAddUrlsRequest) -> QueueStateResponse:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    errors: list[str] = []
    added_any = False
    for raw_target in req.urls_or_arxivs:
        t = raw_target.strip()
        if not t:
            continue
        try:
            pdf_bytes, filename = await download_pdf_from_url_or_arxiv(t)
            doc = _ingest_pdf_bytes(pdf_bytes, filename, lang=code)
            await queue_manager.enqueue_paper(doc, engine=req.engine, force=req.force, lang=code)
            added_any = True
        except Exception as exc:
            errors.append(f"{t}: {exc}")
    if not added_any and errors:
        raise HTTPException(status_code=400, detail="; ".join(errors[:3]))
    return queue_manager.get_state()


@app.post("/api/queue/papers", response_model=QueueStateResponse)
async def enqueue_existing_papers(req: QueueAddPapersRequest) -> QueueStateResponse:
    code = normalize_lang_code(req.lang or get_effective_default_lang())
    for pid in req.paper_ids:
        doc = load_paper_doc(pid, lang=code)
        if doc is not None:
            await queue_manager.enqueue_paper(doc, engine=req.engine, force=req.force, lang=code)
    return queue_manager.get_state()


@app.post("/api/queue/control", response_model=QueueStateResponse)
async def control_translation_queue(req: QueueControlRequest) -> QueueStateResponse:
    return await queue_manager.apply_control(
        action=req.action,
        scheduled_time=req.scheduled_time,
        auto_retry_on_quota=req.auto_retry_on_quota,
    )


@app.delete("/api/queue/items/{item_id}", response_model=QueueStateResponse)
async def delete_queue_item(item_id: str) -> QueueStateResponse:
    return await queue_manager.remove_item(item_id)


@app.post("/api/queue/items/{item_id}/move", response_model=QueueStateResponse)
async def move_queue_item(item_id: str, req: QueueMoveItemRequest) -> QueueStateResponse:
    return await queue_manager.move_item(item_id, req.direction)


@app.post("/api/queue/items/{item_id}/retry", response_model=QueueStateResponse)
async def retry_queue_item(item_id: str) -> QueueStateResponse:
    return await queue_manager.retry_item(item_id)


# Serve built frontend bundle when available so a single server powers both Browser and VS Code Webview
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    dist_dir = PROJECT_ROOT / "frontend" / "dist"
    target = (dist_dir / full_path).resolve()
    if full_path and target.is_file() and str(target).startswith(str(dist_dir.resolve())):
        return FileResponse(target)
    index_file = dist_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "message": "PaperView Backend is running. Build frontend (`cd frontend && npm run build`) or use Vite dev server."
    }


if __name__ == "__main__":
    import argparse
    import os
    import uvicorn

    parser = argparse.ArgumentParser(description="PaperView Local Server")
    parser.add_argument(
        "--port",
        "-p",
        type=int,
        default=int(os.environ.get("PAPERVIEW_PORT", "8787")),
        help="Port to bind the local server (default: 8787)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind (default: 127.0.0.1)",
    )
    cli_args = parser.parse_args()
    uvicorn.run("app.main:app", host=cli_args.host, port=cli_args.port)
