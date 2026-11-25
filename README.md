<p align="center">
  <img src="docs/banner.jpg" alt="Paper Reader — ask Claude about a research paper while you read it" width="100%">
</p>

<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/RazinAleksandr/paper-reader/releases/latest"><img src="https://img.shields.io/github/v/release/RazinAleksandr/paper-reader?style=flat-square&label=release&color=18181A" alt="release"></a>
  <a href="https://github.com/RazinAleksandr/paper-reader/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/RazinAleksandr/paper-reader/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-required-D97757?style=flat-square" alt="Claude Code">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux-111?style=flat-square&logo=apple&logoColor=white" alt="macOS · Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="MIT"></a>
</p>

<p align="center">
  A reader for research papers that you can <b>ask questions while you read</b>.<br>
  Select a confusing sentence or cut out a formula, figure or table, and ask Claude about it.<br>
  Every paper gets its own Claude Code session, so Claude has the whole paper in front of it and remembers what you asked.
</p>

<p align="center">
  <img src="docs/demo.gif" width="860" alt="Cutting out the attention formula and asking Claude to break it down">
</p>

---

## ⚡ Quick start

```bash
git clone https://github.com/RazinAleksandr/paper-reader.git && cd paper-reader
./paper-reader                                   # installs, builds, opens http://localhost:4317
./paper-reader https://arxiv.org/abs/1706.03762  # or open a paper right away
./paper-reader ~/Downloads/paper.pdf
```

