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

// All slugs below verified against live APIs (HTTP 200) on 2026-04-16.
// Companies not listed here either:
//   (a) moved to a custom portal (need custom_scraper) — see comments below
//   (b) use Workday (need workday adapter — pending)
//   (c) use a different ATS we haven't added yet
export const COMPANIES: CompanyConfig[] = [
  // === Greenhouse (verified working) ===
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
  { name: "Ramp", ats: "greenhouse", slug: "rampnetwork" },
  { name: "Glean", ats: "greenhouse", slug: "gleanwork" },

  // === Lever (verified working) ===
  { name: "CRED", ats: "lever", slug: "cred" },

  // === Ashby (verified working) ===
  { name: "Perplexity", ats: "ashby", slug: "perplexity" },
  { name: "Linear", ats: "ashby", slug: "linear" },
  { name: "Vercel", ats: "ashby", slug: "vercel" },
  { name: "Retool", ats: "ashby", slug: "retool" },
  { name: "Replit", ats: "ashby", slug: "replit" },
  { name: "Statsig", ats: "ashby", slug: "statsig" },
  { name: "OpenAI", ats: "ashby", slug: "openai" },
  { name: "Character AI", ats: "ashby", slug: "character" },
  { name: "LangChain", ats: "ashby", slug: "langchain" },
  { name: "Pinecone", ats: "ashby", slug: "pinecone" },
  { name: "Anyscale", ats: "ashby", slug: "anyscale" },
  { name: "Runway", ats: "ashby", slug: "runway" },
  { name: "Cursor", ats: "ashby", slug: "cursor" },

  // === Workday tenants (adapter not yet built) ===
  { name: "Adobe", ats: "workday", slug: "adobe", tenant: "adobe" },
  { name: "Oracle", ats: "workday", slug: "oracle", tenant: "oracle" },
  { name: "Salesforce", ats: "workday", slug: "salesforce", tenant: "salesforce" },
  { name: "Walmart", ats: "workday", slug: "walmart", tenant: "walmart" },
  { name: "Nvidia", ats: "workday", slug: "nvidia", tenant: "nvidia" },
  { name: "Qualcomm", ats: "workday", slug: "qualcomm", tenant: "qualcomm" },
  { name: "Mastercard", ats: "workday", slug: "mastercard", tenant: "mastercard" },
  { name: "Visa", ats: "workday", slug: "visa", tenant: "visa" },
  { name: "PayPal", ats: "workday", slug: "paypal", tenant: "paypal" },
  { name: "Block", ats: "workday", slug: "block", tenant: "square" },
  { name: "Cisco", ats: "workday", slug: "cisco", tenant: "cisco" },
  { name: "SAP", ats: "workday", slug: "sap", tenant: "sap" },
  { name: "Intel", ats: "workday", slug: "intel", tenant: "intel" },
  { name: "Dell", ats: "workday", slug: "dell", tenant: "dell" },

  // === Custom JSON APIs (per-company adapters not yet built) ===
  { name: "Amazon", ats: "custom_json", slug: "amazon" },
  { name: "Google", ats: "custom_json", slug: "google" },
  { name: "Microsoft", ats: "custom_json", slug: "microsoft" },
  { name: "Apple", ats: "custom_json", slug: "apple" },
  { name: "Uber", ats: "custom_json", slug: "uber" },
  { name: "IBM", ats: "custom_json", slug: "ibm" },
  { name: "ServiceNow", ats: "custom_json", slug: "servicenow" },
  { name: "Samsung R&D", ats: "custom_json", slug: "samsung_rd" },

  // === Indian custom portals (per-company scrapers not yet built) ===
  { name: "Flipkart", ats: "custom_scraper", slug: "flipkart" },
  { name: "Myntra", ats: "custom_scraper", slug: "myntra" },
  { name: "Swiggy", ats: "custom_scraper", slug: "swiggy" },
  { name: "Zomato", ats: "custom_scraper", slug: "zomato" },
  { name: "Paytm", ats: "custom_scraper", slug: "paytm" },
  { name: "PhonePe", ats: "custom_scraper", slug: "phonepe" },
  { name: "Juspay", ats: "custom_scraper", slug: "juspay" },
  { name: "Meesho", ats: "custom_scraper", slug: "meesho" },
  { name: "Zerodha", ats: "custom_scraper", slug: "zerodha" },
  { name: "Ola", ats: "custom_scraper", slug: "ola" },
  { name: "Unacademy", ats: "custom_scraper", slug: "unacademy" },
  { name: "Sarvam AI", ats: "custom_scraper", slug: "sarvam" },
  { name: "Krutrim", ats: "custom_scraper", slug: "krutrim" },
  { name: "Ola Krutrim", ats: "custom_scraper", slug: "ola_krutrim" },

  // === Pending — moved off public ATS or need investigation ===
  // Notion, Atlassian, Snowflake, HashiCorp, DoorDash, Plaid, Rippling, Confluent,
  // Shopify, 1Password, Canva, Miro, Zapier, CrowdStrike, Sentry, Supabase,
  // Hugging Face, Docker, Cohere, Mistral, Weights & Biases, ElevenLabs, Harvey,
  // Writer, UiPath, Nutanix, Wise, Harness, Coda, Elastic, Mixpanel, BrowserStack,
  // Groww, Freshworks, Zepto, Dream11, MPL, Razorpay
  // → most likely on Workday (build workday adapter) or own portal (custom_scraper)
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
