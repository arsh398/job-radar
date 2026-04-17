// Resume variants — produce N PDFs per job, each with a different contact
// detail so Mohammed can tell apart which channel a recruiter came back
// through. Kept intentionally generic — filenames and captions do not
// expose internal routing ("cold", "referral") to anyone downstream.
//
// Variant transforms are free-form string edits; the default ships an
// email-swap variant but phone/LinkedIn/etc. are trivially added.

export type ResumeVariant = {
  // `suffix` is appended to the PDF filename for the non-primary variants;
  // the primary variant has no suffix so its filename is the cleanest.
  suffix: string;
  // Caption shown in the Telegram message attached to the PDF.
  caption: string;
  transform: (md: string) => string;
};

const PRIMARY_EMAIL =
  process.env["RESUME_PRIMARY_EMAIL"] ?? "mdarshkhan9898@gmail.com";
const ALT_EMAIL =
  process.env["RESUME_REFERRAL_EMAIL"] ?? "mohammedarshkhan686@gmail.com";

export function buildVariants(): ResumeVariant[] {
  const out: ResumeVariant[] = [
    {
      suffix: "",
      caption: `📄 ${PRIMARY_EMAIL}`,
      transform: (md) => md,
    },
  ];
  if (ALT_EMAIL && ALT_EMAIL !== PRIMARY_EMAIL) {
    out.push({
      suffix: "v2",
      caption: `📄 ${ALT_EMAIL}`,
      transform: (md) => md.split(PRIMARY_EMAIL).join(ALT_EMAIL),
    });
  }
  return out;
}
