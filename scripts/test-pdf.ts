import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderMarkdownToPdf, closePdfBrowser } from "../src/pdf/render.ts";

async function main() {
  const md = await readFile(resolve(process.cwd(), "resume.md"), "utf8");
  const started = Date.now();
  const pdf = await renderMarkdownToPdf(md);
  console.log(
    `rendered ${pdf.byteLength} bytes in ${Date.now() - started}ms`
  );
  const out = resolve(process.cwd(), "test-resume.pdf");
  await writeFile(out, pdf);
  console.log(`wrote ${out}`);
  await closePdfBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
