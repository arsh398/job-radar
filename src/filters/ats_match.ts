// Deterministic ATS keyword-match scoring with skill-ontology expansion.
// The key insight: a JD saying "HTML, CSS" is NOT a missing skill for a
// resume that lists React — React implies HTML + CSS + JavaScript. This
// matches how modern ATS skill-graphs (Greenhouse, Workday Skills Cloud)
// resolve implied skills.
//
// Pipeline:
//   1. Extract JD tech keywords (regex match against vocab).
//   2. Extract resume tech keywords (same regex).
//   3. Expand resume skills via SKILL_ONTOLOGY (transitive closure).
//   4. JD keyword is "matched" if in the expanded resume set; else "missing".

import type { AtsMatch } from "../types.ts";
import { transitiveImplied } from "../skills/ontology.ts";

// Canonical vocabulary. Order by length descending so longer multi-word
// phrases ("rest api") match before shorter tokens inside them ("rest").
const TECH_VOCAB = [
  // Languages
  "typescript", "javascript", "python", "java", "go", "golang", "rust",
  "c++", "c#", "ruby", "php", "scala", "kotlin", "swift", "elixir", "clojure",
  "r", "sql", "bash", "shell",
  // Frontend
  "react", "next.js", "nextjs", "vue", "angular", "svelte", "redux", "tailwind",
  "html", "css", "webpack", "vite", "graphql", "dom", "jsx",
  // Backend
  "node.js", "nodejs", "express", "express.js", "fastapi", "flask", "django",
  ".net", "asp.net", "spring", "spring boot", "rails", "nestjs", "grpc",
  "rest", "rest api", "rest apis", "microservices", "http", "websockets", "sse",
  // Data
  "postgresql", "postgres", "mysql", "mongodb", "redis", "cassandra",
  "elasticsearch", "kafka", "rabbitmq", "snowflake", "bigquery", "dynamodb",
  "clickhouse", "sqlite", "prisma", "sqlmodel", "sqlalchemy",
  // Cloud / infra
  "aws", "gcp", "azure", "kubernetes", "k8s", "docker", "terraform", "ansible",
  "jenkins", "circleci", "github actions", "gitlab ci", "helm", "istio",
  "ec2", "s3", "ecr", "eks", "lambda", "cloudfront", "gcs", "pubsub",
  // Observability
  "prometheus", "grafana", "datadog", "sentry", "opentelemetry", "elk",
  // AI/ML
  "pytorch", "tensorflow", "keras", "scikit-learn", "huggingface",
  "transformers", "openai", "anthropic", "claude", "gemini", "gpt",
  "llm", "llms", "rag", "langchain", "llamaindex", "sentence-transformers",
  "embeddings", "vector database", "pinecone", "weaviate", "chroma",
  "mcp", "model context protocol", "prompt engineering", "fine-tuning",
  "evaluation", "evals", "agents", "agent sdk", "claude agent sdk",
  // Testing
  "jest", "vitest", "pytest", "playwright", "cypress", "selenium",
  "junit", "mocha",
  // Concepts
  "ci/cd", "cicd", "distributed systems", "concurrency", "scalability",
  "performance", "monitoring", "logging", "security", "oauth", "jwt",
  "event-driven", "event sourcing", "cqrs",
  "system design", "api design", "data structures", "algorithms",
  "machine learning", "deep learning", "nlp", "computer vision",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVocabRegex(): RegExp {
  const sorted = [...TECH_VOCAB].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(escapeRegex).join("|");
  return new RegExp(`(?<![\\w.])(?:${pattern})(?![\\w.])`, "gi");
}

const VOCAB_RE = buildVocabRegex();

function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();
  const set = new Set<string>();
  const lower = text.toLowerCase();
  const matches = lower.match(VOCAB_RE);
  if (!matches) return set;
  for (const m of matches) set.add(m);
  return set;
}

export function computeAtsMatch(jdText: string, resumeMd: string): AtsMatch {
  const jdKeys = extractKeywords(jdText);
  const resumeKeys = extractKeywords(resumeMd);
  // Expand resume skills via ontology — React implies HTML/CSS/JS etc.
  const resumeExpanded = transitiveImplied(resumeKeys);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const k of jdKeys) {
    if (resumeExpanded.has(k)) matched.push(k);
    else missing.push(k);
  }
  const total = jdKeys.size;
  const score = total === 0 ? 0 : matched.length / total;
  return { score, matched, missing };
}

// Filter a list of putative missing keywords (e.g. from LLM) against the
// resume's implied skill set — drops anything the resume already covers.
// Used to clean up LLM-produced missing_keywords so common-sense-implied
// skills (HTML, CSS, JavaScript from a React engineer) never show as gaps.
export function filterMissingKeywords(
  missing: string[],
  resumeMd: string
): string[] {
  const resumeKeys = extractKeywords(resumeMd);
  const resumeExpanded = transitiveImplied(resumeKeys);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const kw of missing) {
    const key = kw.toLowerCase().trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    if (resumeExpanded.has(key)) continue;
    out.push(kw);
  }
  return out;
}

export function atsMatchLabel(m: AtsMatch): string {
  const pct = Math.round(m.score * 100);
  return `${pct}% ATS match (${m.matched.length}/${m.matched.length + m.missing.length})`;
}
