from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class LanguageProfile:
    code: str
    native_name: str
    english_name: str
    overview_section_label: str
    sentence_style_guide: str
    overview_style_guide: str
    media_insight_style_guide: str
    citation_point_labels: tuple[str, str, str]
    source_arxiv_pdf_label: str
    source_open_pdf_label: str
    source_abstract_label: str
    source_context_label: str


LANGUAGE_PROFILES: dict[str, LanguageProfile] = {
    "ko": LanguageProfile(
        code="ko",
        native_name="한국어",
        english_name="Korean",
        overview_section_label="논문 핵심 요약 & Contribution",
        sentence_style_guide=(
            "- 어미는 `~합니다`가 아니라 **간결하고 명확한 평어체 학술 문장(`~한다`, `~이다`, `~남는다`, `~도움이 될 수 있다`, `~다룬다`)**으로 작성하세요.\n"
            "   - 어색한 직역투를 피하고 한국 연구자가 논문을 읽을 때 가장 자연스럽게 이해되는 표현을 쓰세요. "
            "(`follow-up`, `target 시점`, `baseline`, `ablation`, 약어 `MRI`, `AD` 등 원어 병기나 현업 용어가 더 자연스러운 단어는 억지로 번역하지 말고 자연스럽게 살리세요.)\n"
            "   - 영어 원문이 `, but ...`, `, whereas ...` 등으로 긴 복합문일 경우 자연스럽게 두 문장으로 나누어 가독성을 높이세요."
        ),
        overview_style_guide=(
            "어미는 본문 번역과 동일하게 간결하고 명확한 학술 평어체(`~한다`, `~이다`, `~제시한다`)로 한국어로 작성하세요."
        ),
        media_insight_style_guide=(
            "독자에게 친절하게 핵심을 짚어주는 설명체(예: '저자들은 이 그림(표)을 통해 ~라는 점을 주장하고(보여주고) 있어요. 특히 ~를 비교해 보면 ~임을 확인할 수 있어요.')로 1~2문장 이내로 작성하세요."
        ),
        citation_point_labels=("문제의식/배경", "핵심 방법/아이디어", "주요 결과 및 의의"),
        source_arxiv_pdf_label="arXiv 원문 PDF ({id}) 기반",
        source_open_pdf_label="오픈액세스 원문 PDF 기반",
        source_abstract_label="초록(Abstract) 기반",
        source_context_label="본문 인용 문맥 및 서지 정보 기반",
    ),
    "en": LanguageProfile(
        code="en",
        native_name="English",
        english_name="English",
        overview_section_label="Key Summary & Contributions",
        sentence_style_guide=(
            "- Write a **crisp, plain-English academic clarification / takeaway** of the sentence so a researcher can grasp dense prose at a glance.\n"
            "   - Keep all technical terminology accurate, preserve inline citation markers (`[1]`, etc.) and `$...$` LaTeX math, and make complex multi-clause sentences clear and direct."
        ),
        overview_style_guide=(
            "Write in crisp, direct scholarly English without filler phrases."
        ),
        media_insight_style_guide=(
            "In 1–2 clear, approachable sentences, explain what the authors are arguing or demonstrating through this figure/table (e.g., 'Through this figure, the authors want to show that... Comparing X against Y highlights...')."
        ),
        citation_point_labels=("Motivation & Background", "Core Method & Idea", "Key Results & Impact"),
        source_arxiv_pdf_label="Based on arXiv PDF ({id})",
        source_open_pdf_label="Based on Open-Access PDF",
        source_abstract_label="Based on Abstract",
        source_context_label="Based on Citing Context & Metadata",
    ),
    "ja": LanguageProfile(
        code="ja",
        native_name="日本語",
        english_name="Japanese",
        overview_section_label="論文の要点 & Contribution",
        sentence_style_guide=(
            "- 語尾は「〜です・ます」ではなく、**簡潔で明快な学術常体（「〜する」「〜である」「〜を示す」「〜となる」）**で自然な日本語に翻訳してください。\n"
            "   - 不自然な直訳調を避け、日本の研究者が論文を読む際に最も理解しやすい表現を用いてください（`baseline`、`ablation`、`follow-up`、`self-attention` など研究現場でそのまま使われる専門用語は無理に訳さず自然に残してください）。\n"
            "   - 英語原文が長い複文の場合は、読みやすさのために自然な2文に分けても構いません。"
        ),
        overview_style_guide=(
            "語尾は本文翻訳と同様に簡潔で明快な学術常体（「〜する」「〜である」「〜を提案する」）で日本語で記述してください。"
        ),
        media_insight_style_guide=(
            "読者にわかりやすく核心を伝える解説調（例：「著者らはこの図（表）を通じて〜という点を主張しています。特に〜を比較すると〜であることがわかります。」）で1〜2文で簡潔に記述してください。"
        ),
        citation_point_labels=("背景・課題", "核心手法・アイデア", "主な結果と意義"),
        source_arxiv_pdf_label="arXiv 原文PDF ({id}) に基づく",
        source_open_pdf_label="オープンアクセスPDFに基づく",
        source_abstract_label="アブストラクトに基づく",
        source_context_label="引用文脈・書誌情報に基づく",
    ),
    "zh-CN": LanguageProfile(
        code="zh-CN",
        native_name="简体中文",
        english_name="Simplified Chinese",
        overview_section_label="论文核心总结 & Contribution",
        sentence_style_guide=(
            "- 使用**简洁、严谨、自然的现代中文学术书面语**进行翻译，避免生硬的机器直译腔。\n"
            "   - 保留科研人员习惯直接使用的英文专业术语或缩写（如 `baseline`、`ablation`、`self-attention`、`follow-up` 等），确保逻辑清晰流畅。"
        ),
        overview_style_guide=(
            "请使用简洁、严谨、自然的简体中文学术书面语撰写。"
        ),
        media_insight_style_guide=(
            "用1～2句清晰易懂的导读语气（例如：“作者通过这张图（表）旨在表明……尤其是对比……可以清楚看到……”）点明作者的核心主张与观察重点。"
        ),
        citation_point_labels=("研究背景与动机", "核心方法与思路", "主要结果与意义"),
        source_arxiv_pdf_label="基于 arXiv 原文 PDF ({id})",
        source_open_pdf_label="基于开放获取原文 PDF",
        source_abstract_label="基于论文摘要 (Abstract)",
        source_context_label="基于正文引用语境与题录信息",
    ),
    "zh-TW": LanguageProfile(
        code="zh-TW",
        native_name="繁體中文",
        english_name="Traditional Chinese",
        overview_section_label="論文核心摘要 & Contribution",
        sentence_style_guide=(
            "- 使用**精煉、嚴謹、自然的繁體中文學術書面語**進行翻譯，避免生硬直譯。\n"
            "   - 保留研究領域慣用的英文專業術語或縮寫（如 `baseline`、`ablation`、`self-attention`、`follow-up` 等），並符合繁體中文學術詞彙習慣。"
        ),
        overview_style_guide=(
            "請使用精煉、嚴謹、自然的繁體中文學術書面語撰寫。"
        ),
        media_insight_style_guide=(
            "用1～2句清晰易懂的導讀語氣（例如：「作者透過這張圖（表）想要表明……特別是對比……可以清楚看出……」）點明作者的核心主張與觀察重點。"
        ),
        citation_point_labels=("研究背景與動機", "核心方法與構想", "主要結果與貢獻"),
        source_arxiv_pdf_label="基於 arXiv 原文 PDF ({id})",
        source_open_pdf_label="基於開放取用原文 PDF",
        source_abstract_label="基於論文摘要 (Abstract)",
        source_context_label="基於內文引用脈絡與書目資訊",
    ),
    "es": LanguageProfile(
        code="es",
        native_name="Español",
        english_name="Spanish",
        overview_section_label="Resumen Clave y Contribuciones",
        sentence_style_guide=(
            "- Traduzca en un **español académico claro, conciso y natural**, evitando traducciones literales forzadas.\n"
            "   - Conserve los términos técnicos en inglés habituales entre investigadores (`baseline`, `ablation`, `self-attention`, etc.) cuando resulte más natural."
        ),
        overview_style_guide=(
            "Redacte en español académico claro, directo y preciso."
        ),
        media_insight_style_guide=(
            "En 1–2 frases claras (p. ej., 'Con esta figura, los autores quieren demostrar que...'), explique la idea principal que los autores buscan transmitir y qué observar."
        ),
        citation_point_labels=("Motivación y contexto", "Método e idea clave", "Resultados e impacto"),
        source_arxiv_pdf_label="Basado en PDF de arXiv ({id})",
        source_open_pdf_label="Basado en PDF de acceso abierto",
        source_abstract_label="Basado en el resumen (Abstract)",
        source_context_label="Basado en el contexto de cita",
    ),
    "de": LanguageProfile(
        code="de",
        native_name="Deutsch",
        english_name="German",
        overview_section_label="Kernaussagen & Contributions",
        sentence_style_guide=(
            "- Übersetzen Sie in ein **klares, präzises und natürliches wissenschaftliches Deutsch**.\n"
            "   - Behalten Sie etablierte englische Fachbegriffe (`Baseline`, `Ablation`, `Self-Attention` usw.) bei, sofern sie in der Fachliteratur üblich sind."
        ),
        overview_style_guide=(
            "Formulieren Sie in klarem, präzisem wissenschaftlichem Deutsch."
        ),
        media_insight_style_guide=(
            "Erklären Sie in 1–2 klaren Sätzen (z. B. 'Mit dieser Abbildung möchten die Autoren zeigen, dass ...'), welche Kernaussage die Autoren vermitteln wollen."
        ),
        citation_point_labels=("Motivation & Hintergrund", "Kernmethode & Idee", "Wichtigste Ergebnisse"),
        source_arxiv_pdf_label="Basierend auf arXiv-PDF ({id})",
        source_open_pdf_label="Basierend auf Open-Access-PDF",
        source_abstract_label="Basierend auf dem Abstract",
        source_context_label="Basierend auf Zitierkontext",
    ),
    "fr": LanguageProfile(
        code="fr",
        native_name="Français",
        english_name="French",
        overview_section_label=" Synthèse Clé & Contributions".strip(),
        sentence_style_guide=(
            "- Traduisez dans un **français scientifique clair, concis et naturel**, en évitant le mot-à-mot artificiel.\n"
            "   - Conservez les termes techniques anglais d'usage courant chez les chercheurs (`baseline`, `ablation`, `self-attention`, etc.)."
        ),
        overview_style_guide=(
            "Rédigez dans un français scientifique clair, direct et précis."
        ),
        media_insight_style_guide=(
            "En 1 à 2 phrases claires (par ex. « À travers cette figure, les auteurs veulent montrer que... »), expliquez l'argument clé des auteurs et ce qu'il faut observer."
        ),
        citation_point_labels=("Contexte et motivation", "Méthode et idée clé", "Principaux résultats"),
        source_arxiv_pdf_label="Basé sur le PDF arXiv ({id})",
        source_open_pdf_label="Basé sur le PDF en libre accès",
        source_abstract_label="Basé sur le résumé (Abstract)",
        source_context_label="Basé sur le contexte de citation",
    ),
}

