# Compare Marketing Materials

Client-side tool to compare two **PDF** or **Word (.docx)** documents. You get **semantic** (word-level highlights) and **pixel overlay** (PDF only) views, page alignment when page counts differ, optional scroll sync, and PDF exports. Nothing is uploaded; files stay in your browser.

**Live app:** [https://pdf-compare-phi.vercel.app/](https://pdf-compare-phi.vercel.app/)

## Features

- **PDF or Word** — Upload two PDFs or two `.docx` files (same type on both sides). Drag-and-drop or file picker.
- **Semantic text comparison** — Highlights removed (red) and added (green) text; PDFs use PDF.js text extraction with reading-order grouping and page alignment via content fingerprints.
- **Content overlay (PDF only)** — Pixel diff: matches in grayscale, differences in red; per-page match stats, zoom, multi-page navigation.
- **Word comparisons** — Semantic HTML diff only (overlay mode is not available for `.docx`).
- **Change report** — Summary counts; download a side-by-side comparison PDF (semantic view; Word path uses html2canvas for the export).
- **Scroll sync** — Optional linked scrolling between Original and Modified in semantic view (PDF stacked pages).
- **Responsive layout** — Works on typical desktop and tablet widths.

## Tech stack

- Static **HTML**, **CSS**, **JavaScript** (no framework)
- [PDF.js](https://mozilla.github.io/pdf.js/) (CDN) — render PDF pages to canvas, text layer
- [Mammoth](https://github.com/mwilliamson/mammoth.js) (CDN) — `.docx` → HTML for Word comparisons
- Canvas **ImageData** — pixel overlay diff
- [jsPDF](https://github.com/parallax/jsPDF) (CDN) — download comparison / overlay as PDF
- [html2canvas](https://html2canvas.hertzen.com/) (CDN) — rasterize Word semantic panels for PDF export

## Run locally

You need a **local HTTP server** (module scripts, workers, and some APIs behave poorly from `file://`).

1. Clone or download this repository and open a terminal in the project root (the folder that contains `index.html`).

2. Start any static file server from that folder, for example:

   **Node (recommended)** — from the project root:

   ```bash
   npx --yes serve .
   ```

   Then open the URL the CLI prints (often `http://localhost:3000`).

   **Python 3:**

   ```bash
   python3 -m http.server 8000
   ```

   Then open [http://localhost:8000](http://localhost:8000).

3. Use the app in the browser: choose Original and Modified documents, then **Compare Documents**.

If you open `index.html` directly from disk, the page may load but some behavior can be unreliable; prefer a local server.

## Deploy (e.g. Vercel)

The site is static — no build step or server code required.

1. **From Git** — Push the repo, import it in [Vercel](https://vercel.com), use defaults (static output from the repo root).
2. **CLI** — Install the [Vercel CLI](https://vercel.com/cli), run `vercel` in the project folder, follow the prompts.
3. **Dashboard** — Create a project and upload this folder or a zip.

Optional `vercel.json` in the repo can adjust headers or routing if you extend the project.

## Project structure

```
pdf-compare/
├── index.html    # UI shell, CDN script tags
├── style.css     # Layout and components
├── app.js        # Compare, alignment, overlay, semantic, Word flow
├── vercel.json   # Optional Vercel config
└── README.md
```

`index.html` references `logo.jpg` for the header; add that asset next to `index.html` if it is not already in your copy.

## Privacy

- Processing runs entirely in the browser.
- Documents are not sent to a backend for comparison.
- Data exists in memory only while the tab is open.

## License

MIT
