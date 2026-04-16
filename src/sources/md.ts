import TurndownService from "turndown";

const service = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  try {
    return service.turndown(html).trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
