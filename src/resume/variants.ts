// Resume variants — produce N PDFs per job, each with a different caption
// and a targeted text transform. Mohammed's use case: one variant for cold
// apply (primary email), another for referral apply (a different email so
// we can distinguish which channel a callback came through).
//
// Variant selection is free-form — any string-level transform is valid.
// The most common is an email swap; add more as needed (phone number for
// a spam-catching second number, different LinkedIn for A/B, etc).

export type ResumeVariant = {
  label: string; // internal name, appears in filenames
  caption: string; // Telegram caption prefix
  transform: (md: string) => string;
};

const PRIMARY_EMAIL =
  process.env["RESUME_PRIMARY_EMAIL"] ?? "mdarshkhan9898@gmail.com";
const REFERRAL_EMAIL =
  process.env["RESUME_REFERRAL_EMAIL"] ?? "mohammedarshkhan686@gmail.com";

export function buildVariants(): ResumeVariant[] {
  const out: ResumeVariant[] = [
    {
      label: "cold",
      caption: "📩 Cold apply",
      transform: (md) => md,
    },
  ];
  if (REFERRAL_EMAIL && REFERRAL_EMAIL !== PRIMARY_EMAIL) {
    out.push({
      label: "referral",
      caption: "🤝 With referral",
      transform: (md) => md.split(PRIMARY_EMAIL).join(REFERRAL_EMAIL),
    });
  }
  return out;
}
