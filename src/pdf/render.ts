// Markdown → premium ATS-safe PDF via Puppeteer + markdown-it.
//
// ATS-safety constraints (hard):
//   - Single column (parsers break on multi-column)
//   - No images, icons, tables, or text inside graphics
//   - Real text for every character (no CSS pseudo-content for bullets)
//   - Standard fonts with fallbacks to system defaults
//   - No color as load-bearing info (monochrome safe with optional accent)
//
// Design choices (beyond ATS-safety):
//   - Modern sans-serif for headings (Inter via system fallback stack)
//   - Light accent color for name and section rules — subtle, not gimmicky
//   - Tight vertical rhythm so content fits one page where possible
//   - Wider line-height inside bullets than between them for readability
//   - Reads as a professional product engineer's resume, not a template

import MarkdownIt from "markdown-it";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

const STYLE = `
  :root {
    color-scheme: only light;
    --ink: #111418;
    --mute: #4a525c;
    --rule: #cfd5dc;
    --accent: #0b4a8f;
  }
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: var(--ink);
    font-family: "Inter", "Helvetica Neue", "Arial", "Segoe UI", system-ui, sans-serif;
    font-size: 10pt;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    padding: 0.5in 0.6in 0.5in 0.6in;
    max-width: 8.27in;
    margin: 0 auto;
  }
  /* Header block */
  h1 {
    font-size: 22pt;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.2pt;
    margin: 0 0 2pt 0;
    line-height: 1.1;
  }
  /* Contact line (the first paragraph after h1) */
  h1 + p {
    margin: 0;
    font-size: 9pt;
    color: var(--mute);
    line-height: 1.5;
    letter-spacing: 0.1pt;
  }
  /* Second paragraph in the header (profile links) */
  h1 + p + p {
    margin: 2pt 0 0;
    font-size: 9pt;
    color: var(--mute);
    line-height: 1.5;
  }
  hr {
    border: 0;
    border-top: 0.6pt solid var(--rule);
    margin: 10pt 0 0;
  }
  /* Section headings */
  h2 {
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.4pt;
    color: var(--accent);
    margin: 14pt 0 4pt 0;
    padding-bottom: 3pt;
    border-bottom: 0.5pt solid var(--rule);
  }
  /* Sub-section (role / project) titles */
  h3 {
    font-size: 10.5pt;
    font-weight: 700;
    color: var(--ink);
    margin: 10pt 0 0 0;
    line-height: 1.25;
  }
  /* Meta line (italic) directly under h3 — dates · location OR tech stack */
  h3 + p em:only-child,
  h3 + p > em:first-child:last-child {
    color: var(--mute);
    font-style: italic;
  }
  h3 + p {
    margin: 0 0 3pt 0;
    font-size: 9.5pt;
    color: var(--mute);
  }
  /* Generic paragraphs inside sections */
  p {
    margin: 3pt 0;
  }
  /* Bullet lists */
  ul {
    margin: 3pt 0 6pt 0;
    padding-left: 16pt;
    list-style-type: disc;
  }
  ul > li {
    margin: 2pt 0;
    padding-left: 2pt;
    line-height: 1.42;
  }
  li > p { margin: 0; display: inline; }
  /* Emphasis */
  strong { font-weight: 700; color: var(--ink); }
  em { font-style: italic; color: var(--mute); }
  /* Skills section — render bold categories prominently */
  /* Inline code used in bullets (e.g. \`run_checks\`) */
  code {
    font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
    font-size: 9.2pt;
    background: #f1f3f6;
    padding: 0.5pt 3pt;
    border-radius: 2pt;
  }
  /* Links — underline only, inherit color */
  a {
    color: inherit;
    text-decoration: none;
    border-bottom: 0.4pt solid var(--rule);
  }
  /* Last-child spacing cleanup */
  .page > *:last-child { margin-bottom: 0; }
`;

function buildHtml(markdown: string): string {
  const body = md.render(markdown);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Resume</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="page">
    ${body}
  </div>
</body>
</html>`;
}

let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.connected) return cachedBrowser;
  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=medium",
    ],
  });
  return cachedBrowser;
}

export async function renderMarkdownToPdf(markdown: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(buildHtml(markdown), { waitUntil: "domcontentloaded" });
    await page.emulateMediaType("print");
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: true,
    });
    return buffer;
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (cachedBrowser) {
    await cachedBrowser.close().catch(() => undefined);
    cachedBrowser = null;
  }
}
