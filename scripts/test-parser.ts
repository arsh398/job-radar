import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseResume, allBulletIds } from "../src/resume/parser.ts";
import { applyPlan } from "../src/resume/apply.ts";

async function main() {
  const md = await readFile(resolve(process.cwd(), "resume.md"), "utf8");
  const parsed = parseResume(md);
  console.log("=== parsed resume ===");
  console.log("summary:", parsed.summary.length, "chars");
  console.log("achievements:", parsed.achievements.length);
  for (const a of parsed.achievements) console.log(`  [${a.id}] ${a.text.slice(0, 80)}`);
  console.log("experience:", parsed.experience.length);
  for (const e of parsed.experience) {
    console.log(`  ${e.id}: ${e.heading} (${e.meta}) — ${e.bullets.length} bullets`);
    for (const b of e.bullets) console.log(`    [${b.id}] ${b.text.slice(0, 80)}`);
  }
  console.log("projects:", parsed.projects.length);
  for (const p of parsed.projects) {
    console.log(`  ${p.id}: ${p.heading} — ${p.bullets.length} bullets`);
    for (const b of p.bullets) console.log(`    [${b.id}] ${b.text.slice(0, 80)}`);
  }
  console.log("skills:", parsed.skills.length);
  for (const s of parsed.skills) {
    console.log(`  ${s.id}: ${s.category}: ${s.items.length} items`);
  }
  console.log("education:", parsed.educationMd.length, "chars");
  console.log("total bullet IDs:", allBulletIds(parsed).size);

  // Dummy plan: hide Juspay bullet 1, rephrase Juspay bullet 0 with a safe rephrase.
  const firstExp = parsed.experience[0];
  if (firstExp && firstExp.bullets.length >= 2) {
    const bullet0 = firstExp.bullets[0]!;
    console.log("\n=== apply dummy plan ===");
    console.log("original bullet0:", bullet0.text.slice(0, 120));
    const { markdown, warnings } = applyPlan(
      parsed,
      md,
      {
        verdict: "apply",
        verdict_reason: "test",
        missing_keywords: [],
        new_summary: null,
        bullet_plan: [
          { id: bullet0.id, keep: true, priority: 0, new_text: bullet0.text }, // no change
          { id: firstExp.bullets[1]!.id, keep: false, priority: 50 }, // hide
          // Invalid rephrase with invented token:
          ...(firstExp.bullets[2]
            ? [
                {
                  id: firstExp.bullets[2].id,
                  keep: true,
                  priority: 10,
                  new_text: "Built blockchain bitcoin GraphQL federated subgraph at XYZ",
                },
              ]
            : []),
        ],
        skill_emphasis: ["Kubernetes", "TypeScript"],
        referral_draft: "",
        cover_note: "",
      },
      "Senior Python engineer at Databricks. Requires Python, Kubernetes, distributed systems."
    );
    console.log("warnings:", warnings.length);
    for (const w of warnings) console.log("  -", w);
    console.log("=== rendered markdown (first 1500 chars) ===");
    console.log(markdown.slice(0, 1500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
