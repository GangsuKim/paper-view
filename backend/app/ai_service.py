from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any, AsyncIterator, Optional

from .models import (
    ChatMessage,
    CitationSummaryResponse,
    CitingSentenceSnippet,
    KeyTerm,
    PaperDocument,
    PaperOverview,
    RawBodyChunk,
    ReferenceEntry,
    SenseChunk,
    SentenceAnalysis,
    SentenceItem,
    UsageQuotaItem,
    UsageStatusResponse,
)
from .storage import DATA_DIR, ensure_dirs

SYSTEM_PROMPT = (
    "You are PaperView AI, an expert academic research paper reading assistant "
    "(similar to Moonlight). Always output strictly valid JSON matching the requested schema, "
    "with natural, accurate Korean explanations and faithful technical terminology."
)

CHAT_SYSTEM_PROMPT = (
    "You are PaperView AI, a concise academic research paper Q&A partner. "
    "Answer in Korean strictly grounded in the provided paper. "
    "CRITICAL LENGTH RULE: Keep answers SHORT, CRISP, and TO THE POINT by default — "
    "start immediately with a 1–2 sentence core takeaway (no greetings, no filler intro/outro), "
    "followed by at most 2–3 short single-sentence bullet points only if needed (aim for 3–6 lines total). "
    "Do NOT write long essays or big headings (#, ##) unless the user explicitly requests a detailed explanation. "
    "Cite [p.N] or [1] inline briefly."
)

CHAT_SYSTEM_PROMPT_DETAILED = (
    "You are PaperView AI, an expert academic research paper Q&A partner. "
    "Answer the user's questions accurately and clearly in Korean based on the provided paper full text, "
    "figures, tables, equations, and references. Use clean Markdown (bullet points, bold key terms, "
    "structured sections), cite [p.N] or reference numbers like [1] when relevant, and keep technical "
    "terms natural for Korean researchers."
)

_SESSION_REQUEST_COUNT: int = 0
_SESSION_TOTAL_TOKENS: int = 0
_CACHED_USAGE_STATUS: Optional[UsageStatusResponse] = None
_CACHED_USAGE_TS: float = 0.0
_USAGE_LOCK = asyncio.Lock()


def _record_local_session_tokens(usage_obj: Any) -> None:
    global _SESSION_REQUEST_COUNT, _SESSION_TOTAL_TOKENS
    _SESSION_REQUEST_COUNT += 1
    if isinstance(usage_obj, dict):
        inp = int(usage_obj.get("input_tokens") or 0)
        out = int(usage_obj.get("output_tokens") or 0)
        _SESSION_TOTAL_TOKENS += max(0, inp + out)


def _settings_path() -> Path:
    ensure_dirs()
    return DATA_DIR / "settings.json"


def load_local_settings() -> dict[str, Any]:
    p = _settings_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_local_settings(updates: dict[str, Any]) -> dict[str, Any]:
    cur = load_local_settings()
    cur.update(updates)
    _settings_path().write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    return cur


def get_effective_gemini_key() -> Optional[str]:
    settings = load_local_settings()
    key = (
        settings.get("gemini_api_key")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or ""
    ).strip()
    return key or None


CLAUDE_EFFORT_OPTIONS = [
    {"id": "low", "label": "Low (빠른 속도 · 기본)", "desc": "지연을 최소화하여 빠르게 번역·요약"},
    {"id": "medium", "label": "Medium (균형 추론)", "desc": "속도와 추론 깊이의 균형"},
    {"id": "high", "label": "High (정밀 추론)", "desc": "복잡한 수식·문맥에 대해 깊은 추론 수행"},
    {"id": "xhigh", "label": "X-High (심층 추론)", "desc": "고난도 논리 분석용 확장 추론"},
    {"id": "max", "label": "Max (최대 추론 성능)", "desc": "최대 사고 예산 사용"},
]

ANTIGRAVITY_THINKING_OPTIONS = [
    {"id": "minimal", "label": "Minimal (최소 추론 · 초고속)", "desc": "가장 빠른 응답"},
    {"id": "low", "label": "Low (빠른 응답)", "desc": "가벼운 추론"},
    {"id": "medium", "label": "Medium (균형 추론)", "desc": "표준 추론 깊이"},
    {"id": "high", "label": "High (정밀 추론)", "desc": "깊은 사고 후 응답"},
    {"id": "extra_high", "label": "Extra High (최대 추론 성능)", "desc": "최대 사고 예산 사용"},
]

CODEX_EFFORT_OPTIONS = [
    {"id": "minimal", "label": "Minimal (최소 추론 · 초고속)", "desc": "가장 빠른 응답"},
    {"id": "low", "label": "Low (빠른 속도 · 기본)", "desc": "빠른 논문 번역·요약"},
    {"id": "medium", "label": "Medium (균형 추론)", "desc": "속도와 추론 깊이의 균형"},
    {"id": "high", "label": "High (정밀 추론)", "desc": "복잡한 수식·문맥 심층 분석"},
    {"id": "xhigh", "label": "X-High (최대 추론 성능)", "desc": "최대 사고 예산 사용"},
]

_CACHED_CLAUDE_BINARY_MODELS: Optional[list[str]] = None
_CACHED_CODEX_BINARY_MODELS: Optional[list[str]] = None
_CACHED_AGY_SDK_MODELS: Optional[list[str]] = None


def get_claude_configured_model() -> str:
    """Read user's default model configured in ~/.claude/settings.json."""
    try:
        p = Path.home() / ".claude" / "settings.json"
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            m = str(data.get("model") or "").strip()
            if m:
                return m
    except Exception:
        pass
    return "opus[1m]"


def get_claude_model_override() -> str:
    return str(load_local_settings().get("claude_model_override") or "").strip()


def get_effective_claude_model() -> str:
    """Always return the active model to pass to `--model` so it never drifts to haiku."""
    override = get_claude_model_override()
    if override:
        return override
    cfg = get_claude_configured_model()
    return cfg if cfg and cfg != "default" else "sonnet"


def get_effective_claude_effort() -> str:
    eff = str(load_local_settings().get("claude_effort") or "low").strip().lower()
    valid = {x["id"] for x in CLAUDE_EFFORT_OPTIONS}
    return eff if eff in valid else "low"


def get_effective_antigravity_model() -> str:
    m = str(load_local_settings().get("antigravity_model") or "").strip()
    return m or "gemini-3.8-flash"


def get_effective_antigravity_thinking() -> str:
    t = str(load_local_settings().get("antigravity_thinking_level") or "low").strip().lower()
    valid = {x["id"] for x in ANTIGRAVITY_THINKING_OPTIONS}
    return t if t in valid else "low"


def get_codex_configured_model() -> str:
    """Read non-secret default `model = "..."` from ~/.codex/config.toml if present."""
    try:
        p = Path.home() / ".codex" / "config.toml"
        if p.exists():
            txt = p.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r'^\s*model\s*=\s*"([^"]+)"', txt, re.MULTILINE)
            if m and m.group(1).strip():
                return m.group(1).strip()
    except Exception:
        pass
    return "gpt-5.4"


def get_codex_model_override() -> str:
    return str(load_local_settings().get("codex_model") or "").strip()


def get_effective_codex_model() -> str:
    override = get_codex_model_override()
    return override if override else get_codex_configured_model()


def get_effective_codex_effort() -> str:
    eff = str(load_local_settings().get("codex_effort") or "low").strip().lower()
    valid = {x["id"] for x in CODEX_EFFORT_OPTIONS}
    return eff if eff in valid else "low"


def _is_auxiliary_haiku(model_id: str, requested_model: str) -> bool:
    m_low = (model_id or "").lower()
    req_low = (requested_model or "").lower()
    return ("haiku" in m_low) and ("haiku" not in req_low)


def _pick_primary_model_from_usage(usage: dict[str, Any], requested_model: str) -> Optional[str]:
    if not isinstance(usage, dict) or not usage:
        return None
    candidates = list(usage.keys())
    non_aux = [k for k in candidates if not _is_auxiliary_haiku(k, requested_model)]
    pool = non_aux if non_aux else candidates

    def _tok_sum(k: str) -> int:
        v = usage.get(k)
        if not isinstance(v, dict):
            return 0
        return int(v.get("outputTokens", 0)) * 10 + int(v.get("inputTokens", 0)) + int(
            v.get("cacheReadInputTokens", 0)
        )

    return max(pool, key=_tok_sum)


def record_detected_claude_model(model_id: str, requested_model: str = "") -> None:
    clean = (model_id or "").strip()
    if not clean:
        return
    req = requested_model or get_effective_claude_model()
    if _is_auxiliary_haiku(clean, req):
        return
    cur = load_local_settings()
    if cur.get("last_detected_claude_model") != clean:
        save_local_settings({"last_detected_claude_model": clean})


