// Multi-profile resume support. For a single resume.md at the repo root,
// behaves exactly as before (one "default" profile). To use multiple
// profiles, create a `resumes/` directory with `<profile>.md` files:
//
//   resumes/
//   ├── default.md   (the fallback / generalist profile)
//   ├── backend.md   (distributed systems, Kubernetes, infra emphasis)
//   ├── ai.md        (LLM evals, embeddings, agent tooling emphasis)
//   └── frontend.md  (React, Next.js, UX emphasis)
//
// The pipeline picks the best profile per JD by embedding similarity,
// with the job's track tag ("sde" / "ai") as a tiebreaker.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { ParsedResume } from "./parser.ts";
import { parseResume } from "./parser.ts";
import { embedText, semanticFit } from "../match/embeddings.ts";

export type ResumeProfile = {
  name: string;
  md: string;
  parsed: ParsedResume;
  embedding: number[] | null; // populated lazily on first use
};

export async function loadProfiles(rootDir: string): Promise<ResumeProfile[]> {
  const dir = resolve(rootDir, "resumes");
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    if (files.length === 0) {
      throw new Error(`resumes/ directory exists but has no .md files`);
    }
    const profiles: ResumeProfile[] = [];
    for (const f of files) {
      const full = resolve(dir, f);
      const md = await readFile(full, "utf8");
      profiles.push({
        name: basename(f, ".md"),
        md,
        parsed: parseResume(md),
        embedding: null,
      });
    }
    return profiles;
  }
  // Legacy single-file layout.
  const legacyPath = resolve(rootDir, "resume.md");
  if (!existsSync(legacyPath)) {
    throw new Error(
      `No resume found — expected either resumes/*.md or resume.md at ${rootDir}`
    );
  }
  const md = await readFile(legacyPath, "utf8");
  return [
    { name: "default", md, parsed: parseResume(md), embedding: null },
  ];
}

// Pick the best profile for a job given its JD text and track tag. For a
// single-profile install this is a no-op. For multi-profile, uses
// embeddings for semantic match and prefers profiles whose name matches
// the track tag.
export async function pickProfile(
  profiles: ResumeProfile[],
  jdText: string,
  track: string
): Promise<{ profile: ResumeProfile; fit: number }> {
  if (profiles.length === 1) {
    return { profile: profiles[0]!, fit: 1 };
  }

  // Ensure each profile has an embedding.
  for (const p of profiles) {
    if (!p.embedding) {
      // Embed the summary + skills for a compact semantic signal.
      const signal = `${p.parsed.summary}\n\nSkills: ${p.parsed.skills
        .map((c) => `${c.category}: ${c.items.join(", ")}`)
        .join(" | ")}`;
      p.embedding = await embedText(signal, "RETRIEVAL_DOCUMENT");
    }
  }

  const jdVec = await embedText(jdText, "RETRIEVAL_QUERY");
  if (!jdVec) return { profile: profiles[0]!, fit: 0 };

  let best = profiles[0]!;
  let bestScore = -1;
  for (const p of profiles) {
    if (!p.embedding) continue;
    let score = semanticFit(p.embedding, jdVec);
    // Track-name tiebreaker: if the profile name matches the track, bump.
    if (p.name.toLowerCase() === track.toLowerCase()) score += 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return { profile: best, fit: bestScore };
}
