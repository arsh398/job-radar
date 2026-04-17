import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseResume } from "../src/resume/parser.ts";
import { applyPlan } from "../src/resume/apply.ts";
import { TailoringPlanSchema } from "../src/types.ts";
import puppeteer from "puppeteer";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: false, breaks: false });

async function main() {
  const raw = await readFile(resolve(process.cwd(), "resume.md"), "utf8");
  const parsed = parseResume(raw);
  const plan = TailoringPlanSchema.parse({ verdict: "apply", verdict_reason: "m" });
  const { markdown } = applyPlan(parsed, raw, plan, "");

  const STYLE_FILE = await readFile(
    resolve(process.cwd(), "src/pdf/render.ts"),
    "utf8"
  );
  const styleMatch = STYLE_FILE.match(/const STYLE = `([\s\S]*?)`;/);
  const cssText = styleMatch ? styleMatch[1]! : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${cssText}</style></head><body><div class="page">${md.render(markdown)}</div></body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.emulateMediaType("print");

  const metrics = await page.evaluate(() => {
    const pageDiv = document.querySelector(".page") as HTMLElement;
    const rect = pageDiv.getBoundingClientRect();
    const A4 = 1123; // 11.69 in * 96 dpi
    const children = Array.from(pageDiv.querySelectorAll("*")) as HTMLElement[];
    const first = children.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= A4;
    });
    return {
      pageHeightPx: Math.round(rect.height),
      A4px: A4,
      overshootPx: Math.round(rect.height - A4),
      overflowTag: first?.tagName ?? null,
      overflowText: first?.textContent?.slice(0, 100) ?? null,
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
