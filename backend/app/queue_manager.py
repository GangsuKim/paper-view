from __future__ import annotations

import asyncio
import datetime as dt
import json
import re
import uuid
from pathlib import Path
from typing import Optional

from .ai_service import get_effective_default_lang
from .lang_profiles import normalize_lang_code
from .models import PaperDocument, QueueItem, QueueStateResponse
from .storage import DATA_DIR, ensure_dirs, load_paper_doc
from .stream_manager import stream_coordinator

_QUOTA_ERR_KEYWORDS = (
    "limit",
    "rate",
    "quota",
    "five_hour",
    "hit your",
    "429",
    "overloaded",
    "exceeded",
    "resets",
)


def _queue_file_path() -> Path:
    ensure_dirs()
    return DATA_DIR / "queue.json"


def _now_iso() -> str:
    return dt.datetime.now().astimezone().isoformat()


class TranslationQueueManager:
    """
    Sequential background & scheduled overnight paper translation queue.
    Persists queue state to `.paperview_data/queue.json`, supports scheduled start times (`HH:MM`),
    and automatically pauses/resumes across subscription 5-hour quota resets.
    """

    def __init__(self) -> None:
        self.paused: bool = False
        self.scheduled_start_at: Optional[str] = None
        self.scheduled_time_label: Optional[str] = None
        self.auto_retry_on_quota: bool = True
        self.items: list[QueueItem] = []

        self._lock = asyncio.Lock()
        self._wake_event = asyncio.Event()
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._current_running_id: Optional[str] = None
        self._cancelled_ids: set[str] = set()

        self._load_from_disk()

    def _load_from_disk(self) -> None:
        p = _queue_file_path()
        if not p.exists():
            return
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            self.paused = bool(raw.get("paused", False))
            self.scheduled_start_at = raw.get("scheduled_start_at") or None
            self.scheduled_time_label = raw.get("scheduled_time_label") or None
            self.auto_retry_on_quota = bool(raw.get("auto_retry_on_quota", True))
            loaded_items: list[QueueItem] = []
            for x in raw.get("items") or []:
                item = QueueItem.model_validate(x)
                # Recover items interrupted by server shutdown back into 'queued'
                if item.status == "running":
                    item.status = "queued"
                loaded_items.append(item)
            self.items = loaded_items
        except Exception:
            pass

    def _save_to_disk(self) -> None:
        p = _queue_file_path()
        payload = {
            "paused": self.paused,
            "scheduled_start_at": self.scheduled_start_at,
            "scheduled_time_label": self.scheduled_time_label,
            "auto_retry_on_quota": self.auto_retry_on_quota,
            "items": [it.model_dump() for it in self.items],
        }
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def start_worker(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())

    def _wake(self) -> None:
        self._wake_event.set()
        self.start_worker()

    def get_state(self) -> QueueStateResponse:
        # Refresh live progress/title from document.json for active items
        changed = False
        for it in self.items:
            if it.status in ("running", "queued", "waiting_quota", "completed"):
                doc = load_paper_doc(it.paper_id, lang=it.lang)
                if doc is not None:
                    if doc.title and doc.title != it.title:
                        it.title = doc.title
                        changed = True
                    if it.status == "running":
                        it.progress = doc.ai_progress
                    elif it.status == "completed":
                        it.progress = 100
                    elif doc.ai_progress > it.progress and not it.force_retranslate:
                        it.progress = doc.ai_progress
        if changed:
            self._save_to_disk()

        return QueueStateResponse(
            paused=self.paused,
            scheduled_start_at=self.scheduled_start_at,
            scheduled_time_label=self.scheduled_time_label,
            auto_retry_on_quota=self.auto_retry_on_quota,
            is_worker_busy=self._current_running_id is not None,
            items=list(self.items),
        )

    async def enqueue_paper(
        self,
        doc: PaperDocument,
        engine: str = "claude",
        force: bool = False,
        lang: Optional[str] = None,
    ) -> QueueItem:
        code = normalize_lang_code(lang or doc.lang or get_effective_default_lang())
        lang_doc = load_paper_doc(doc.paper_id, lang=code) or doc
        async with self._lock:
            for existing in self.items:
                if (
                    existing.paper_id == doc.paper_id
                    and normalize_lang_code(existing.lang) == code
                    and existing.status in ("queued", "running", "waiting_quota")
                ):
                    if existing.status != "running":
                        existing.engine = engine or existing.engine
                        if force:
                            existing.force_retranslate = True
                            existing.progress = 0
                    self._save_to_disk()
                    self._wake()
                    return existing

            init_prog = 0 if force else lang_doc.ai_progress
            item = QueueItem(
                id=f"q_{uuid.uuid4().hex[:10]}",
                paper_id=doc.paper_id,
                title=lang_doc.title or doc.title,
                filename=doc.filename,
                engine=engine or "claude",
                lang=code,
                force_retranslate=force,
                status="queued",
                progress=init_prog,
                added_at=_now_iso(),
            )
            self.items.append(item)
            self._save_to_disk()
            self._wake()
            return item

    async def apply_control(
        self,
        action: Optional[str] = None,
        scheduled_time: Optional[str] = None,
        auto_retry_on_quota: Optional[bool] = None,
    ) -> QueueStateResponse:
        stop_paper_id: Optional[tuple[str, str]] = None

        async with self._lock:
            if auto_retry_on_quota is not None:
                self.auto_retry_on_quota = bool(auto_retry_on_quota)

            if scheduled_time is not None:
                st = scheduled_time.strip()
                if not st:
                    self.scheduled_start_at = None
                    self.scheduled_time_label = None
                else:
                    m = re.match(r"^(\d{1,2}):(\d{2})$", st)
                    if m:
                        hh, mm = int(m.group(1)), int(m.group(2))
                        now = dt.datetime.now().astimezone()
                        target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
                        day_prefix = "오늘"
                        if target <= now:
                            target = target + dt.timedelta(days=1)
                            day_prefix = "내일"
                        self.scheduled_start_at = target.isoformat()
                        self.scheduled_time_label = f"{day_prefix} {hh:02d}:{mm:02d}"

            if action == "pause":
                self.paused = True
                # Also pause currently running job cleanly at checkpoint
                if self._current_running_id:
                    cur = next((x for x in self.items if x.id == self._current_running_id), None)
                    if cur:
                        stop_paper_id = (cur.paper_id, cur.lang)
            elif action == "resume":
                self.paused = False
            elif action == "start_now":
                self.paused = False
                self.scheduled_start_at = None
                self.scheduled_time_label = None
                for it in self.items:
                    if it.status == "waiting_quota":
                        it.status = "queued"
                        it.error = None
            elif action == "clear_done":
                self.items = [
                    it
                    for it in self.items
                    if it.status not in ("completed", "cancelled", "error")
                ]

            self._save_to_disk()
            self._wake()

        if stop_paper_id:
            await stream_coordinator.stop_job(stop_paper_id[0], lang=stop_paper_id[1])

        return self.get_state()

    async def remove_item(self, item_id: str) -> QueueStateResponse:
        stop_paper_id: Optional[tuple[str, str]] = None
        async with self._lock:
            target = next((x for x in self.items if x.id == item_id), None)
            if target:
                if target.status == "running":
                    self._cancelled_ids.add(item_id)
                    stop_paper_id = (target.paper_id, target.lang)
                self.items = [x for x in self.items if x.id != item_id]
                self._save_to_disk()
                self._wake()

        if stop_paper_id:
            await stream_coordinator.stop_job(stop_paper_id[0], lang=stop_paper_id[1])
        return self.get_state()

    async def move_item(self, item_id: str, direction: str) -> QueueStateResponse:
        async with self._lock:
            idx = next((i for i, x in enumerate(self.items) if x.id == item_id), -1)
            if idx != -1 and self.items[idx].status in ("queued", "waiting_quota"):
                swap_idx = idx - 1 if direction == "up" else idx + 1
                if 0 <= swap_idx < len(self.items) and self.items[swap_idx].status != "running":
                    self.items[idx], self.items[swap_idx] = self.items[swap_idx], self.items[idx]
                    self._save_to_disk()
        return self.get_state()

    async def retry_item(self, item_id: str) -> QueueStateResponse:
        async with self._lock:
            target = next((x for x in self.items if x.id == item_id), None)
            if target and target.status in ("error", "cancelled", "waiting_quota"):
                target.status = "queued"
                target.error = None
                self._save_to_disk()
                self._wake()
        return self.get_state()

    def _seconds_until_schedule(self) -> float:
        if not self.scheduled_start_at:
            return 0.0
        try:
            target = dt.datetime.fromisoformat(self.scheduled_start_at)
            now = dt.datetime.now().astimezone()
            diff = (target - now).total_seconds()
            if diff <= 0:
                self.scheduled_start_at = None
                self.scheduled_time_label = None
                self._save_to_disk()
                return 0.0
            return diff
        except Exception:
            self.scheduled_start_at = None
            self.scheduled_time_label = None
            return 0.0

    async def _sleep_interruptible(self, seconds: float) -> None:
        self._wake_event.clear()
        try:
            await asyncio.wait_for(self._wake_event.wait(), timeout=max(0.5, seconds))
        except asyncio.TimeoutError:
            pass

    async def _worker_loop(self) -> None:
        while True:
            try:
                if self.paused:
                    await self._sleep_interruptible(30.0)
                    continue

                wait_sched = self._seconds_until_schedule()
                if wait_sched > 0:
                    await self._sleep_interruptible(min(wait_sched, 15.0))
                    continue

                async with self._lock:
                    next_item = next(
                        (x for x in self.items if x.status == "queued"),
                        None,
                    )
                    if next_item is None:
                        quota_item = next(
                            (x for x in self.items if x.status == "waiting_quota"),
                            None,
                        )
                    else:
                        quota_item = None

                if next_item is None and quota_item is None:
                    # Idle until new items are enqueued
                    await self._sleep_interruptible(60.0)
                    continue

                if next_item is None and quota_item is not None:
                    # Wait 10 minutes before automatically re-attempting after subscription quota limit
                    await self._sleep_interruptible(600.0)
                    async with self._lock:
                        if quota_item.status == "waiting_quota" and not self.paused:
                            quota_item.status = "queued"
                            self._save_to_disk()
                    continue

                assert next_item is not None
                async with self._lock:
                    self._current_running_id = next_item.id
                    next_item.status = "running"
                    next_item.error = None
                    if not next_item.started_at:
                        next_item.started_at = _now_iso()
                    use_force = next_item.force_retranslate
                    # Clear force flag after starting so any subsequent resume keeps completed chunks
                    next_item.force_retranslate = False
                    self._save_to_disk()

                doc = await stream_coordinator.run_to_completion(
                    paper_id=next_item.paper_id,
                    engine=next_item.engine,
                    force=use_force,
                    lang=next_item.lang,
                )

                async with self._lock:
                    self._current_running_id = None
                    was_cancelled = next_item.id in self._cancelled_ids
                    self._cancelled_ids.discard(next_item.id)

                    still_in_list = any(x.id == next_item.id for x in self.items)
                    if not still_in_list or was_cancelled:
                        self._save_to_disk()
                        continue

                    if doc is not None and doc.ai_status == "completed":
                        next_item.status = "completed"
                        next_item.progress = 100
                        next_item.title = doc.title or next_item.title
                        next_item.error = None
                        next_item.finished_at = _now_iso()
                    elif self.paused or (doc is not None and doc.ai_status == "paused"):
                        next_item.status = "queued"
                        if doc is not None:
                            next_item.progress = doc.ai_progress
                    else:
                        err_msg = (doc.ai_error if doc else None) or "번역 중 오류가 발생했습니다."
                        err_low = err_msg.lower()
                        is_quota_err = any(k in err_low for k in _QUOTA_ERR_KEYWORDS)
                        if doc is not None:
                            next_item.progress = doc.ai_progress

                        if is_quota_err and self.auto_retry_on_quota:
                            next_item.status = "waiting_quota"
                            next_item.error = (
                                "구독 세션 한도 도달 — 10분 주기로 확인 후 멈춘 구간부터 자동 재개됩니다."
                            )
                        else:
                            next_item.status = "error"
                            next_item.error = err_msg

                    self._save_to_disk()

            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(3.0)


queue_manager = TranslationQueueManager()
