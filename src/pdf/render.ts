// Markdown → premium single-page ATS-safe PDF.
//
// Design references: Jake Gutierrez's LaTeX resume, Deedy, Awesome-CV.
// Shared traits: single column, compact vertical rhythm, uppercase section
// headings with a thin rule, muted grey for metadata, one accent color max.
//
// The layout is tuned for TAILORED output (what actually gets sent to
// Telegram) — post-LLM bullet selection reliably lands 1 page. The raw
// resume.md preview (test-pdf.ts) may run slightly over if every bullet
// is kept, which is fine — production always tailors.

import MarkdownIt from "markdown-it";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false,
});

const STYLE = `
  :root {
    color-scheme: only light;
    --ink: #0d1117;
    --body: #1f262e;
    --mute: #5b6270;
    --rule: #c7ccd3;
    --accent: #0b4a8f;
  }
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: var(--body);
    font-family: "Inter", "Helvetica Neue", "Arial", "Segoe UI", system-ui, sans-serif;
    font-size: 9pt;
    line-height: 1.24;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    padding: 0.14in 0.4in 0.12in 0.4in;
    max-width: 8.27in;
    margin: 0 auto;
  }

  /* Name block */
  h1 {
    font-size: 19pt;
    font-weight: 700;
    color: var(--ink);
    letter-spacing: 0.1pt;
    margin: 0 0 0 0;
    line-height: 1.05;
  }
  h1 + p {
    margin: 0;
    font-size: 8.8pt;
    color: var(--mute);
    line-height: 1.4;
    letter-spacing: 0.1pt;
  }
  hr {
    border: 0;
    border-top: 0.5pt solid var(--rule);
    margin: 5pt 0 0 0;
  }

  /* Section headings: uppercase tracked, rule below */
  h2 {
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.1pt;
    color: var(--accent);
    margin: 4pt 0 1pt 0;
    padding-bottom: 1pt;
    border-bottom: 0.5pt solid var(--rule);
  }

  /* Role / project titles */
  h3 {
    font-size: 9.5pt;
    font-weight: 700;
    color: var(--ink);
    margin: 2pt 0 0 0;
    line-height: 1.18;
  }
  /* Meta line (dates · location OR tech stack) directly under h3 */
  h3 + p {
    margin: 0 0 0 0;
    font-size: 8pt;
    color: var(--mute);
    line-height: 1.22;
  }
  h3 + p em {
    color: var(--mute);
    font-style: italic;
  }

  /* Body paragraphs (summary, project intros) */
  p {
    margin: 1pt 0;
  }

  /* Bullet lists */
  ul {
    margin: 0.5pt 0 0.5pt 0;
    padding-left: 12pt;
    list-style-type: disc;
  }
  ul > li {
    margin: 0.5pt 0;
    padding-left: 0;
    line-height: 1.25;
  }
  li > p { margin: 0; display: inline; }

  /* Skills block rendered as raw HTML div.skills — each category a <p>
     with ~0 vertical spacing so categories pack into ~4-5 tight lines. */
  .skills { margin: 0; }
  .skills p {
    margin: 0;
    line-height: 1.26;
    font-size: 8.2pt;
  }
  .skills p strong { color: var(--ink); }

  /* Emphasis */
  strong { font-weight: 700; color: var(--ink); }
  em { font-style: italic; color: var(--mute); }

  /* Inline code (e.g. \`run_checks\`) */
  code {
    font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
    font-size: 9pt;
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