def get_claude_model_summary() -> dict[str, str]:
    settings = load_local_settings()
    configured = get_claude_configured_model()
    override = str(settings.get("claude_model_override") or "").strip()
    effective_req = override or configured
    detected = str(settings.get("last_detected_claude_model") or "").strip()
    # Clean up if a previous auxiliary haiku call polluted last_detected_claude_model
    if detected and _is_auxiliary_haiku(detected, effective_req):
        detected = ""
        save_local_settings({"last_detected_claude_model": ""})
    display = detected or override or configured
    return {
        "display_model": display,
        "detected_model": detected,
        "configured_model": configured,
        "model_override": override,
        "effort": get_effective_claude_effort(),
    }


def _discover_claude_models_on_pc(refresh: bool = False) -> list[dict[str, str]]:
    global _CACHED_CLAUDE_BINARY_MODELS
    configured = get_claude_configured_model()

    if _CACHED_CLAUDE_BINARY_MODELS is None or refresh:
        found_ids: set[str] = set()
        c_bin = find_claude_binary()
        if c_bin:
            try:
                raw_bytes = Path(c_bin).read_bytes()
                for m in re.findall(rb"claude-(?:opus|sonnet|haiku)-\d+(?:-\d+)*(?:-\d{8})?", raw_bytes):
                    s = m.decode("ascii", errors="ignore")
                    if re.fullmatch(r"claude-(?:opus|sonnet|haiku)-\d+(?:-\d+)*(?:-\d{8})?", s):
                        found_ids.add(s)
            except Exception:
                pass
        _CACHED_CLAUDE_BINARY_MODELS = sorted(found_ids)

    # Separate clean family aliases/undated IDs first, then dated snapshots
    undated = [m for m in (_CACHED_CLAUDE_BINARY_MODELS or []) if not re.search(r"-\d{8}$", m)]
    dated = [m for m in (_CACHED_CLAUDE_BINARY_MODELS or []) if re.search(r"-\d{8}$", m)]

    # Sort newest version numbers first
    undated.sort(reverse=True)
    dated.sort(reverse=True)

    items: list[dict[str, str]] = [
        {
            "id": "",
            "label": f"PC 기본 설정 ({configured})",
            "group": "기본 및 별칭",
        },
    ]
    seen: set[str] = {""}
    for alias, desc in [
        ("opus[1m]", "Claude Opus (1M Long Context)"),
        ("sonnet[1m]", "Claude Sonnet (1M Long Context)"),
        ("opus", "Claude Opus 최신 별칭"),
        ("sonnet", "Claude Sonnet 최신 별칭"),
        ("haiku", "Claude Haiku 최신 별칭"),
    ]:
        if alias not in seen:
            items.append({"id": alias, "label": f"{alias} — {desc}", "group": "기본 및 별칭"})
            seen.add(alias)

    for m in undated:
        if m not in seen:
            items.append({"id": m, "label": m, "group": "설치된 Claude CLI 모델"})
            seen.add(m)

    for m in dated:
        if m not in seen:
            items.append({"id": m, "label": f"{m} (스냅샷)", "group": "버전 고정 스냅샷"})
            seen.add(m)

    return items


def _discover_antigravity_models_on_pc(refresh: bool = False) -> list[dict[str, str]]:
    global _CACHED_AGY_SDK_MODELS
    if _CACHED_AGY_SDK_MODELS is None or refresh:
        sdk_models: set[str] = set()
        try:
            import google.antigravity as agy

            agy_dir = Path(agy.__file__).resolve().parent
            for py_file in agy_dir.rglob("*.py"):
                txt = py_file.read_text("utf-8", errors="ignore")
                for m in re.findall(r"gemini-[0-9][0-9a-z.-]{1,32}", txt):
                    clean_m = m.rstrip(".-")
                    if "image" not in clean_m and "embedding" not in clean_m:
                        sdk_models.add(clean_m)
        except Exception:
            pass
        _CACHED_AGY_SDK_MODELS = sorted(sdk_models, reverse=True)

    live_api_models: list[str] = []
    api_key = get_effective_gemini_key()
    if api_key:
        try:
            from google import genai

            client = genai.Client(api_key=api_key)
            for m in client.models.list():
                name = str(getattr(m, "name", "") or "").replace("models/", "").strip()
                actions = getattr(m, "supported_actions", None) or []
                if name.startswith("gemini-") and (not actions or "generateContent" in actions):
                    if "image" not in name and "tts" not in name and "embedding" not in name:
                        live_api_models.append(name)
        except Exception:
            pass

    items: list[dict[str, str]] = []
    seen: set[str] = set()

    for m in sorted(set(live_api_models), reverse=True):
        if m not in seen:
            items.append({"id": m, "label": f"{m} (API 실시간 조회됨)", "group": "연결된 Gemini API 모델"})
            seen.add(m)

    for m in (_CACHED_AGY_SDK_MODELS or []):
        if m not in seen:
            items.append({"id": m, "label": m, "group": "Antigravity SDK 내장 모델"})
            seen.add(m)

    return items


def _discover_codex_models_on_pc(refresh: bool = False) -> list[dict[str, str]]:
    global _CACHED_CODEX_BINARY_MODELS
    configured = get_codex_configured_model()

    if _CACHED_CODEX_BINARY_MODELS is None or refresh:
        found: set[str] = set()
        cx_bin = find_codex_binary()
        if cx_bin:
            try:
                raw_bytes = Path(cx_bin).read_bytes()
                for m in re.findall(
                    rb"gpt-[456]\.[0-9](?:-(?:codex(?:-max|-mini)?|sol|luna|terra|mini|pro))?",
                    raw_bytes,
                ):
                    s = m.decode("ascii", errors="ignore")
                    found.add(s)
            except Exception:
                pass
        _CACHED_CODEX_BINARY_MODELS = sorted(found, reverse=True)

    items: list[dict[str, str]] = [
        {
            "id": "",
            "label": f"PC 기본 설정 ({configured})",
            "group": "기본 및 추천 모델",
        }
    ]
    seen: set[str] = {""}

    curated = [
        ("gpt-5.4", "GPT-5.4 (최신 범용 플래그십)"),
        ("gpt-5.3-codex", "GPT-5.3 Codex"),
        ("gpt-5.2-codex", "GPT-5.2 Codex"),
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5.1-codex-max", "GPT-5.1 Codex Max"),
        ("o3", "OpenAI o3 (추론 특화)"),
        ("o4-mini", "OpenAI o4-mini (고속 추론)"),
    ]
    for mid, desc in curated:
        if mid not in seen:
            items.append({"id": mid, "label": f"{mid} — {desc}", "group": "기본 및 추천 모델"})
            seen.add(mid)

    for m in (_CACHED_CODEX_BINARY_MODELS or []):
        if m not in seen:
            items.append({"id": m, "label": m, "group": "설치된 Codex CLI 감지 모델"})
            seen.add(m)

    return items


def discover_all_models_catalog(refresh: bool = False) -> dict[str, Any]:
    return {
        "claude": {
            "models": _discover_claude_models_on_pc(refresh=refresh),
            "efforts": CLAUDE_EFFORT_OPTIONS,
            "selected_model": get_claude_model_override(),
            "effective_model": get_effective_claude_model(),
            "detected_model": get_claude_model_summary()["detected_model"],
            "configured_model": get_claude_configured_model(),
            "selected_effort": get_effective_claude_effort(),
        },
        "codex": {
            "models": _discover_codex_models_on_pc(refresh=refresh),
            "efforts": CODEX_EFFORT_OPTIONS,
            "selected_model": get_codex_model_override(),
            "effective_model": get_effective_codex_model(),
            "configured_model": get_codex_configured_model(),
            "selected_effort": get_effective_codex_effort(),
        },
        "antigravity": {
            "models": _discover_antigravity_models_on_pc(refresh=refresh),
            "efforts": ANTIGRAVITY_THINKING_OPTIONS,
            "selected_model": get_effective_antigravity_model(),
            "selected_effort": get_effective_antigravity_thinking(),
        },
    }


