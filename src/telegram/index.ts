import type { JobAlert } from "../types.ts";
import { formatJobMessages, formatSourceBroken } from "./formatter.ts";
import { sendTelegramMessage } from "./bot.ts";

export async function sendJobAlert(alert: JobAlert): Promise<void> {
  const msgs = formatJobMessages(alert);

  const headerResult = await sendTelegramMessage(msgs.header, {
    parseMode: "MarkdownV2",
  });

  for (const text of msgs.followUps) {
    if (!text) continue;
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