DEFAULT_LANG = "ko"


def normalize_lang_code(lang: Optional[str]) -> str:
    if not lang:
        return DEFAULT_LANG
    cleaned = lang.strip()
    if cleaned in LANGUAGE_PROFILES:
        return cleaned
    low = cleaned.lower()
    alias_map = {
        "ko": "ko",
        "ko-kr": "ko",
        "korean": "ko",
        "en": "en",
        "en-us": "en",
        "en-gb": "en",
        "english": "en",
        "ja": "ja",
        "ja-jp": "ja",
        "jp": "ja",
        "japanese": "ja",
        "zh": "zh-CN",
        "zh-cn": "zh-CN",
        "zh-hans": "zh-CN",
        "zh-sg": "zh-CN",
        "zh-tw": "zh-TW",
        "zh-hk": "zh-TW",
        "zh-hant": "zh-TW",
        "es": "es",
        "es-es": "es",
        "spanish": "es",
        "de": "de",
        "de-de": "de",
        "german": "de",
        "fr": "fr",
        "fr-fr": "fr",
        "french": "fr",
    }
    return alias_map.get(low, DEFAULT_LANG)


def get_lang_profile(lang: Optional[str]) -> LanguageProfile:
    return LANGUAGE_PROFILES[normalize_lang_code(lang)]


def list_supported_languages() -> list[dict[str, str]]:
    return [
        {
            "code": p.code,
            "native_name": p.native_name,
            "english_name": p.english_name,
        }
        for p in LANGUAGE_PROFILES.values()
    ]
