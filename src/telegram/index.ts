import type { JobAlert } from "../types.ts";
import { formatJobMessages, formatSourceBroken } from "./formatter.ts";
import { sendTelegramMessage } from "./bot.ts";

export async function sendJobAlert(alert: JobAlert): Promise<void> {
  const msgs = formatJobMessages(alert);
  if (!msgs) return;

  // Send the header first (always present). Subsequent sections reply to it
  // so they group as a thread in Telegram.
  const headerResult = await sendTelegramMessage(msgs.header, {
    parseMode: "MarkdownV2",
  });

  const followUps = [
    msgs.resumeEdits,
    msgs.referral,
    msgs.coverNote,
  ].filter((s) => s && s.length > 0);

  for (const text of followUps) {
    await sendTelegramMessage(text, {
      parseMode: "MarkdownV2",
      replyToMessageId: headerResult.messageId,
      disableNotification: true,
    });
  }
}

export async function sendBrokenSourcesAlert(
  sources: string[]
): Promise<void> {
  if (!sources.length) return;
  const text = formatSourceBroken(sources);
  await sendTelegramMessage(text, { parseMode: "MarkdownV2" });
}

export { formatJobMessages } from "./formatter.ts";
