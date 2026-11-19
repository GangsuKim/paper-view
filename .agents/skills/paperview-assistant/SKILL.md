---
name: paperview-assistant
description: Assist with PaperView academic paper reading, sense-group sentence breakdown, and cited paper summarization directly inside Antigravity IDE without requiring external API keys.
---

# PaperView Assistant Skill (Antigravity IDE Native Integration)

When the user asks Antigravity in chat to open, analyze, translate, or summarize citations for a paper in **PaperView**:

1. **Paper Storage Location**:
   - All parsed papers live in `.paperview_data/papers/<paper_id>/`:
     - `document.json`: Parsed `PaperDocument` (`title`, `sections`, `sentences`, `references`).
     - `sentence_analyses.json`: Cached `SentenceAnalysis` dictionary keyed by `sentence_id` (`s_0000`, etc.).
     - `citation_summaries.json`: Cached `CitationSummaryResponse` dictionary keyed by `ref_key` (`"1"`, `"12"`, etc.).

2. **Direct Antigravity Generation (Zero API Key)**:
   - You can read `document.json` and directly write/update `sentence_analyses.json` or `citation_summaries.json` using `"engine": "antigravity"`!
   - Schema for `sentence_analyses.json` entry:
     ```json
     {
       "sentence_id": "s_0000",
       "engine": "antigravity",
       "chunks": [
         {"en": "In contrast to recurrent networks,", "ko": "순환 신경망과 대조적으로,", "role": "대조 부사구"}
       ],
       "natural_ko": "순환 신경망과 달리, ...",
       "key_terms": [{"term": "recurrent networks", "meaning": "순환 신경망(RNN)"}]
     }
     ```
   - Schema for `citation_summaries.json` entry:
     ```json
     {
       "ref_key": "1",
       "engine": "antigravity",
       "source_type": "fulltext_pdf",
       "source_label": "Antigravity 에이전트 요약",
       "tldr": "한 문장 핵심 요약",
       "summary_points": ["배경: ...", "방법: ...", "결과: ..."],
       "why_cited": "현재 논문에서 인용한 맥락"
     }
     ```
   - Once saved, refreshing or clicking the item in PaperView (`http://127.0.0.1:8787`) immediately displays the result!
