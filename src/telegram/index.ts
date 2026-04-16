import type { FilteredJob, JobAlert, AtsMatch, FitScore } from "../types.ts";
import {
  formatEarlyHeader,
  formatEnrichment,
  formatPdfCaption,
  formatSourceBroken,
} from "./formatter.ts";
import { sendTelegramDocument, sendTelegramMessage } from "./bot.ts";

// Two-stage flow:
// 1) sendEarlyPing — sent immediately when a new job passes filters, BEFORE
//    the LLM runs. Carries the URL and the deterministic ATS match score.
//    Goal: zero-to-click in under 10 seconds, even when LLM is slow.
// 2) sendEnrichedFollowUp — sent after LLM + PDF. Threads as replies under
//    the early ping's message ID so the chat stays organized.
export async function sendEarlyPing(
  job: FilteredJob,
  atsMatch: AtsMatch,
  fit?: FitScore
): Promise<{ messageId: number }> {
  const text = formatEarlyHeader(job, atsMatch, fit);
  return sendTelegramMessage(text, { parseMode: "MarkdownV2" });
}

export async function sendEnrichedFollowUp(
  alert: JobAlert,
  parentMessageId: number | undefined
): Promise<void> {
  const messages = formatEnrichment(alert);
  for (const text of messages) {
    if (!text) continue;
    await sendTelegramMessage(text, {
      parseMode: "MarkdownV2",
      replyToMessageId: parentMessageId,
      disableNotification: true,
    });
  }

  if (alert.pdf) {
    const planData = alert.llm.ok ? alert.llm.data : null;
    await sendTelegramDocument(alert.pdf.buffer, {
      filename: alert.pdf.filename,
      caption: formatPdfCaption(alert.job, planData),
      replyToMessageId: parentMessageId,
      disableNotification: true,
    });
  }
}

export async function sendBrokenSourcesAlert(sources: string[]): Promise<void> {
  if (!sources.length) return;
  const text = formatSourceBroken(sources);
  await sendTelegramMessage(text, { parseMode: "MarkdownV2" });
}
