// Deterministic ATS keyword-match scoring. No LLM involved — this is a fast
// signal we compute on every filtered job to help prioritize which to tailor
// first. The score is (matched JD keywords / total JD keywords).

import type { AtsMatch } from "../types.ts";

// Canonical tech vocabulary. Match is case-insensitive and whole-token.
// Ordered roughly by popularity so surfaced missing keywords feel intuitive.
const TECH_VOCAB = [
  // Languages
  "typescript", "javascript", "python", "java", "go", "golang", "rust",
  "c++", "c#", "ruby", "php", "scala", "kotlin", "swift", "elixir", "clojure",
  "r", "sql", "bash", "shell",
  // Frontend
  "react", "next.js", "nextjs", "vue", "angular", "svelte", "redux", "tailwind",
  "html", "css", "webpack", "vite", "graphql",
  // Backend
  "node.js", "nodejs", "express", "fastapi", "flask", "django", ".net",
  "spring", "spring boot", "rails", "nestjs", "grpc", "rest", "rest api",
  "rest apis", "microservices",
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
  "evaluation", "evals", "agents", "agent sdk",
  // Testing
  "jest", "vitest", "pytest", "playwright", "cypress", "selenium",
  "junit", "mocha",
  // Concepts
  "ci/cd", "cicd", "distributed systems", "concurrency", "scalability",
  "performance", "monitoring", "logging", "security", "oauth", "jwt",
  "websockets", "sse", "event-driven", "event sourcing", "cqrs",
  "system design", "api design", "data structures", "algorithms",
  "machine learning", "deep learning", "nlp", "computer vision",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildVocabRegex(): RegExp {
  // Sort by length desc so longer phrases (e.g. "rest api") match before
  // shorter substrings ("rest").
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
  const matched: string[] = [];
  const missing: string[] = [];
  for (const k of jdKeys) {
    if (resumeKeys.has(k)) matched.push(k);
    else missing.push(k);
  }
  const total = jdKeys.size;
  const score = total === 0 ? 0 : matched.length / total;
  return { score, matched, missing };
}

export function atsMatchLabel(m: AtsMatch): string {
  const pct = Math.round(m.score * 100);
  return `${pct}% ATS match (${m.matched.length}/${m.matched.length + m.missing.length})`;
}
