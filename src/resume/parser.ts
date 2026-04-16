// Parses resume.md into an atomic, addressable structure. Every bullet has a
// stable ID — the LLM picks which IDs to keep/hide/rephrase, never produces
// free-text bullets from scratch. That's how we guarantee zero hallucination.

export type ResumeBullet = {
  id: string;
  text: string;
};

export type ResumeExperience = {
  id: string;
  heading: string; // e.g. "Product Engineer — Juspay"
  meta: string; // e.g. "Feb 2026 – Present · Bangalore"
  bullets: ResumeBullet[];
};

export type ResumeProject = {
  id: string;
  heading: string; // "Probe — AI Behavioral Testing Platform"
  techStack: string; // "Python, FastAPI, sentence-transformers, sympy, SQLModel"
  intro: string; // one-paragraph description above bullets
  bullets: ResumeBullet[];
};

export type SkillCategory = {
  id: string;
  category: string; // "Languages"
  items: string[];
};

export type ParsedResume = {
  headerMd: string;
  summary: string;
  achievements: ResumeBullet[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: SkillCategory[];
  educationMd: string;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

type Section = { title: string; body: string };

function splitSections(md: string): { header: string; sections: Section[] } {
  const lines = md.split(/\r?\n/);
  // Header = everything until the first --- or first ## heading.
  let i = 0;
  const headerLines: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^---\s*$/.test(line) || /^##\s+/.test(line)) break;
    headerLines.push(line);
  }
  // Skip --- separators
  while (i < lines.length && /^---\s*$/.test(lines[i]!)) i++;

  const sections: Section[] = [];
  let current: Section | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1]!, body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);
  return { header: headerLines.join("\n").trim(), sections };
}

function extractBullets(body: string, idPrefix: string): ResumeBullet[] {
  const out: ResumeBullet[] = [];
  const lines = body.split(/\r?\n/);
  let current: string | null = null;
  let idx = 0;
  for (const line of lines) {
    const startMatch = /^[-*]\s+(.*)$/.exec(line);
    if (startMatch) {
      if (current !== null) {
        out.push({ id: `${idPrefix}-${idx++}`, text: current.trim() });
      }
      current = startMatch[1]!;
    } else if (current !== null && /^\s+/.test(line) && line.trim()) {
      // Continuation line
      current += " " + line.trim();
    } else if (line.trim() === "" && current !== null) {
      out.push({ id: `${idPrefix}-${idx++}`, text: current.trim() });
      current = null;
    }
  }
  if (current !== null) {
    out.push({ id: `${idPrefix}-${idx++}`, text: current.trim() });
  }
  return out;
}

type BlockHeading = {
  heading: string;
  meta: string;
  body: string;
};

// Split a section body into sub-blocks by ### headings.
function splitSubBlocks(body: string): BlockHeading[] {
  const lines = body.split(/\r?\n/);
  const blocks: BlockHeading[] = [];
  let cur: BlockHeading | null = null;
  let gotMeta = false;
  for (const line of lines) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (cur) blocks.push(cur);
      cur = { heading: h[1]!, meta: "", body: "" };
      gotMeta = false;
    } else if (cur && !gotMeta && /^\*.+\*\s*$/.test(line.trim())) {
      // First italic line after heading = meta (dates · location)
      cur.meta = line.trim().replace(/^\*|\*$/g, "");
      gotMeta = true;
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseExperience(section: Section): ResumeExperience[] {
  const blocks = splitSubBlocks(section.body);
  return blocks.map((b, i) => {
    const id = `exp-${slug(b.heading) || String(i)}`;
    return {
      id,
      heading: b.heading,
      meta: b.meta,
      bullets: extractBullets(b.body, id),
    };
  });
}

function parseProjects(section: Section): ResumeProject[] {
  const blocks = splitSubBlocks(section.body);
  return blocks.map((b, i) => {
    const id = `proj-${slug(b.heading) || String(i)}`;
    // First non-empty paragraph after meta = intro; rest is bullets.
    const rawLines = b.body.split(/\r?\n/);
    const nonBulletLines: string[] = [];
    const bulletStart = rawLines.findIndex((l) => /^[-*]\s+/.test(l));
    const introEnd = bulletStart === -1 ? rawLines.length : bulletStart;
    for (let j = 0; j < introEnd; j++) nonBulletLines.push(rawLines[j]!);
    const intro = nonBulletLines.join("\n").trim();
    const bulletBody = bulletStart === -1 ? "" : rawLines.slice(bulletStart).join("\n");
    return {
      id,
      heading: b.heading,
      techStack: b.meta,
      intro,
      bullets: extractBullets(bulletBody, id),
    };
  });
}

function parseSkills(section: Section): SkillCategory[] {
  // Each bold line "**Category**: item1, item2, ..." becomes a category.
  const out: SkillCategory[] = [];
  const lines = section.body.split(/\r?\n/);
  let idx = 0;
  for (const line of lines) {
    const m = /^\*\*([^*]+)\*\*\s*:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const category = m[1]!.trim();
    const items = m[2]!
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    out.push({ id: `skill-${slug(category)}-${idx++}`, category, items });
  }
  return out;
}

export function parseResume(md: string): ParsedResume {
  const { header, sections } = splitSections(md);
  const findSection = (key: string): Section | undefined =>
    sections.find((s) => s.title.toLowerCase().includes(key.toLowerCase()));

  const summarySection = findSection("summary");
  const summary = summarySection ? summarySection.body.trim() : "";

  const achievementsSection =
    findSection("competitive") ||
    findSection("achievement");
  const achievements = achievementsSection
    ? extractBullets(achievementsSection.body, "ach")
    : [];

  const experienceSection =
    findSection("experience") || findSection("work");
  const experience = experienceSection ? parseExperience(experienceSection) : [];

  const projectsSection = findSection("project");
  const projects = projectsSection ? parseProjects(projectsSection) : [];

  const skillsSection = findSection("skill");
  const skills = skillsSection ? parseSkills(skillsSection) : [];

  const educationSection = findSection("education");
  const educationMd = educationSection ? educationSection.body.trim() : "";

  return {
    headerMd: header,
    summary,
    achievements,
    experience,
    projects,
    skills,
    educationMd,
  };
}

// Every bullet ID that exists anywhere in the resume — used for plan validation.
export function allBulletIds(r: ParsedResume): Set<string> {
  const ids = new Set<string>();
  for (const b of r.achievements) ids.add(b.id);
  for (const e of r.experience) for (const b of e.bullets) ids.add(b.id);
  for (const p of r.projects) for (const b of p.bullets) ids.add(b.id);
  return ids;
}

export function findBullet(r: ParsedResume, id: string): ResumeBullet | undefined {
  for (const b of r.achievements) if (b.id === id) return b;
  for (const e of r.experience) for (const b of e.bullets) if (b.id === id) return b;
  for (const p of r.projects) for (const b of p.bullets) if (b.id === id) return b;
  return undefined;
}
