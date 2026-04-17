import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseResume } from "../src/resume/parser.ts";
import { applyPlan } from "../src/resume/apply.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "../src/pdf/render.ts";
import { TailoringPlanSchema } from "../src/types.ts";

async function main() {
  const md = await readFile(resolve(process.cwd(), "resume.md"), "utf8");
  const parsed = parseResume(md);
  // Noop plan — keep everything, rank by original order. Renders the
  // resume in the same path production uses for tailored output, so
  // the preview PDF matches what Mohammed sees in Telegram.
  const plan = TailoringPlanSchema.parse({
    verdict: "apply",
    verdict_reason: "preview",
  });
  const { markdown } = applyPlan(parsed, md, plan, "");
  await writeFile(resolve(process.cwd(), "test-resume.md"), markdown);
  const started = Date.now();
  const pdf = await renderMarkdownToPdf(markdown);
  console.log(`rendered ${pdf.byteLength} bytes in ${Date.now() - started}ms`);
  const out = resolve(process.cwd(), "test-resume.pdf");
  await writeFile(out, pdf);
  console.log(`wrote ${out}`);
  await closePdfBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