You need [Node.js](https://nodejs.org) 22+ and [Claude Code](https://docs.claude.com/en/docs/claude-code), installed and logged in (run `claude` once and complete `/login`). Developed and tested on macOS with Chrome; Linux should work too.

## ✨ Highlights

|  |  |
|---|---|
| 🔑 **No API key** | It runs your local Claude Code, so it uses your Claude subscription. |
| 🔒 **Local** | Papers, highlights and chats stay on your machine. The server listens on `127.0.0.1` only. |
| 🧠 **For papers you don't understand yet** | Answers start with the intuition, then the precise meaning, and explain every symbol in a formula. |
| ✂️ **Ask about anything on the page** | Select text, or press `S` and cut out a formula, figure or table — it goes to Claude as an image. |
| 🔗 **Reads like a real reader** | Working links, citation previews, search across the whole paper, tabs, themes. |
| 🌐 **English, Russian, Chinese** | Switch the interface in ⚙️ Settings. Claude answers in the same language unless you pick another. |

## 📸 A closer look

<p align="center">
  <img src="docs/reader.jpg" width="860" alt="Claude breaks down the attention formula next to the paper">
</p>

| Select text, get a toolbar | Hover a citation to preview it |
| --- | --- |
| ![Selection toolbar](docs/selection.jpg) | ![Citation preview](docs/citation-preview.jpg) |
| **Library** | **Dark theme** |
| ![Library](docs/library.jpg) | ![Dark theme](docs/dark.jpg) |

## 🧭 Features

**Open anything**
- PDF, DOCX, HTML, Markdown and TXT files: drag them in, pick them, or paste them.
- Links: arXiv (`/abs/` pages become PDFs, with title and authors from the arXiv API), OpenReview, ACL Anthology, bioRxiv/medRxiv, any journal page that publishes `citation_pdf_url`, and plain blog posts. Blog posts are saved for offline reading, images included.
- Opening the same link or file twice opens the paper you already have.

**Ask while reading**
- Select text and a toolbar appears: *Ask*, *Explain*, *Break down*, *Example*, plus four highlight colours.
- Press `S` and drag over a formula, figure or table. The region is rendered again at high resolution and sent to Claude as an image together with the text under it.
- Put several fragments and screenshots into one question, or paste an image from the clipboard.
- Attach another paper from your library to a question (“how does this differ from LoRA?”). Claude reads both.
- A small marker in the page margin shows where you asked something. Click it to jump to that conversation.
- Answers stream in and render LaTeX, tables, code and Mermaid diagrams. While Claude works you see what it is doing (“Searching the text…”, “Looking at paper.pdf, p. 7”), and you can stop it at any time. Links such as “p. 4” scroll the paper to that page.
- The **Notes** tab: Claude keeps a summary of the paper and of your questions in `notes.md`.

**Navigate like in a real reader**
- Links inside the PDF work. Hover over a citation, “Figure 2” or “Table 1” to preview it, and click to jump there; *Back to reading* returns you to where you were. If the reference contains an arXiv ID or DOI, you can open the cited paper in one click.
- `⌘F` searches the whole paper, not just the pages on screen.
- The table of contents comes from the PDF's bookmarks or, if there are none, from its section headings.
- Tabs for several papers. `⌘K` jumps to any paper or opens a pasted link. A dot on a tab means Claude is still answering, or that an answer arrived while you were reading another paper.
- Reading position, zoom and highlights are remembered for each paper. Light, sepia and dark themes; in the dark theme the PDF is inverted too.
- Export highlights, notes and the whole Q&A to one Markdown file, which works with Obsidian.

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| `⌘K` | Open another paper or paste a link |
| `⌘F` | Search in the paper |
| `S` | Cut out a region as a screenshot |
| `A` / `E` | With a selection: add it to the question / ask Claude to explain it |
| `/` | Focus the question box |
| `⌘+` `⌘−` `⌘0` | Zoom; `0` fits the page width |
| `?` | All shortcuts |

## 🤖 How the Claude sessions work

- Each paper runs its own long-lived `claude -p --input-format stream-json` process in the project folder. Sessions are named `📄 <paper title>`, so they also show up in `claude --resume`. The chat menu has *Copy command for Terminal* if you want to continue a session in the terminal.
- Claude gets the full extracted text of the paper, split by page (`paper.md`), and can open the original PDF to look at a figure.
- **Restricted permissions.** Claude can read files inside the project folder only, can write only the paper's `notes.md`, and may fetch pages only from research sites (arXiv, OpenReview, Semantic Scholar, Wikipedia, GitHub and similar). Text inside a paper therefore cannot send Claude after your personal files.
- **Answer language.** By default Claude answers in the interface language; set another one in ⚙️ Settings. This setting wins over a `language` in your own Claude Code settings.
- Idle sessions go to sleep after 30 minutes, and at most 4 run at once. When you ask again, the session resumes with `--resume` and keeps its full context.
- **Start-up skills.** New sessions can receive slash commands first. The default is [`/i-have-adhd:i-have-adhd`](https://github.com/ayghri/i-have-adhd), which makes answers short and actionable; if the skill is not installed it is skipped. To install it:
  ```bash
  claude plugin marketplace add ayghri/i-have-adhd
  claude plugin install i-have-adhd@i-have-adhd
  ```
  The start-up skills, model, effort level and answer language are in ⚙️ Settings on the library page.

## 🗂️ Your data

Everything lives in `data/`, which is excluded from git:

```
data/
  config.json            settings
  papers/<id>/
    paper.pdf | article.html   original
    paper.md             extracted text that Claude reads
    chat.json            conversation
    highlights.json      highlights and notes
    notes.md             Claude's summary
    snippets/            screenshots you sent
```

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `4317` | HTTP port |
| `PAPER_READER_DATA` | `./data` | Library location, e.g. a synced folder |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |
| `PAPER_READER_MAX_SESSIONS` | `4` | Claude processes alive at once |
| `PAPER_READER_SESSION_CWD` | project folder | Working directory of the sessions |

## 🩺 Troubleshooting

<details><summary><b>“Claude Code not found” banner</b></summary>

Install Claude Code and make sure `claude` is on your `PATH`, or set `CLAUDE_BIN`.
</details>

<details><summary><b>The chat says Claude is not logged in</b></summary>

Run `claude` in a terminal, complete `/login`, then ask again.
</details>

<details><summary><b>The port is busy</b></summary>

`PORT=4400 ./paper-reader`
</details>

<details><summary><b>A scanned PDF has no text</b></summary>

Selection and search need a text layer, so run OCR first (for example `ocrmypdf in.pdf out.pdf`). Screenshots and questions about them still work without it.
</details>

## 🛠️ Development

```bash
npm install
npm run dev        # Vite on :5173 with hot reload + API on :4317
npm run typecheck
npm run build
```

- `server/`: Express API. `claude.ts` manages the sessions and the stream-json protocol; `importers.ts` handles files and links; `pdftext.ts` extracts text and the table of contents.
- `src/`: React app. `reader/` holds the PDF and HTML viewers, links, search and screenshots; `chat/` is the Claude panel; `workspace.ts` handles tabs and the live status of all sessions.
- Translations sit next to the code as `t('English', 'Русский', '中文')` (`src/i18n.ts`, `shared/i18n.ts`).
- README images are real captures of the running app: `scripts/readme/` prepares a demo library, drives Chrome with Playwright while Claude answers, and builds the screenshots, GIF and banner.

Issues and pull requests are welcome.

## 📄 License

[MIT](LICENSE)
