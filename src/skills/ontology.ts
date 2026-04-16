// Skill ontology — captures "X implies Y" relationships so a JD asking for
// HTML doesn't show as "missing" on a resume that lists React. Real ATS
// vendors (Greenhouse Search, Workday Skills Cloud, LinkedIn Talent Insights)
// ship similar skill-graphs; ours is hand-curated for the specific roles
// Mohammed targets.
//
// The map is { parent_skill: [implied_skills] } — if the resume mentions any
// parent, every implied skill is treated as present too.

export const SKILL_ONTOLOGY: Record<string, string[]> = {
  // Web fundamentals — every web framework implies these
  react: ["html", "css", "javascript", "dom", "jsx"],
  "next.js": ["react", "html", "css", "javascript", "ssr", "ssg"],
  nextjs: ["react", "html", "css", "javascript", "ssr", "ssg"],
  vue: ["html", "css", "javascript", "dom"],
  angular: ["html", "css", "javascript", "typescript", "rxjs", "dom"],
  svelte: ["html", "css", "javascript", "dom"],
  redux: ["react", "javascript", "state management"],
  tailwind: ["css"],

  // TypeScript implies JavaScript
  typescript: ["javascript"],

  // Node.js framework chain
  "node.js": ["javascript"],
  nodejs: ["javascript"],
  express: ["node.js", "javascript", "rest", "http"],
  "express.js": ["node.js", "javascript", "rest", "http"],
  nestjs: ["node.js", "typescript", "rest"],

  // Python framework chain
  fastapi: ["python", "rest", "rest api", "rest apis", "openapi", "async"],
  flask: ["python", "rest", "http"],
  django: ["python", "orm", "mvc", "rest"],

  // JVM chain
  "spring boot": ["java", "spring", "rest"],
  spring: ["java", "rest"],

  // .NET
  ".net": ["c#", "rest"],
  "asp.net": [".net", "c#", "rest", "http"],

  // Containers
  kubernetes: ["docker", "containers", "orchestration", "k8s", "yaml"],
  k8s: ["docker", "containers", "orchestration", "kubernetes", "yaml"],
  helm: ["kubernetes", "k8s"],
  istio: ["kubernetes", "service mesh"],

  // Cloud providers imply core cloud concepts
  aws: ["cloud", "iam", "vpc"],
  gcp: ["cloud", "iam"],
  azure: ["cloud", "iam"],
  ec2: ["aws", "cloud", "vm"],
  s3: ["aws", "cloud", "object storage", "storage"],
  ecr: ["aws", "cloud", "docker", "registry"],
  eks: ["aws", "cloud", "kubernetes", "k8s"],
  lambda: ["aws", "cloud", "serverless"],
  cloudfront: ["aws", "cloud", "cdn"],
  gcs: ["gcp", "cloud", "object storage", "storage"],
  bigquery: ["gcp", "cloud", "sql", "data warehouse"],

  // Databases — ORM chains
  prisma: ["database", "sql", "orm", "typescript"],
  sqlmodel: ["python", "sql", "orm", "pydantic"],
  sqlalchemy: ["python", "sql", "orm"],
  postgresql: ["sql", "relational", "database"],
  postgres: ["sql", "relational", "database"],
  mysql: ["sql", "relational", "database"],
  mongodb: ["nosql", "database", "document store"],
  redis: ["cache", "kv store", "in-memory", "database"],
  elasticsearch: ["search", "indexing"],
  kafka: ["streaming", "pub/sub", "events", "distributed"],
  dynamodb: ["aws", "nosql", "database"],

  // CI/CD
  "github actions": ["ci/cd", "cicd", "yaml"],
  "gitlab ci": ["ci/cd", "cicd", "yaml"],
  jenkins: ["ci/cd", "cicd"],
  circleci: ["ci/cd", "cicd"],

  // Testing — web frameworks imply testing knowledge
  jest: ["testing", "javascript", "unit testing"],
  vitest: ["testing", "javascript", "typescript", "unit testing"],
  pytest: ["testing", "python", "unit testing"],
  playwright: ["testing", "e2e", "browser automation"],
  cypress: ["testing", "e2e", "browser automation"],

  // AI/ML chain
  pytorch: ["python", "machine learning", "deep learning", "ml"],
  tensorflow: ["python", "machine learning", "deep learning", "ml"],
  huggingface: ["machine learning", "transformers", "nlp", "python"],
  transformers: ["machine learning", "nlp", "deep learning", "python"],
  "sentence-transformers": [
    "embeddings",
    "nlp",
    "python",
    "transformers",
    "machine learning",
  ],
  langchain: ["llm", "llms", "rag", "python", "agents"],
  llamaindex: ["llm", "llms", "rag", "python"],
  rag: ["llm", "llms", "embeddings", "vector database"],
  mcp: ["model context protocol", "llm", "agents"],
  "claude agent sdk": ["llm", "agents", "anthropic"],
  openai: ["llm", "gpt"],
  anthropic: ["llm", "claude"],
  gemini: ["llm", "google"],
  gpt: ["llm", "openai"],
  pinecone: ["vector database", "embeddings"],
  weaviate: ["vector database", "embeddings"],
  chroma: ["vector database", "embeddings"],

  // Concepts — bidirectional
  "rest apis": ["rest", "http", "api design"],
  "rest api": ["rest", "http", "api design"],
  microservices: ["distributed systems", "api design"],
  "event-driven": ["events", "distributed systems"],
  "event sourcing": ["events", "cqrs", "distributed systems"],
  oauth: ["auth", "authentication", "security"],
  jwt: ["auth", "authentication", "tokens"],
  websockets: ["real-time", "http"],
  sse: ["real-time", "http", "streaming"],
  grpc: ["rpc", "api design", "protocol buffers"],
  graphql: ["api design", "query language"],

  // Container registry & orchestration bidirectional
  docker: ["containers"],
};

// Normalize a skill token to ontology form.
function norm(s: string): string {
  return s.toLowerCase().trim();
}

// Given a set of skills present on the resume, return the transitive
// closure: every skill the resume implicitly covers. Bounded to avoid
// infinite loops if the map ever forms cycles.
export function transitiveImplied(present: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue: string[] = [];
  for (const s of present) {
    const n = norm(s);
    if (!out.has(n)) {
      out.add(n);
      queue.push(n);
    }
  }
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const cur = queue.shift()!;
    const implied = SKILL_ONTOLOGY[cur];
    if (!implied) continue;
    for (const child of implied) {
      const n = norm(child);
      if (!out.has(n)) {
        out.add(n);
        queue.push(n);
      }
    }
  }
  return out;
}

// True if the resume (transitive-implied) covers the given JD skill.
export function isCovered(skill: string, resumeImplied: Set<string>): boolean {
  return resumeImplied.has(norm(skill));
}
