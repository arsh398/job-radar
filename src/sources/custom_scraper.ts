// TODO: Indian custom portal scrapers (one function per company):
//   - Flipkart, Myntra (careers.flipkart.com, careers.myntra.com)
//   - Swiggy (careers.swiggy.com)
//   - Zomato (zomato.com/careers)
//   - Paytm (jobs.paytm.com)
//   - PhonePe (phonepe.com/careers)
//   - CRED (careers.cred.club)
//   - Juspay (juspay.in/careers)
//   - Meesho (careers.meesho.com)
//   - Zerodha (zerodha.com/careers)
//   - Ola (ola.careers)
//   - Unacademy (unacademy.com/careers)
//   - Sarvam AI (sarvam.ai/careers)
//   - Krutrim, Ola Krutrim
//
// Each portal has its own HTML structure and anti-bot profile. Some have
// embedded JSON in <script> tags we can extract; others need Playwright-lite.
// Start with Juspay (small, simple) as the first pattern reference.
import type { SourceAdapter } from "../types.ts";

export const customScraperAdapter: SourceAdapter = {
  name: "custom_scraper",
  fetch: async () => [],
};
