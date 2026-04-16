import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseResume } from "../src/resume/parser.ts";
import { applyPlan } from "../src/resume/apply.ts";
import { renderMarkdownToPdf, closePdfBrowser } from "../src/pdf/render.ts";
import { computeAtsMatch } from "../src/filters/ats_match.ts";

async function main() {
  const md = await readFile(resolve(process.cwd(), "resume.md"), "utf8");
  const parsed = parseResume(md);

  const fakeJd = `
We are hiring a Backend Engineer at Databricks India. Requirements:
- Python, FastAPI or Flask (2+ years)
- Kubernetes, Docker, AWS
- Distributed systems, microservices
- REST APIs, PostgreSQL, Redis
- LLM / RAG experience is a strong plus
- ML platform experience preferred

You'll build scalable infrastructure for our AI platform, work with sentence-transformers and embeddings.
  `;

  console.log("=== ATS match ===");
  const m = computeAtsMatch(fakeJd, md);
  console.log(`score=${(m.score * 100).toFixed(0)}% matched=${m.matched.length} missing=${m.missing.length}`);
  console.log(`matched: ${m.matched.slice(0, 12).join(", ")}`);
  console.log(`missing: ${m.missing.slice(0, 12).join(", ")}`);

  // Fake LLM plan: AI track — prioritize Probe project + Juspay infra bullets
  const plan = {
    verdict: "apply" as const,
    verdict_reason: "Strong AI infra match with Kubernetes + LLM tooling experience",
    missing_keywords: ["Redis", "RAG"],
    new_summary:
      "Product Engineer with 2 years building Kubernetes-based infrastructure, AI behavioral testing platforms, and distributed systems. Shipped production Python and TypeScript systems at Juspay and Avalara. Hands-on experience with LLM evaluation and sentence-transformers embeddings.",
    bullet_plan: [
      // Prioritize Probe (AI platform)
      { id: "proj-probe-ai-behavioral-testing-platform-0", keep: true, priority: 0 },
      { id: "proj-probe-ai-behavioral-testing-platform-2", keep: true, priority: 5 },
      { id: "proj-probe-ai-behavioral-testing-platform-1", keep: true, priority: 10 },
      // Juspay Kubernetes infra
      { id: "exp-product-engineer-juspay-0", keep: true, priority: 0 },
      { id: "exp-product-engineer-juspay-1", keep: true, priority: 5 },
      { id: "exp-product-engineer-juspay-2", keep: true, priority: 15 },
      { id: "exp-product-engineer-juspay-3", keep: false, priority: 90 },
      // Avalara — deprioritize
      { id: "exp-software-engineer-avalara-0", keep: true, priority: 30 },
      { id: "exp-software-engineer-avalara-1", keep: false, priority: 90 },
      { id: "exp-software-engineer-avalara-2", keep: true, priority: 40 },
    ],
    skill_emphasis: ["Python", "Kubernetes", "AWS (S3, ECR, EKS, IRSA)", "FastAPI"],
    referral_draft: "Hi [Name], I'm applying for the Backend Engineer role on your AI platform team. I built a Kubernetes-based execution platform at Juspay and a zero-AI LLM eval pipeline (Probe). Could you refer me?",
    cover_note: "I'm applying for the Backend Engineer role at Databricks India. At Juspay I designed Cerebellum, a Kubernetes-based remote execution environment handling 500 concurrent jobs across AWS and GCS. I also built Probe, an LLM evaluation platform using sentence-transformers embeddings and statistical tests. I'd bring the same combination of infrastructure and ML tooling to your AI platform team.",
  };

  const { markdown, warnings } = applyPlan(parsed, md, plan, fakeJd);
  console.log("\n=== apply warnings ===");
  for (const w of warnings) console.log("-", w);
  console.log("warnings:", warnings.length);

  await writeFile(
    resolve(process.cwd(), "test-tailored.md"),
    markdown
  );
  console.log("wrote test-tailored.md");

  const t0 = Date.now();
  const pdf = await renderMarkdownToPdf(markdown);
  console.log(`PDF rendered ${pdf.byteLength} bytes in ${Date.now() - t0}ms`);
  await writeFile(resolve(process.cwd(), "test-tailored.pdf"), pdf);
  console.log("wrote test-tailored.pdf");

  await closePdfBrowser();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
