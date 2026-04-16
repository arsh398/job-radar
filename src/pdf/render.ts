// Markdown → ATS-safe PDF via Puppeteer + markdown-it.
//
// Design choices:
// - Single column, system font, no images/icons. ATS parsers choke on
//   multi-column and graphics-heavy resumes.
// - Generous margins, modest font size — readable when printed, parses cleanly.
// - Links rendered as plain underlined text (not colored). ATS scanners often
//   drop CSS styles; we don't want color to be load-bearing.

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
  :root { color-scheme: only light; }
  html, body {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-size: 10.5pt;
    line-height: 1.35;
    color: #111;
    margin: 0;
    padding: 0;
    background: #fff;
    -webkit-print-color-adjust: exact;
  }
  .page { padding: 0.55in 0.7in; }
  h1 {
    font-size: 18pt;
    margin: 0 0 2pt;
    font-weight: 700;
    letter-spacing: 0.1pt;
  }
  h2 {
    font-size: 12pt;
    margin: 14pt 0 4pt;
    padding-bottom: 2pt;
    border-bottom: 0.8pt solid #222;
    text-transform: uppercase;
    letter-spacing: 0.4pt;
    font-weight: 700;
  }
  h3 {
    font-size: 11pt;
    margin: 10pt 0 2pt;
    font-weight: 700;
  }
  p {
    margin: 4pt 0;
  }
  ul {
    margin: 4pt 0 6pt;
    padding-left: 16pt;
  }
  li {
    margin: 2pt 0;
  }
  li > p { margin: 0; }
  em { font-style: italic; color: #555; }
  strong { font-weight: 700; }
  hr { border: 0; border-top: 0.5pt solid #ccc; margin: 6pt 0; }
  a { color: #111; text-decoration: none; }
  .header {
    margin-bottom: 4pt;
  }
  .header p { margin: 0; font-size: 9.5pt; color: #333; }
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
      printBackground: false,
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
