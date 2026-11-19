<div align="center">

<img src="docs/assets/promo-hero-workspace.jpg" alt="PaperView Promotional Showcase — Overview-First & Bidirectional PDF Sync" width="100%" />

<br />

# 📖 PaperView

**An AI Academic Paper Reader Powered Directly by Your Existing Subscriptions**

[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/React_18-TypeScript-61DAFB?style=flat-square&logo=react&logoColor=0f172a)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-SSE_Streaming-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![AI Engines](https://img.shields.io/badge/Local_CLI-Claude_%7C_Codex_%7C_Antigravity-d97706?style=flat-square)](#)
[![VS Code](https://img.shields.io/badge/VS_Code-Extension_Ready-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](#)

[**한국어**](README.md) · [**English**](README.en.md) · [Citation Quick Summary](#-one-click-citation-quick-summary) · [Key Features](#-key-features) · [Quick Start](#-30-second-quick-start) · [Acknowledgments](#-acknowledgments)

</div>

---

## 💡 What is PaperView?

**PaperView** is an open-source academic paper reader (Web App + VS Code Extension) that runs directly on your local **Claude Code CLI (`claude`)** and **OpenAI Codex CLI (`codex`)** subscription sessions without requiring separate pay-as-you-go API credits. Because the backend blocks `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` environment variables at the source, **you never incur accidental extra API charges, and all papers and translation caches remain 100% on your local disk (`.paperview_data/`)**.

More than a simple PDF translator, PaperView is designed around how researchers actually read papers:
1. The moment you open a paper, it presents a **one-line TL;DR, Key Contributions 1–4, Problem Definition, Proposed Method, and Key Results** right at the top of the reader, and
2. Clicking any inline citation badge (`[13]`) lets you inspect the cited paper's **arXiv full-text PDF, Main Figure, and Quick Summary (`✨ 간단 요약 보기`)** in one click without ever leaving the paper.

---

## 🔎 One-Click Citation `Quick Summary`

<div align="center">
  <img src="docs/assets/promo-citation-summary.jpg" alt="PaperView One-Click Citation Quick Summary Showcase" width="100%" />
</div>

<br />

Whenever you encounter an unfamiliar prior work (`[13]`), there is no need to open new tabs, hunt down the PDF, and read it from scratch:

1. **STEP 1 — Click Inline Citation Badge (`[13]`) & Auto-Match `arXiv`**: Even when a reference is listed only under a conference or journal venue, PaperView **searches the official arXiv index by paper title first** to link an accessible full-text PDF (`arXiv:2105.06756`) alongside direct navigation links.
2. **STEP 2 — Non-Blocking Background Summarization**: After clicking **`✨ 간단 요약 보기` (Quick Summary)**, press **Close & Keep Reading (`창 닫고 본문 계속 읽기`)** to stay focused on the main text. Once background summarization finishes, a completion toast appears immediately at the top right.
3. **STEP 3 — Auto-Extracted `Main Figure` + Core Summary**: Using your currently selected subscription model (e.g. `claude-opus-5[1m] · high`), PaperView analyzes the cited paper's full-text PDF to organize its **representative Main Figure (with click-to-zoom), one-line TL;DR, and Key Points (Motivation & Core Idea)** at a glance.

---

## ✨ Key Features

### ✦ 1. Pre-Translation `Key Summary & Contributions`
- Before diving into a long manuscript, PaperView synthesizes the abstract, introduction, method, experiments, and conclusion into a top **One-Line Summary (TL;DR) + Key Contributions + Problem / Method / Results** card first.
- As soon as the overview card finishes, full-text translation (`Abstract` → `1. Introduction` → ...) streams in real time directly underneath, and you can pause and click **Resume Translation (`이어서 번역`)** anytime.

### 📖 2. Natural Academic Translation
- **Accurate Reading Order**: Automatically strips review watermarks (`FOR REVIEW ONLY`), headers, and page-number noise while detecting single-column, two-column, and hybrid layouts per page so reading order never scrambles.
- **Natural Scholarly Phrasing**: Preserves intact original English sentences above `→` translations while retaining natural domain terminology (`baseline`, `follow-up`, `ablation`, etc.) familiar to researchers.
- **Bidirectional PDF Sync & Figure/Table Extraction**: Clicking any sentence highlights the exact corresponding line (`BBox`) in orange on the original PDF on the left, while Figures and Tables are automatically cropped at high resolution (`180–200 DPI`) inline with the text.

### 🌙 3. Scheduled Overnight Translation Queue
- Queue up multiple PDF papers (or arXiv IDs) you plan to read tomorrow and set a **scheduled start time (e.g. `02:00`)** before going to sleep.
- Even if your 5-hour subscription window fills up overnight, PaperView **saves a checkpoint at the last completed chunk and automatically resumes once your quota resets**, finishing every paper by morning.

### 💬 4. Paper-Grounded Chat & Live Quota Check
- **AI Chat (`논문 질문하기`)**: Answers clearly in 4–6 concise lines grounded in the full text, captions, and references (with a `Concise | Detailed` toggle) inside a freely drag-resizable chat drawer.
- **Zero-Token Usage Gauge**: Switch your active model and reasoning effort (`low`–`max`) from the top bar and check your **remaining 5-hour session and weekly subscription quota (`%`)** in real time without spending a single token.

---

## 🚀 30-Second Quick Start

### Prerequisites (One-Time)
- **Python 3.10+** and **Node.js 18+** installed
- Sign in to your preferred AI subscription CLI (one or both):
  ```bash
  # For Claude Pro / Max subscribers
  claude auth login

  # For ChatGPT Plus / Pro subscribers (after npm i -g @openai/codex)
  codex login
  ```

### Install & Run (One-Click `git clone`)
No need to manually create virtual environments or install packages. On first run, the launcher script automatically handles **virtual environment creation → package installation → frontend build → local server startup (`127.0.0.1:8787`) → browser launch**. *(From the second run onward, it launches in 1 second.)*

**Windows**
```powershell
git clone https://github.com/GangsuKim/paper-view.git
cd paper-view
.\start.bat          # Custom port: .\start.bat --port 9000
```

**macOS / Linux / WSL**
```bash
git clone https://github.com/GangsuKim/paper-view.git
cd paper-view
chmod +x start.sh
./start.sh           # Custom port: ./start.sh --port 9000
```

### Using Inside VS Code / Antigravity IDE
Open the project folder in VS Code and press **`F5`** (or launch the extension), then right-click any `.pdf` paper in the Explorer → select **`Open Paper with PaperView` (`PaperView로 논문 열기`)** to read directly inside an editor tab.

---

## 🙏 Acknowledgments

This project was built with **Google Antigravity**, provided through Google's researcher support program ([Antigravity for Science](https://antigravity.google/use-cases/science/)).

---

## 🤝 Contributing & License

Bug reports, tricky PDF layout cases, and feature PRs are always welcome!
This project is released under the open-source **MIT License**.
