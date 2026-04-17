export type AtsType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "workday"
  | "custom_json"
  | "custom_scraper";

export type CompanyConfig = {
  name: string;
  ats: AtsType;
  slug: string;
  tenant?: string;
  notes?: string;
};

// All live slugs below verified against their ATS API (HTTP 200) on
// 2026-04-16. When adding: curl the ATS endpoint and confirm the slug
// resolves before committing.
export const COMPANIES: CompanyConfig[] = [
  // === Greenhouse ===
  { name: "Stripe", ats: "greenhouse", slug: "stripe" },
  { name: "Airbnb", ats: "greenhouse", slug: "airbnb" },
  { name: "Coinbase", ats: "greenhouse", slug: "coinbase" },
  { name: "Databricks", ats: "greenhouse", slug: "databricks" },
  { name: "Figma", ats: "greenhouse", slug: "figma" },
  { name: "Cloudflare", ats: "greenhouse", slug: "cloudflare" },
  { name: "GitLab", ats: "greenhouse", slug: "gitlab" },
  { name: "MongoDB", ats: "greenhouse", slug: "mongodb" },
  { name: "Robinhood", ats: "greenhouse", slug: "robinhood" },
  { name: "Discord", ats: "greenhouse", slug: "discord" },
  { name: "Reddit", ats: "greenhouse", slug: "reddit" },
  { name: "Brex", ats: "greenhouse", slug: "brex" },
  { name: "Postman", ats: "greenhouse", slug: "postman" },
  { name: "Datadog", ats: "greenhouse", slug: "datadog" },
  { name: "Pinterest", ats: "greenhouse", slug: "pinterest" },
  { name: "Dropbox", ats: "greenhouse", slug: "dropbox" },
  { name: "Lyft", ats: "greenhouse", slug: "lyft" },
  { name: "Instacart", ats: "greenhouse", slug: "instacart" },
  { name: "Asana", ats: "greenhouse", slug: "asana" },
  { name: "Okta", ats: "greenhouse", slug: "okta" },
  { name: "PagerDuty", ats: "greenhouse", slug: "pagerduty" },
  { name: "Airtable", ats: "greenhouse", slug: "airtable" },
  { name: "Webflow", ats: "greenhouse", slug: "webflow" },
  { name: "Affirm", ats: "greenhouse", slug: "affirm" },
  { name: "Anthropic", ats: "greenhouse", slug: "anthropic" },
  { name: "LaunchDarkly", ats: "greenhouse", slug: "launchdarkly" },
  { name: "Temporal", ats: "greenhouse", slug: "temporal" },
  { name: "PlanetScale", ats: "greenhouse", slug: "planetscale" },
  { name: "Scale AI", ats: "greenhouse", slug: "scaleai" },
  { name: "Together AI", ats: "greenhouse", slug: "togetherai" },
  { name: "Fireworks AI", ats: "greenhouse", slug: "fireworksai" },
  { name: "Algolia", ats: "greenhouse", slug: "algolia" },
  { name: "Netlify", ats: "greenhouse", slug: "netlify" },
  { name: "Twilio", ats: "greenhouse", slug: "twilio" },
  { name: "Rubrik", ats: "greenhouse", slug: "rubrik" },
  { name: "Druva", ats: "greenhouse", slug: "druva" },
  { name: "Celonis", ats: "greenhouse", slug: "celonis" },
  { name: "Mercury", ats: "greenhouse", slug: "mercury" },
  { name: "Glean", ats: "greenhouse", slug: "gleanwork" },
  { name: "DeepMind", ats: "greenhouse", slug: "deepmind" },
  { name: "Neuralink", ats: "greenhouse", slug: "neuralink" },
  { name: "Elastic", ats: "greenhouse", slug: "elastic" },
  { name: "Mixpanel", ats: "greenhouse", slug: "mixpanel" },
  { name: "Groww", ats: "greenhouse", slug: "groww" },
  { name: "PhonePe", ats: "greenhouse", slug: "phonepe" },

  // === Lever ===
  { name: "CRED", ats: "lever", slug: "cred" },
  { name: "Freshworks", ats: "lever", slug: "freshworks" },
  { name: "Paytm", ats: "lever", slug: "paytm" },
  { name: "Meesho", ats: "lever", slug: "meesho" },
  { name: "Upstox", ats: "lever", slug: "upstox" },
  { name: "Mistral", ats: "lever", slug: "mistral" },
  { name: "StackBlitz", ats: "lever", slug: "stackblitz" },

  // === Ashby ===
  { name: "Perplexity", ats: "ashby", slug: "perplexity" },
  { name: "Linear", ats: "ashby", slug: "linear" },
  { name: "Vercel", ats: "ashby", slug: "vercel" },
  { name: "Retool", ats: "ashby", slug: "retool" },
  { name: "Replit", ats: "ashby", slug: "replit" },
  { name: "Statsig", ats: "ashby", slug: "statsig" },
  { name: "Character AI", ats: "ashby", slug: "character" },
  { name: "LangChain", ats: "ashby", slug: "langchain" },
  { name: "Pinecone", ats: "ashby", slug: "pinecone" },
  { name: "Anyscale", ats: "ashby", slug: "anyscale" },
  { name: "Runway", ats: "ashby", slug: "runway" },
  { name: "Cursor", ats: "ashby", slug: "cursor" },
  { name: "Notion", ats: "ashby", slug: "notion" },
  { name: "Supabase", ats: "ashby", slug: "supabase" },
  { name: "Docker", ats: "ashby", slug: "docker" },
  { name: "Plaid", ats: "ashby", slug: "plaid" },
  { name: "Confluent", ats: "ashby", slug: "confluent" },
  { name: "Zapier", ats: "ashby", slug: "zapier" },
  { name: "Sentry", ats: "ashby", slug: "sentry" },
  { name: "Ramp", ats: "ashby", slug: "ramp" },
  { name: "Zip", ats: "ashby", slug: "zip" },
  { name: "Braintrust", ats: "ashby", slug: "braintrust" },
  { name: "Poolside", ats: "ashby", slug: "poolside" },
  { name: "Decagon", ats: "ashby", slug: "decagon" },
  { name: "Contextual AI", ats: "ashby", slug: "contextual" },
  { name: "ElevenLabs", ats: "ashby", slug: "elevenlabs" },
  { name: "Baseten", ats: "ashby", slug: "baseten" },
  { name: "Nous Research", ats: "ashby", slug: "nous" },
  { name: "Bolt", ats: "ashby", slug: "bolt" },
  { name: "Turbopuffer", ats: "ashby", slug: "turbopuffer" },
  { name: "Sarvam AI", ats: "ashby", slug: "sarvam" },

  // === Pending — need adapter or slug hunt ===
  // Amazon, Google, Microsoft, Apple, Meta, Uber, IBM — large enterprises,
  //   likely custom_json or Workday.
  // Atlassian, Snowflake, HashiCorp, DoorDash, Rippling, Shopify — moved
  //   off public ATS, need custom_scraper.
  // Razorpay, Zepto, Dream11, MPL, Flipkart, Myntra, Swiggy, Zomato,
  //   PhonePe, Juspay, Zerodha, Ola, Unacademy, Krutrim — Indian portals,
  //   need custom_scraper per-company.
  // Adobe, Oracle, Salesforce, Nvidia, Qualcomm, Mastercard, Visa, PayPal,
  //   Cisco, SAP, Intel, Dell — Workday tenants, need Workday adapter.
];

export const BY_ATS = {
  greenhouse: COMPANIES.filter((c) => c.ats === "greenhouse"),
  lever: COMPANIES.filter((c) => c.ats === "lever"),
  ashby: COMPANIES.filter((c) => c.ats === "ashby"),
  workable: COMPANIES.filter((c) => c.ats === "workable"),
  smartrecruiters: COMPANIES.filter((c) => c.ats === "smartrecruiters"),
  workday: COMPANIES.filter((c) => c.ats === "workday"),
  custom_json: COMPANIES.filter((c) => c.ats === "custom_json"),
  custom_scraper: COMPANIES.filter((c) => c.ats === "custom_scraper"),
};
