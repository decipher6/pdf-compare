# PDF Pixel Comparison Tool

A minimal client-side web app that compares two PDFs and shows a **black/white/red overlay**: matching content in grayscale, differences in red. Everything runs in the browser; no files are sent to any server.

## Features

- Upload two PDFs (Original and Modified) via drag-and-drop or file picker
- Pixel-by-pixel comparison with same-size normalization
- **Black and white** = content matches; **Red** = content differs
- Match percentage and basic stats
- Multi-page support with Previous/Next
- Zoom controls
- Download result as a single PDF (`comparison_doc.pdf`)
- Responsive layout

## Tech Stack

- HTML, CSS, JavaScript (no framework)
- [PDF.js](https://mozilla.github.io/pdf.js/) (CDN) for rendering PDFs to canvas
- Canvas API for pixel comparison
- [jsPDF](https://github.com/parallax/jsPDF) (CDN) for exporting the overlay as PDF

## Run Locally

1. Clone or download this repo.
2. Serve the folder with any static server, for example:
   - **Node:** `npx serve .`
   - **Python 3:** `python3 -m http.server 8000`
3. Open `http://localhost:3000` (or the port shown).

You can also open `index.html` directly in the browser; some features may be limited if the browser blocks file access from `file://`.

## Deploy to Vercel (Static Site)

1. **From Git**
   - Push this repo to GitHub/GitLab/Bitbucket.
   - In [Vercel](https://vercel.com), import the repo.
   - Leave build settings as default (no build command, output = current directory).
   - Deploy.

2. **From CLI**
   - Install [Vercel CLI](https://vercel.com/cli): `npm i -g vercel`
   - In the project folder run: `vercel`
   - Follow prompts and deploy.

3. **Drag & Drop**
   - In Vercel dashboard, create a new project and upload this folder (or a zip of it).

No server-side code or environment variables are required. The app is fully static and runs in the user’s browser.

## Project Structure

```
pdf-compare/
├── index.html   # Main page
├── style.css    # Styles
├── app.js       # Comparison logic and UI
├── vercel.json  # Optional Vercel config
└── README.md
```

## Privacy

- All processing is done in the browser.
- No PDFs or data are sent to any server.
- Files exist only in memory while the page is open.

## License

MIT