def find_claude_binary() -> Optional[str]:
    found = shutil.which("claude")
    if found:
        return found
    candidates = [
        Path.home() / ".local" / "bin" / "claude.exe",
        Path.home() / ".local" / "bin" / "claude",
        Path(os.environ.get("APPDATA", "")) / "npm" / "claude.cmd",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "claude" / "claude.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def find_codex_binary() -> Optional[str]:
    """Locate OpenAI Codex CLI on PATH, npm global prefix, or bundled inside VS Code / Antigravity extensions."""
    found = shutil.which("codex")
    if found:
        return found

    direct_candidates = [
        Path(os.environ.get("APPDATA", "")) / "npm" / "codex.cmd",
        Path(os.environ.get("APPDATA", "")) / "npm" / "codex.exe",
        Path.home() / ".local" / "bin" / "codex.exe",
        Path.home() / ".local" / "bin" / "codex",
    ]
    for c in direct_candidates:
        if c.exists():
            return str(c)

    # Check VS Code / Antigravity / Cursor bundled OpenAI ChatGPT/Codex extension binaries (newest version first)
    ext_roots = [
        Path.home() / ".vscode" / "extensions",
        Path.home() / ".antigravity" / "extensions",
        Path.home() / ".cursor" / "extensions",
    ]
    bundled: list[Path] = []
    bin_names = ("codex.exe", "codex")
    for root in ext_roots:
        if not root.exists():
            continue
        for ext_dir in root.glob("openai.chatgpt-*"):
            bin_root = ext_dir / "bin"
            if not bin_root.exists():
                continue
            for bname in bin_names:
                for match in bin_root.glob(f"*/{bname}"):
                    if match.is_file():
                        bundled.append(match)
    if bundled:
        bundled.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return str(bundled[0])

    return None


def find_agy_binary() -> Optional[str]:
    found = shutil.which("agy")
    if found:
        return found
    candidates = [
        Path.home() / ".local" / "bin" / "agy.exe",
        Path.home() / ".local" / "bin" / "agy",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "antigravity" / "bin" / "agy.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def is_antigravity_sdk_installed() -> bool:
    try:
        import google.antigravity  # noqa: F401
        return True
    except Exception:
        return False


def is_antigravity_ready() -> bool:
    if find_agy_binary() is not None:
        return True
    if not is_antigravity_sdk_installed():
        return False
    if get_effective_gemini_key():
        return True
    if os.environ.get("GOOGLE_CLOUD_PROJECT") and os.environ.get("GOOGLE_CLOUD_LOCATION"):
        return True
    return False


def get_engines_status() -> list[dict[str, Any]]:
    claude_bin = find_claude_binary()
    codex_bin = find_codex_binary()
    agy_bin = find_agy_binary()
    agy_sdk = is_antigravity_sdk_installed()
    agy_ready = is_antigravity_ready()

    if agy_bin:
        agy_detail = f"로컬 Antigravity CLI ({Path(agy_bin).name}) 연결됨"
    elif agy_ready:
        agy_detail = "google-antigravity SDK 연결됨"
    elif agy_sdk:
        agy_detail = "google-antigravity SDK 설치됨 (클릭하여 GEMINI_API_KEY 등록 또는 agy CLI 연동)"
    else:
        agy_detail = "google-antigravity 미설치"

    claude_models = get_claude_model_summary()
    claude_detail = (
        f"모델: {claude_models['display_model']} · 추론: {claude_models['effort']}"
        if claude_bin
        else "claude CLI 미설치"
    )

    codex_model = get_effective_codex_model()
    codex_effort = get_effective_codex_effort()
    codex_detail = (
        f"ChatGPT 로그인 세션 · 모델: {codex_model} · 추론: {codex_effort}"
        if codex_bin
        else "codex CLI 미설치"
    )

    agy_model = get_effective_antigravity_model()
    agy_effort = get_effective_antigravity_thinking()

    return [
        {
            "id": "claude",
            "name": "Claude (Local CLI)",
            "available": claude_bin is not None,
            "needs_key": False,
            "active_model": claude_models["display_model"],
            "detected_model": claude_models["detected_model"],
            "configured_model": claude_models["configured_model"],
            "model_override": claude_models["model_override"],
            "reasoning_effort": claude_models["effort"],
            "detail": claude_detail,
        },
        {
            "id": "codex",
            "name": "Codex (ChatGPT CLI)",
            "available": codex_bin is not None,
            "needs_key": False,
            "active_model": codex_model,
            "configured_model": get_codex_configured_model(),
            "model_override": get_codex_model_override(),
            "reasoning_effort": codex_effort,
            "detail": codex_detail,
        },
        {
            "id": "antigravity",
            "name": "Antigravity (SDK)",
            "available": agy_ready,
            "needs_key": bool(agy_sdk and not agy_ready),
            "active_model": agy_model,
            "model_override": agy_model,
            "reasoning_effort": agy_effort,
            "detail": agy_detail,
        },
    ]


class _AntigravityPool:
    """Keeps a warm local Antigravity Agent instance to minimize per-request startup latency."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._agent: Any = None
        self._turns = 0
        self._active_sig: Optional[tuple[Optional[str], str, str]] = None

    async def reset(self) -> None:
        if self._agent is not None:
            try:
                await self._agent.__aexit__(None, None, None)
            except Exception:
                pass
            self._agent = None
            self._turns = 0

    def _build_local_config(self, api_key: Optional[str], model_name: str, thinking_str: str) -> Any:
        from google.antigravity import (
            CapabilitiesConfig,
            GeminiAPIEndpoint,
            GeminiModelOptions,
            LocalAgentConfig,
            ModelTarget,
            ThinkingLevel,
        )

        level_map = {m.value: m for m in ThinkingLevel}
        t_level = level_map.get(thinking_str, ThinkingLevel.LOW)

        kwargs: dict[str, Any] = {
            "system_instructions": SYSTEM_PROMPT,
            "capabilities": CapabilitiesConfig(
                enable_subagents=False,
                enabled_tools=[],
            ),
        }
        if api_key:
            kwargs["model"] = ModelTarget(
                name=model_name,
                endpoint=GeminiAPIEndpoint(
                    api_key=api_key,
                    options=GeminiModelOptions(thinking_level=t_level),
                ),
            )
        else:
            kwargs["model"] = model_name
        return LocalAgentConfig(**kwargs)

    async def ask(self, prompt: str, timeout: float = 90.0) -> str:
        from google.antigravity import Agent

        api_key = get_effective_gemini_key()
        model_name = get_effective_antigravity_model()
        thinking_str = get_effective_antigravity_thinking()
        sig = (api_key, model_name, thinking_str)

        async with self._lock:
            if self._agent is not None and (self._turns >= 8 or self._active_sig != sig):
                await self.reset()

            if self._agent is None:
                cfg = self._build_local_config(api_key, model_name, thinking_str)
                agent_inst = Agent(cfg)
                await asyncio.wait_for(agent_inst.__aenter__(), timeout=35.0)
                self._agent = agent_inst
                self._active_sig = sig
                self._turns = 0

            try:
                resp = await asyncio.wait_for(self._agent.chat(prompt), timeout=timeout)
                parts: list[str] = []

                async def _drain() -> None:
                    async for tok in resp:
                        parts.append(str(tok))

                await asyncio.wait_for(_drain(), timeout=timeout)
                self._turns += 1
                return "".join(parts).strip()
            except Exception:
                await self.reset()
                raise

    async def stream_ask(self, prompt: str, timeout: float = 180.0) -> AsyncIterator[str]:
        from google.antigravity import Agent

        api_key = get_effective_gemini_key()
        model_name = get_effective_antigravity_model()
        thinking_str = get_effective_antigravity_thinking()
        sig = (api_key, model_name, thinking_str)

        async with self._lock:
            if self._agent is not None and (self._turns >= 8 or self._active_sig != sig):
                await self.reset()

            if self._agent is None:
                cfg = self._build_local_config(api_key, model_name, thinking_str)
                agent_inst = Agent(cfg)
                await asyncio.wait_for(agent_inst.__aenter__(), timeout=35.0)
                self._agent = agent_inst
                self._active_sig = sig
                self._turns = 0

            try:
                resp = await asyncio.wait_for(self._agent.chat(prompt), timeout=timeout)
                async for tok in resp:
                    if tok:
                        yield str(tok)
                self._turns += 1
            except Exception:
                await self.reset()
                raise


_agy_pool = _AntigravityPool()


async def _run_claude_once(claude_bin: str, prompt: str, timeout: float) -> tuple[int, str, str]:
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    # Always strip ANTHROPIC_API_KEY so PaperView strictly uses the local Claude Code OAuth subscription
    # and never triggers paid Anthropic API billing.
    env.pop("ANTHROPIC_API_KEY", None)
    env["PYTHONIOENCODING"] = "utf-8"

    effective_model = get_effective_claude_model()
    effective_effort = get_effective_claude_effort()

    cmd = [
        claude_bin,
        "-p",
        "--output-format",
        "json",
        "--model",
        effective_model,
        "--effort",
        effective_effort,
        "--strict-mcp-config",
        "--no-session-persistence",
        "--tools",
        "",
        "--system-prompt",
        SYSTEM_PROMPT,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        limit=8 * 1024 * 1024,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode("utf-8")),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("Claude CLI 응답 시간이 초과되었습니다.")

    raw_out = stdout.decode("utf-8", errors="replace").strip()
    err_out = stderr.decode("utf-8", errors="replace").strip()

    if raw_out.startswith("{"):
        try:
            env_obj = json.loads(raw_out)
            if isinstance(env_obj, dict) and "result" in env_obj:
                _record_local_session_tokens(env_obj.get("usage"))
                usage = env_obj.get("modelUsage")
                primary_m = _pick_primary_model_from_usage(usage, effective_model) if isinstance(usage, dict) else None
                if primary_m:
                    record_detected_claude_model(str(primary_m), requested_model=effective_model)
                if env_obj.get("is_error"):
                    return 1, "", str(env_obj.get("result") or err_out)
                raw_out = str(env_obj.get("result") or "").strip()
        except Exception:
            pass

    return (
        proc.returncode or 0,
        raw_out,
        err_out,
    )


async def _call_claude_cli(prompt: str, timeout: float = 90.0) -> str:
    claude_bin = find_claude_binary()
    if not claude_bin:
        raise RuntimeError("로컬에서 Claude CLI 실행 파일을 찾을 수 없습니다.")

    # Strictly use local Claude Code OAuth login session (never fall back to paid ANTHROPIC_API_KEY)
    rc, out_text, err_text = await _run_claude_once(
        claude_bin, prompt, timeout=timeout
    )
    if rc == 0 and out_text:
        return out_text

    detail = err_text or out_text or f"exit code {rc}"
    raise RuntimeError(f"Claude CLI 호출 실패: {detail[:300]}")


async def _call_codex_cli(prompt: str, timeout: float = 120.0) -> str:
    """Execute prompt non-interactively via OpenAI Codex CLI (`codex exec`) using local ChatGPT OAuth login."""
    chunks: list[str] = []
    async for delta, _ in _stream_codex_cli(prompt, system_prompt=SYSTEM_PROMPT, timeout=timeout):
        if delta:
            chunks.append(delta)
    res = "".join(chunks).strip()
    if not res:
        raise RuntimeError("Codex CLI 응답이 비어 있습니다.")
    return res


def resolve_display_model_for_engine(used_engine: str) -> tuple[str, str]:
    if used_engine == "claude":
        return get_claude_model_summary()["display_model"], get_effective_claude_effort()
    if used_engine == "codex":
        return get_effective_codex_model(), get_effective_codex_effort()
    return get_effective_antigravity_model(), get_effective_antigravity_thinking()


async def run_local_llm(prompt: str, engine: str = "auto") -> tuple[str, str]:
    """
    Execute prompt on the chosen local engine ('claude' | 'codex' | 'antigravity' | 'auto').
    Returns (response_text, resolved_engine_id).
    """
    claude_ok = find_claude_binary() is not None
    codex_ok = find_codex_binary() is not None
    agy_ok = is_antigravity_ready()

    if engine == "claude":
        order = ["claude"]
    elif engine == "codex":
        order = ["codex"]
    elif engine == "antigravity":
        order = ["antigravity"]
    else:
        order = []
        if claude_ok:
            order.append("claude")
        if codex_ok:
            order.append("codex")
        if agy_ok:
            order.append("antigravity")

    if not order:
        if engine == "antigravity" and is_antigravity_sdk_installed():
            raise RuntimeError(
                "Antigravity SDK 실행을 위해 상단 설정에서 GEMINI_API_KEY를 입력하거나 Claude / Codex 엔진을 선택해주세요."
            )
        raise RuntimeError("사용 가능한 로컬 AI 엔진(Claude CLI, Codex CLI 또는 Antigravity SDK)이 없습니다.")

    last_err: Optional[Exception] = None
    for eng in order:
        try:
            if eng == "claude":
                res = await _call_claude_cli(prompt)
                if res:
                    return res, "claude"
            elif eng == "codex":
                res = await _call_codex_cli(prompt)
                if res:
                    return res, "codex"
            elif eng == "antigravity":
                res = await _agy_pool.ask(prompt)
                if res:
                    return res, "antigravity"
        except Exception as exc:
            last_err = exc
            continue

    raise RuntimeError(f"로컬 AI 호출 중 오류가 발생했습니다: {last_err}")


def _extract_json_obj(raw: str) -> Any:
    """Resiliently extract JSON object/array from LLM markdown or plain text response."""
    cleaned = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fence:
        cand = fence.group(1).strip()
        try:
            return json.loads(cand)
        except Exception:
            pass

    try:
        return json.loads(cleaned)
    except Exception:
        pass

    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        sub = cleaned[first_brace : last_brace + 1]
        for cand in (sub, _sanitize_latex_json_escapes(sub)):
            try:
                return json.loads(cand)
            except Exception:
                pass

    first_arr = cleaned.find("[")
    last_arr = cleaned.rfind("]")
    if first_arr != -1 and last_arr > first_arr:
        try:
            return json.loads(cleaned[first_arr : last_arr + 1])
        except Exception:
            pass

    raise ValueError(f"AI 응답을 JSON으로 파싱하지 못했습니다: {raw[:240]}")


async def analyze_sentence_sense_groups(
    paper_title: str,
    section: str,
    sentence: SentenceItem,
    engine: str = "auto",
) -> SentenceAnalysis:
    prompt = f"""다음 영어 학술 논문 문장을 '의미 단위(Sense Groups / 직독직해 끊어읽기)'로 분해하고 한국어 해석을 작성해주세요.

[논문 제목]: {paper_title}
[섹션]: {section}
[원문 문장]:
{sentence.text}

요구사항:
1. `chunks`: 원문 문장의 어순을 그대로 유지하면서 의미 단위(구/절 단위, 보통 2~7개 청크)로 자연스럽게 끊어주세요. 모든 `en` 조각을 순서대로 이어붙이면 원문 전체가 되어야 합니다.
2. 각 청크의 `ko`는 해당 영어 조각에 대응하는 간결하고 정확한 직독직해 한국어 뜻입니다.
3. 각 청크의 `role`은 짧은 문법/의미 역할 태그입니다 (예: "배경/전제", "주어부", "핵심 동사", "목적어", "수식절", "결과/효과").
4. `natural_ko`: 학술 논문 문체에 맞는 매끄럽고 자연스러운 전체 한국어 번역입니다.
5. `key_terms`: 문장 내 중요한 전문 용어가 있다면 1~3개만 간단히 설명해주세요 (없으면 빈 배열 `[]`).

반드시 아래 JSON 형식으로만 응답하세요 (코드블록 외 다른 설명 금지):
{{
  "chunks": [
    {{"en": "영어 의미 단위 조각", "ko": "직독직해 뜻", "role": "역할"}}
  ],
  "natural_ko": "매끄러운 전체 한국어 해석",
  "key_terms": [
    {{"term": "전문 용어", "meaning": "짧은 핵심 설명"}}
  ]
}}"""

    raw_out, used_engine = await run_local_llm(prompt, engine=engine)
    data = _extract_json_obj(raw_out)

    chunks = [
        SenseChunk(
            en=str(c.get("en", "")).strip(),
            ko=str(c.get("ko", "")).strip(),
            role=(str(c.get("role", "")).strip() or None),
        )
        for c in (data.get("chunks") or [])
        if c.get("en")
    ]
    if not chunks:
        chunks = [SenseChunk(en=sentence.text, ko=str(data.get("natural_ko", "")), role=None)]

    key_terms = [
        KeyTerm(term=str(t.get("term", "")).strip(), meaning=str(t.get("meaning", "")).strip())
        for t in (data.get("key_terms") or [])
        if t.get("term") and t.get("meaning")
    ]

    return SentenceAnalysis(
        sentence_id=sentence.id,
        engine=used_engine,
        chunks=chunks,
        natural_ko=str(data.get("natural_ko") or "").strip(),
        key_terms=key_terms,
    )


async def analyze_batch_sentences(
    paper_title: str,
    sentences: list[SentenceItem],
    engine: str = "auto",
) -> list[SentenceAnalysis]:
    """Analyze multiple sentences (e.g. a paragraph/section slice) in a single local AI call."""
    if not sentences:
        return []
    items_payload = [{"id": s.id, "section": s.section, "text": s.text} for s in sentences[:8]]
    prompt = f"""다음 영어 학술 논문 문장들을 각각 '의미 단위(Sense Groups / 직독직해 끊어읽기)'로 분해하고 한국어 해석을 작성해주세요.

[논문 제목]: {paper_title}
[대상 문장 목록]:
{json.dumps(items_payload, ensure_ascii=False, indent=2)}

반드시 아래 JSON 배열 형식으로만 응답하세요:
[
  {{
    "sentence_id": "문장 id 그대로",
    "chunks": [
      {{"en": "영어 의미 단위 조각", "ko": "직독직해 뜻", "role": "역할"}}
    ],
    "natural_ko": "전체 한국어 자연스러운 해석",
    "key_terms": [
      {{"term": "용어", "meaning": "짧은 설명"}}
    ]
  }}
]"""

    raw_out, used_engine = await run_local_llm(prompt, engine=engine)
    arr = _extract_json_obj(raw_out)
    if isinstance(arr, dict) and "items" in arr:
        arr = arr["items"]
    if not isinstance(arr, list):
        raise ValueError("일괄 분석 응답 형식이 올바르지 않습니다.")

    by_id = {s.id: s for s in sentences}
    results: list[SentenceAnalysis] = []
    for item in arr:
        sid = str(item.get("sentence_id") or "")
        if sid not in by_id:
            continue
        chunks = [
            SenseChunk(
                en=str(c.get("en", "")).strip(),
                ko=str(c.get("ko", "")).strip(),
                role=(str(c.get("role", "")).strip() or None),
            )
            for c in (item.get("chunks") or [])
            if c.get("en")
        ]
        key_terms = [
            KeyTerm(term=str(t.get("term", "")).strip(), meaning=str(t.get("meaning", "")).strip())
            for t in (item.get("key_terms") or [])
            if t.get("term") and t.get("meaning")
        ]
        results.append(
            SentenceAnalysis(
                sentence_id=sid,
                engine=used_engine,
                chunks=chunks or [SenseChunk(en=by_id[sid].text, ko=str(item.get("natural_ko", "")))],
                natural_ko=str(item.get("natural_ko") or "").strip(),
                key_terms=key_terms,
            )
        )
    return results


async def summarize_cited_paper(
    current_paper_title: str,
    citing_contexts: list[CitingSentenceSnippet],
    ref_entry: ReferenceEntry,
    cited_content: str,
    source_type: str,
    source_label: str,
    engine: str = "auto",
    main_figure_url: Optional[str] = None,
    main_figure_caption: Optional[str] = None,
) -> CitationSummaryResponse:
    citing_text = (
        "\n".join(f"- (p.{c.page}, {c.section}): {c.text}" for c in citing_contexts[:5])
        if citing_contexts
        else "(본문 내 직접 매칭된 인용 문장 없음)"
    )

    prompt = f"""사용자가 논문을 읽다가 인용 번호 [{ref_entry.ref_key}]를 클릭해 '간단 요약'을 요청했습니다.
제공된 인용 논문 텍스트와 현재 논문의 인용 문맥을 바탕으로 핵심만 명쾌하게 한국어로 요약해주세요.

[현재 읽고 있는 논문]: {current_paper_title}
[현재 논문에서 [{ref_entry.ref_key}]를 인용한 문장들]:
{citing_text}

[인용된 논문 서지 정보]:
- 제목: {ref_entry.title or 'Unknown'}
- 저자: {', '.join(ref_entry.authors) if ref_entry.authors else 'Unknown'}
- 연도/학회: {ref_entry.year or 'Unknown'} / {ref_entry.venue or 'Unknown'}
- 원문 참조 문자열: {ref_entry.raw_text}

[확보된 인용 논문 텍스트 ({source_label})]:
{cited_content[:14000]}

반드시 아래 JSON 형식으로만 응답하세요 (코드블록 외 다른 텍스트 금지):
{{
  "tldr": "이 인용 논문이 무엇을 제안/해결한 논문인지 한 문장 핵심 요약 (한국어)",
  "summary_points": [
    "문제의식/배경: ...",
    "핵심 방법/아이디어: ...",
    "주요 결과 및 의의: ..."
  ],
  "why_cited": "현재 읽고 있는 논문에서 이 논문을 왜 인용했는지(예: 기반 아키텍처, 비교 대상, 한계점 지적, 개념 차용 등) 구체적 맥락 설명"
}}"""

    raw_out, used_engine = await run_local_llm(prompt, engine=engine)
    data = _extract_json_obj(raw_out)

    points = [str(p).strip() for p in (data.get("summary_points") or []) if str(p).strip()]
    if not points and data.get("summary"):
        points = [str(data["summary"]).strip()]

    used_model, used_effort = resolve_display_model_for_engine(used_engine)

    return CitationSummaryResponse(
        ref_key=ref_entry.ref_key,
        engine=used_engine,
        model_name=used_model,
        reasoning_effort=used_effort,
        source_type=source_type,
        source_label=source_label,
        main_figure_url=main_figure_url,
        main_figure_caption=main_figure_caption,
        tldr=str(data.get("tldr") or "").strip(),
        summary_points=points,
        why_cited=str(data.get("why_cited") or "").strip(),
    )


async def _stream_claude_cli(
    prompt: str,
    system_prompt: Optional[str] = None,
) -> AsyncIterator[tuple[str, Optional[str]]]:
    claude_bin = find_claude_binary()
    if not claude_bin:
        raise RuntimeError("로컬에서 Claude CLI 실행 파일을 찾을 수 없습니다.")

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    # Always strip ANTHROPIC_API_KEY so PaperView strictly uses local Claude Code OAuth subscription
    env.pop("ANTHROPIC_API_KEY", None)
    env["PYTHONIOENCODING"] = "utf-8"

    effective_model = get_effective_claude_model()
    effective_effort = get_effective_claude_effort()

    cmd = [
        claude_bin,
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--model",
        effective_model,
        "--effort",
        effective_effort,
        "--strict-mcp-config",
        "--no-session-persistence",
        "--tools",
        "",
        "--system-prompt",
        system_prompt or SYSTEM_PROMPT,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        limit=8 * 1024 * 1024,
    )
    assert proc.stdin and proc.stdout and proc.stderr

    try:
        proc.stdin.write(prompt.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()

        emitted_delta = False
        fallback_result_text = ""
        current_model: Optional[str] = None

        while True:
            raw_line = await proc.stdout.readline()
            if not raw_line:
                break
            line_str = raw_line.decode("utf-8", errors="replace").strip()
            if not line_str or not line_str.startswith("{"):
                continue
            try:
                obj = json.loads(line_str)
            except Exception:
                continue

            ev_type = obj.get("type")
            if ev_type == "stream_event":
                ev = obj.get("event") or {}
                if ev.get("type") == "message_start":
                    msg_model = str((ev.get("message") or {}).get("model") or "").strip()
                    if msg_model and not _is_auxiliary_haiku(msg_model, effective_model):
                        current_model = msg_model
                        record_detected_claude_model(msg_model, requested_model=effective_model)
                        yield "", current_model
                elif ev.get("type") == "content_block_delta":
                    delta = ev.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        emitted_delta = True
                        yield str(delta["text"]), current_model
            elif ev_type == "assistant" and not current_model:
                msg_model = str((obj.get("message") or {}).get("model") or "").strip()
                if msg_model and not _is_auxiliary_haiku(msg_model, effective_model):
                    current_model = msg_model
                    record_detected_claude_model(msg_model, requested_model=effective_model)
            elif ev_type == "result":
                _record_local_session_tokens(obj.get("usage"))
                usage = obj.get("modelUsage")
                if isinstance(usage, dict) and usage and not current_model:
                    picked = _pick_primary_model_from_usage(usage, effective_model)
                    if picked:
                        current_model = str(picked)
                        record_detected_claude_model(current_model, requested_model=effective_model)
                if obj.get("is_error"):
                    raise RuntimeError(str(obj.get("result") or "Claude stream error"))
                if obj.get("result"):
                    fallback_result_text = str(obj["result"])

        rc = await proc.wait()
        if not emitted_delta and fallback_result_text:
            yield fallback_result_text, current_model
        elif rc != 0 and not emitted_delta:
            err_bytes = await proc.stderr.read()
            err_msg = err_bytes.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"Claude 스트리밍 실패 (code {rc}): {err_msg[:300]}")
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass


async def _stream_codex_cli(
    prompt: str,
    system_prompt: Optional[str] = None,
    timeout: float = 180.0,
) -> AsyncIterator[tuple[str, Optional[str]]]:
    """
    Stream real-time text from local OpenAI Codex CLI (`codex exec --json`),
    unconditionally stripping OPENAI_API_KEY so only ChatGPT OAuth subscription is used.
    """
    codex_bin = find_codex_binary()
    if not codex_bin:
        raise RuntimeError("로컬에서 OpenAI Codex CLI 실행 파일을 찾을 수 없습니다.")

    env = os.environ.copy()
    # Strictly strip OPENAI_API_KEY so PaperView never triggers pay-per-token OpenAI API billing
    env.pop("OPENAI_API_KEY", None)
    env["PYTHONIOENCODING"] = "utf-8"

    model_override = get_codex_model_override()
    effective_model = get_effective_codex_model()
    effective_effort = get_effective_codex_effort()

    cmd = [
        codex_bin,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        f'model_reasoning_effort="{effective_effort}"',
        "--color",
        "never",
        "--json",
    ]
    if model_override:
        cmd.extend(["-m", model_override])
    cmd.append("-")

    combined_input = f"[System Instructions]\n{system_prompt or SYSTEM_PROMPT}\n\n{prompt}"

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        limit=8 * 1024 * 1024,
    )
    assert proc.stdin and proc.stdout and proc.stderr

    try:
        proc.stdin.write(combined_input.encode("utf-8"))
        await proc.stdin.drain()
        proc.stdin.close()

        yield "", effective_model

        emitted_by_item: dict[str, int] = {}
        emitted_any = False
        last_err_msg = ""

        while True:
            raw_line = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
            if not raw_line:
                break
            line_str = raw_line.decode("utf-8", errors="replace").strip()
            if not line_str or not line_str.startswith("{"):
                continue
            try:
                obj = json.loads(line_str)
            except Exception:
                continue

            ev_type = obj.get("type")
            if ev_type in ("item.updated", "item.completed"):
                item = obj.get("item") or {}
                itype = item.get("type")
                if itype == "agent_message":
                    item_id = str(item.get("id") or "msg")
                    full_txt = str(item.get("text") or "")
                    prev_len = emitted_by_item.get(item_id, 0)
                    if len(full_txt) > prev_len:
                        delta = full_txt[prev_len:]
                        emitted_by_item[item_id] = len(full_txt)
                        emitted_any = True
                        yield delta, effective_model
                elif itype == "error" and item.get("message"):
                    msg = str(item["message"])
                    if "Model metadata" not in msg:
                        last_err_msg = msg
            elif ev_type == "turn.completed":
                _record_local_session_tokens(obj.get("usage"))
            elif ev_type == "turn.failed":
                err_obj = obj.get("error") or {}
                last_err_msg = str(err_obj.get("message") or last_err_msg or "Codex turn failed")
            elif ev_type == "error" and obj.get("message"):
                last_err_msg = str(obj["message"])

        rc = await proc.wait()
        if rc != 0 and not emitted_any:
            err_bytes = await proc.stderr.read()
            stderr_txt = err_bytes.decode("utf-8", errors="replace").strip()
            detail = last_err_msg or stderr_txt[:260] or f"code {rc}"
            if "workspace routing discovery failed" in detail.lower():
                raise RuntimeError(
                    "Codex CLI 연결 실패 (workspace routing discovery failed): "
                    "ChatGPT 구독(Plus/Pro) 상태 및 일반 터미널에서 `codex login` 재인증 또는 네트워크 연결을 확인해주세요."
                )
            raise RuntimeError(f"Codex CLI 실행 실패: {detail}")
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass


async def stream_local_llm_text(
    prompt: str,
    engine: str = "auto",
    system_prompt: Optional[str] = None,
) -> AsyncIterator[tuple[str, str, Optional[str]]]:
    """Yield (text_delta, resolved_engine, model_name) in real time from Claude CLI, Codex CLI, or Antigravity SDK."""
    claude_ok = find_claude_binary() is not None
    codex_ok = find_codex_binary() is not None
    agy_ok = is_antigravity_ready()

    if engine == "claude":
        chosen = "claude"
    elif engine == "codex":
        chosen = "codex"
    elif engine == "antigravity":
        chosen = "antigravity"
    else:
        chosen = (
            "claude"
            if claude_ok
            else ("codex" if codex_ok else ("antigravity" if agy_ok else ""))
        )

    if not chosen:
        raise RuntimeError("사용 가능한 로컬 AI 엔진이 없습니다.")

    if chosen == "claude":
        async for delta, model_name in _stream_claude_cli(
            prompt, system_prompt=system_prompt
        ):
            yield delta, "claude", model_name
        return
    if chosen == "codex":
        async for delta, model_name in _stream_codex_cli(
            prompt, system_prompt=system_prompt
        ):
            yield delta, "codex", model_name
        return

    agy_m = get_effective_antigravity_model()
    yield "", "antigravity", agy_m
    async for delta in _agy_pool.stream_ask(prompt):
        yield delta, "antigravity", agy_m


_LATEX_BFNRT_CMD_RE = re.compile(
    r"(?<!\\)\\(?=(?:beta|bar|bf|big|binom|bm|bot|bullet|frac|forall|flat|nabla|neq|ne|notin|nu|norm|not|rightarrow|Rightarrow|rho|rm|rangle|times|text|textbf|textit|textrm|theta|Theta|tau|tilde|top|to|triangle|tfrac)\b)"
)
_INVALID_JSON_ESCAPE_RE = re.compile(
    r'(?<!\\)\\(?!(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))'
)


def _sanitize_latex_json_escapes(s: str) -> str:
    """Protect single-backslash LaTeX commands inside JSON strings so json.loads never corrupts \\times, \\frac, \\mathbb, etc."""
    s = _LATEX_BFNRT_CMD_RE.sub(r"\\\\", s)
    s = _INVALID_JSON_ESCAPE_RE.sub(r"\\\\", s)
    return s


def _try_parse_jsonl_line(line: str) -> Optional[dict[str, Any]]:
    s = line.strip()
    if not s or s.startswith("```"):
        return None
    if s.endswith(","):
        s = s[:-1].strip()
    if not (s.startswith("{") and s.endswith("}")):
        # Extract inner {...} if numbered list prefix was accidentally added
        b0 = s.find("{")
        b1 = s.rfind("}")
        if b0 == -1 or b1 <= b0:
            return None
        s = s[b0 : b1 + 1]
    s_fixed = _sanitize_latex_json_escapes(s)
    for cand in (s_fixed, s):
        try:
            obj = json.loads(cand)
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    return None


async def generate_paper_overview(
    doc: PaperDocument,
    raw_chunks: list[RawBodyChunk],
    engine: str = "auto",
) -> tuple[PaperOverview, Optional[str]]:
    """
    Step 0 before section-by-section translation: Generate a crisp high-level Paper Summary &
    Core Contributions card from the paper's Abstract, Introduction, Method, and Conclusion.
    """
    slices: list[str] = []
    if raw_chunks:
        front_txt = "\n\n".join(c.text for c in raw_chunks[:2])[:6500]
        slices.append(f"[논문 앞부분 — Title / Abstract / Introduction]:\n{front_txt}")
        if len(raw_chunks) >= 4:
            mid_c = raw_chunks[len(raw_chunks) // 2]
            slices.append(f"[논문 중간 — Method 핵심부]:\n{mid_c.text[:2200]}")
        if len(raw_chunks) >= 3:
            tail_txt = raw_chunks[-1].text[-2800:]
            slices.append(f"[논문 뒷부분 — Experiments / Conclusion]:\n{tail_txt}")
    else:
        fallback_txt = "\n".join(f"[p.{s.page} | {s.section}] {s.text}" for s in doc.sentences)[:9500]
        slices.append(fallback_txt)

    paper_excerpt = "\n\n".join(slices)

    prompt = f"""다음 학술 논문의 핵심 내용을 먼저 한눈에 파악할 수 있도록 **논문 요약 및 주요 Contribution**을 한국어로 정리해주세요.
어미는 본문 번역과 동일하게 간결하고 명확한 학술 평어체(`~한다`, `~이다`, `~제시한다`)로 작성하고, 불필요한 미사여구 없이 핵심만 정확히 짚어주세요. 수식 기호가 필요하면 `$...$` 인라인 LaTeX(백슬래시는 `\\\\` 두 번)로 표기할 수 있습니다.

[현재 파악된 제목]: {doc.title}

[논문 발췌 본문]:
{paper_excerpt}

반드시 아래 JSON 형식으로만 출력하세요(코드블록 외 다른 설명 금지):
{{
  "clean_title": "정제된 정확한 영어 논문 제목",
  "tldr": "이 논문이 무엇을 제안하고 왜 중요한지 1~2문장 핵심 요약",
  "problem": "기존 접근법의 한계와 이 논문이 풀고자 하는 핵심 문제 (1~2문장)",
  "method": "제안하는 핵심 방법론·구조 요약 (1~2문장)",
  "contributions": [
    "**핵심 키워드 1**: 첫 번째 주요 Contribution 설명 (1~2문장)",
    "**핵심 키워드 2**: 두 번째 주요 Contribution 설명 (1~2문장)",
    "**핵심 키워드 3**: 세 번째 주요 Contribution 설명 (1~2문장)"
  ],
  "results": "주요 데이터셋/실험에서 달성한 핵심 정량·정성 성과 (1문장)"
}}"""

    raw, used_engine = await run_local_llm(prompt, engine=engine)
    data = _extract_json_obj(raw)

    contribs = [
        str(c).strip()
        for c in (data.get("contributions") or [])
        if str(c).strip()
    ][:5]

    used_model, _ = resolve_display_model_for_engine(used_engine)
    clean_title = str(data.get("clean_title") or "").strip() or None

    overview = PaperOverview(
        tldr=str(data.get("tldr") or "").strip(),
        problem=str(data.get("problem") or "").strip(),
        method=str(data.get("method") or "").strip(),
        contributions=contribs,
        results=str(data.get("results") or "").strip(),
        engine=used_engine,
        model_name=used_model,
    )
    return overview, clean_title


async def stream_chunk_section_and_translate(
    paper_title: str,
    chunk: RawBodyChunk,
    total_chunks: int,
    prev_section: str,
    engine: str = "auto",
) -> AsyncIterator[tuple[dict[str, Any], str]]:
    """
    Stream AI-structured section classification + full sentence segmentation + natural researcher-style Korean translation
    as real-time JSONL records (`{"type": "meta", "title": ...}` or `{"section": ..., "page": ..., "en": ..., "ko": ...}`).
    """
    prev_hint = (
        f'직전 청크의 마지막 섹션명은 "{prev_section}" 이었습니다. 새 섹션 제목이 등장하기 전까지는 이 섹션명을 이어서 사용하세요.'
        if prev_section
        else "논문의 시작 부분입니다. 첫 줄에 정확한 논문 제목 메타 객체를 출력한 뒤 Abstract부터 본문 문장들을 순서대로 출력하세요."
    )

    title_line_rule = (
        '0. 첫 번째 줄에는 논문 제목을 정제하여 `{"type":"meta","title":"정확한 영어 논문 제목"}` 한 줄을 먼저 출력하세요.\n'
        if chunk.chunk_index == 0
        else ""
    )

    prompt = f"""다음은 영어 학술 논문의 본문 텍스트 일부(청크 {chunk.chunk_index + 1}/{total_chunks})입니다.
이 텍스트에서 섹션(Abstract, 1. Introduction, 2. Related Work, 3. Method 등)을 정확히 구분하고,
본문의 영어 문장을 **끊지 않고 온전한 한 문장(Full sentence) 단위**로 분리하여 자연스러운 학술 한국어 번역(`ko`)과 함께 **한 줄에 JSON 객체 하나씩(JSONL)** 실시간 출력하세요.

[현재 파악된 논문 제목]: {paper_title}
[연속성 힌트]: {prev_hint}

[처리할 원문 텍스트]:
{chunk.text}

[엄격한 출력 및 번역 스타일 규칙]:
{title_line_rule}1. 마크다운 코드블록(```)이나 인사말, 부연 설명을 절대 출력하지 마세요. 오직 한 줄에 하나의 유효한 JSON 객체만 출력합니다.
2. 저자 이름/소속/이메일/페이지 머리말/쪽번호/단순 표 숫자 나열이나 깨진 수식 조각은 제외하고, 실제 읽어야 할 논문 문장들(본문 및 설명형 캡션)만 빠짐없이 순서대로 포함하세요.
3. 새로운 섹션이나 서브섹션(예: "Abstract", "1. Introduction", "2. Related Work", "3.1 Architecture", "4. Experiments", "5. Conclusion")이 시작되면 `section` 값을 해당 섹션명으로 업데이트하세요.
4. `en`: 문장을 중간에 쪼개지 말고 **온전한 영어 원문 한 문장 전체(Full sentence)**를 넣으세요. 줄바꿈 하이픈만 자연스럽게 복원하고, 인용 표기(`[1]`, `[12, 15]`, `(Vaswani et al., 2017)` 등)는 **절대 생략하지 말고 수식(`$...$`) 바깥에 원문 그대로 유지**하세요.
5. `ko` (매우 중요 — 번역 품질 기준):
   - 어미는 `~합니다`가 아니라 **간결하고 명확한 평어체 학술 문장(`~한다`, `~이다`, `~남는다`, `~도움이 될 수 있다`, `~다룬다`)**으로 작성하세요.
   - 어색한 직역투를 피하고 한국 연구자가 논문을 읽을 때 가장 자연스럽게 이해되는 표현을 쓰세요. (`follow-up`, `target 시점`, `baseline`, 약어 `MRI`, `AD`, `AIBL(...) 연구` 등 원어 병기나 현업 용어가 더 자연스러운 단어는 억지로 번역하지 말고 자연스럽게 살리세요.)
   - 영어 원문이 `, but ...`, `, whereas ...` 등으로 긴 복합문일 경우, `ko` 안에서는 자연스럽게 두 문장(`~기록한다. 하지만 ~남는다.`)으로 나누어 가독성을 높이세요. 인용 번호(`[1]` 등)도 `ko` 문장 안에 그대로 유지하세요.
6. **수식 및 기호 LaTeX 표기 규칙 (매우 중요)**:
   - 원문에 수학 변수·수식·그리스 문자·위/아래 첨자(PDF 추출 과정에서 `X ∈ RC×H×W`, `bg ∈ {0, 1}L`, `pt+1 ≤ p⋆`, `L = λ cos`처럼 평평하게 풀린 표현 포함)가 등장하면, `en`과 `ko` 모두 **표준 인라인 LaTeX(`$...$`)** 또는 독립 수식(`$$...$$`)으로 깔끔하게 복원해 표기하세요 (예: `$X \\in \\mathbb{{R}}^{{C \\times H \\times W}}$`, `$b_g \\in \\{{0, 1\\}}^L$`, `$p_{{t+1}} \\le p^{{\\star}}$`, `$\\mathcal{{L}}_{{\\text{{total}}}}$`).
   - JSON 문자열 내부이므로 LaTeX 백슬래시는 반드시 두 번(`\\`, 예: `\\mathbb`, `\\times`, `\\frac`, `\\le`, `\\alpha`) 이스케이프하세요. 일반 숫자·가격이나 논문 인용 번호(`[1]`)에는 `$`를 쓰지 마세요.
7. `page`: 텍스트의 `[Page N]` 표기를 참고하여 해당 문장의 페이지 번호(정수)를 넣으세요.
8. **Figure 및 Table 인식 규칙 (`[[MEDIA id="..." kind="figure|table" label="..." page=N]]`)**:
   - 원문에 `[[MEDIA id="p3_fig_1_1" kind="figure" label="Fig. 1" page=3]] 캡션...` 또는 `kind="table"` 마커가 등장하면 **절대 건너뛰지 말고** 그 위치 그대로 아래 형식의 JSON 한 줄로 출력하세요:
     `{{"kind":"figure","media_id":"p3_fig_1_1","label":"Fig. 1","section":"현재 섹션명","page":3,"en":"원래 영어 캡션 전체(참고용 괄호 메모 제외)","ko":"캡션 전체에 대한 자연스러운 학술 한국어 번역(Table의 경우 표가 보여주는 핵심 비교/수치 요약을 한 문장 덧붙여도 좋음)"}}`

[원하는 번역 수준 예시 (JSONL)]:
{{"section":"Abstract","page":1,"en":"Longitudinal magnetic resonance imaging (MRI) records structural changes associated with aging and Alzheimer’s disease (AD), but repeated scanning is expensive and irregular follow-up leaves individual trajectories incomplete.","ko":"종단 MRI는 노화와 알츠하이머병(AD)에 따른 구조적 변화를 기록한다. 하지만 반복 촬영은 비용이 많이 들고, follow-up이 불규칙해서 개인의 궤적이 불완전하게 남는다."}}
{{"section":"3. Method","page":2,"en":"Given an image $X \\in \\mathbb{{R}}^{{C \\times H \\times W}}$, the encoder produces a global code $b_g \\in \\{{0, 1\\}}^L$ [1].","ko":"입력 영상 $X \\in \\mathbb{{R}}^{{C \\times H \\times W}}$가 주어지면, 인코더는 전역 코드 $b_g \\in \\{{0, 1\\}}^L$을 생성한다 [1]."}}
{{"section":"Abstract","page":1,"en":"Forecasting a future T1-weighted MRI from visits observed before the target time could help characterize possible anatomical trajectories.","ko":"target 시점 이전에 관측된 방문 데이터로 미래 T1 강조 MRI를 예측하면, 가능한 해부학적 궤적을 특성화하는 데 도움이 될 수 있다."}}"""

    buffer = ""
    used_engine = engine
    reported_model = False

    async for delta, resolved_eng, model_name in stream_local_llm_text(prompt, engine=engine):
        used_engine = resolved_eng
        if model_name and not reported_model:
            reported_model = True
            yield {"type": "model_info", "model": model_name, "engine": used_engine}, used_engine
        if not delta:
            continue
        buffer += delta
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            parsed = _try_parse_jsonl_line(line)
            if parsed is not None:
                yield parsed, used_engine

    if buffer.strip():
        parsed = _try_parse_jsonl_line(buffer)
        if parsed is not None:
            yield parsed, used_engine


_QUOTA_LINE_RE = re.compile(
    r"^(?P<label>[^:\n]+):\s*(?P<used>\d+(?:\.\d+)?)%\s*used(?:\s*[·•\-]\s*resets\s*(?P<resets>.+))?$",
    re.IGNORECASE,
)


def _translate_quota_label(raw_label: str) -> tuple[str, str]:
    clean = raw_label.strip()
    low = clean.lower()
    if low == "current session":
        return "session", "현재 세션 (5시간 한도)"
    if low == "current week (all models)":
        return "week_all", "이번 주 전체 모델"
    m = re.match(r"^current week\s*\((.+)\)$", clean, re.IGNORECASE)
    if m:
        sub = m.group(1).strip()
        return f"week_{sub.lower()}", f"이번 주 ({sub})"
    return re.sub(r"\W+", "_", low).strip("_") or "quota", clean


def _format_reset_label(raw_reset: Optional[str]) -> Optional[str]:
    if not raw_reset:
        return None
    s = raw_reset.strip()
    s = s.replace("(Asia/Seoul)", "(KST)")
    return s


async def fetch_usage_status(refresh: bool = False) -> UsageStatusResponse:
    """Query local Claude Code subscription remaining quota via official zero-token `/usage` & `auth status` CLI commands."""
    global _CACHED_USAGE_STATUS, _CACHED_USAGE_TS

    now_ts = time.monotonic()
    if not refresh and _CACHED_USAGE_STATUS is not None and (now_ts - _CACHED_USAGE_TS) < 45.0:
        cached = _CACHED_USAGE_STATUS.model_copy(deep=True)
        cached.local_session_requests = _SESSION_REQUEST_COUNT
        cached.local_session_tokens = _SESSION_TOTAL_TOKENS
        return cached

    async with _USAGE_LOCK:
        now_ts = time.monotonic()
        if not refresh and _CACHED_USAGE_STATUS is not None and (now_ts - _CACHED_USAGE_TS) < 45.0:
            cached = _CACHED_USAGE_STATUS.model_copy(deep=True)
            cached.local_session_requests = _SESSION_REQUEST_COUNT
            cached.local_session_tokens = _SESSION_TOTAL_TOKENS
            return cached

        checked_at = dt.datetime.now().strftime("%H:%M:%S")
        claude_bin = find_claude_binary()
        if not claude_bin:
            res = UsageStatusResponse(
                available=False,
                provider="claude",
                checked_at=checked_at,
                local_session_requests=_SESSION_REQUEST_COUNT,
                local_session_tokens=_SESSION_TOTAL_TOKENS,
                error="로컬에서 Claude CLI를 찾을 수 없습니다.",
            )
            _CACHED_USAGE_STATUS = res
            _CACHED_USAGE_TS = time.monotonic()
            return res

        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        env.pop("CLAUDE_CODE_ENTRYPOINT", None)
        env.pop("ANTHROPIC_API_KEY", None)
        env["PYTHONIOENCODING"] = "utf-8"

        subscription_type: Optional[str] = None
        email: Optional[str] = None
        auth_method: Optional[str] = None

        # 1. Check `claude auth status`
        try:
            auth_proc = await asyncio.create_subprocess_exec(
                claude_bin,
                "auth",
                "status",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            a_out, _ = await asyncio.wait_for(auth_proc.communicate(), timeout=8.0)
            a_txt = a_out.decode("utf-8", errors="replace").strip()
            if a_txt.startswith("{"):
                a_json = json.loads(a_txt)
                subscription_type = str(a_json.get("subscriptionType") or "").strip() or None
                email = str(a_json.get("email") or "").strip() or None
                auth_method = str(a_json.get("authMethod") or "").strip() or None
        except Exception:
            pass

        # 2. Query zero-token `/usage` command
        quotas: list[UsageQuotaItem] = []
        activity_lines: list[str] = []
        err_msg: Optional[str] = None

        try:
            u_proc = await asyncio.create_subprocess_exec(
                claude_bin,
                "-p",
                "--output-format",
                "json",
                "--strict-mcp-config",
                "--no-session-persistence",
                "--tools",
                "",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            u_out, u_err = await asyncio.wait_for(
                u_proc.communicate(input=b"/usage"),
                timeout=15.0,
            )
            u_txt = u_out.decode("utf-8", errors="replace").strip()
            result_body = ""
            if u_txt.startswith("{"):
                u_json = json.loads(u_txt)
                result_body = str(u_json.get("result") or "").strip()
            else:
                result_body = u_txt

            for raw_ln in result_body.splitlines():
                ln = raw_ln.strip()
                if not ln:
                    continue
                qm = _QUOTA_LINE_RE.match(ln)
                if qm:
                    q_key, q_label = _translate_quota_label(qm.group("label"))
                    used = round(float(qm.group("used")), 1)
                    rem = round(max(0.0, 100.0 - used), 1)
                    quotas.append(
                        UsageQuotaItem(
                            key=q_key,
                            label=q_label,
                            used_percent=used,
                            remaining_percent=rem,
                            resets_at=_format_reset_label(qm.group("resets")),
                        )
                    )
                elif ln.startswith("Last 24h") or ln.startswith("Last 7d"):
                    ko_act = (
                        ln.replace("Last 24h", "최근 24시간")
                        .replace("Last 7d", "최근 7일")
                        .replace("requests", "회 요청")
                        .replace("request", "회 요청")
                        .replace("sessions", "개 세션")
                        .replace("session", "개 세션")
                    )
                    activity_lines.append(ko_act)

            if not quotas and u_proc.returncode != 0:
                err_msg = u_err.decode("utf-8", errors="replace").strip()[:240] or "사용량 정보를 불러오지 못했습니다."
        except asyncio.TimeoutError:
            err_msg = "사용량 조회 시간이 초과되었습니다."
        except Exception as exc:
            err_msg = f"사용량 조회 오류: {exc}"

        res = UsageStatusResponse(
            available=bool(quotas),
            provider="claude",
            subscription_type=subscription_type,
            email=email,
            auth_method=auth_method,
            billing_mode="subscription_oauth",
            quotas=quotas,
            activity_lines=activity_lines,
            local_session_requests=_SESSION_REQUEST_COUNT,
            local_session_tokens=_SESSION_TOTAL_TOKENS,
            checked_at=checked_at,
            error=err_msg if not quotas else None,
        )
        _CACHED_USAGE_STATUS = res
        _CACHED_USAGE_TS = time.monotonic()
        return res


async def stream_paper_chat_reply(
    doc: PaperDocument,
    raw_chunks: list[RawBodyChunk],
    history: list[ChatMessage],
    user_message: str,
    context_snippet: Optional[str] = None,
    engine: str = "auto",
    response_style: str = "concise",
) -> AsyncIterator[tuple[str, str, Optional[str]]]:
    """Stream a grounded Markdown Q&A reply based on the full paper text, figures/tables, and chat history."""
    if raw_chunks:
        full_paper_text = "\n\n".join(c.text for c in raw_chunks)[:65000]
    else:
        full_paper_text = "\n".join(
            f"[p.{s.page} | {s.section}] {s.text}" for s in doc.sentences
        )[:65000]

    refs_preview = "\n".join(
        f"[{rk}] {r.raw_text[:220]}"
        for rk, r in list(doc.references.items())[:40]
    )

    history_lines: list[str] = []
    for m in history[-8:]:
        speaker = "사용자" if m.role == "user" else "AI"
        history_lines.append(f"{speaker}: {m.content[:1000]}")
    history_block = "\n\n".join(history_lines) if history_lines else "(첫 질문)"

    ctx_block = (
        f"\n[사용자가 현재 포커스/선택한 문장 또는 그림·표]:\n{context_snippet}\n"
        if context_snippet
        else ""
    )

    wants_detail = (
        response_style == "detailed"
        or any(kw in user_message for kw in ("자세히", "상세히", "길게", "자세한 설명", "전부 설명"))
    )

    if wants_detail:
        style_instruction = (
            "논문 내용을 근거로 한국어 마크다운(Markdown)으로 체계적이고 이해하기 쉽게 답변하세요. "
            "관련 페이지 `[p.N]`이나 인용 번호 `[1]`가 있으면 함께 표기하세요."
        )
        sys_prompt = CHAT_SYSTEM_PROMPT_DETAILED
    else:
        style_instruction = (
            "답변이 길어지지 않도록 **핵심만 짧고 간결하게** 한국어로 답변하세요:\n"
            "1) 인사말·서론·배경 설명 없이 **첫 1~2문장에 핵심 결론**부터 바로 제시하세요.\n"
            "2) 추가 설명이 꼭 필요할 때만 **짧은 불릿 2~3개(각 1문장 이내)** 로 요약해 **전체 4~6줄 이내**로 끝내세요.\n"
            "3) 큰 제목(`#`, `##`)이나 장황한 문단을 쓰지 말고, 근거 페이지(`[p.N]`)나 인용(`[1]`)만 짧게 덧붙이세요."
        )
        sys_prompt = CHAT_SYSTEM_PROMPT

    prompt = f"""다음은 사용자가 현재 읽고 있는 학술 논문의 본문(Figure/Table 캡션 포함) 및 참고문헌입니다.
(주의: JSON이 아니라 일반 마크다운 텍스트로 바로 답변하세요.)

[답변 작성 원칙]:
{style_instruction}

[논문 제목]: {doc.title}

[논문 본문 전체]:
{full_paper_text}

[주요 참고문헌(References)]:
{refs_preview or '(참고문헌 없음)'}

[이전 대화 내역]:
{history_block}
{ctx_block}
[사용자 질문]:
{user_message}"""

    async for delta, resolved_eng, model_name in stream_local_llm_text(
        prompt, engine=engine, system_prompt=sys_prompt
    ):
        yield delta, resolved_eng, model_name
