import type { JobAlert } from "../types.ts";
import { formatAlert, formatSourceBroken } from "./formatter.ts";
import { sendTelegramMessage } from "./bot.ts";

export async function sendJobAlert(alert: JobAlert): Promise<void> {
  const text = formatAlert(alert);
  await sendTelegramMessage(text);
}

export async function sendBrokenSourcesAlert(
  sources: string[]
): Promise<void> {
  if (!sources.length) return;
  const text = formatSourceBroken(sources);
  await sendTelegramMessage(text);
}

export { formatAlert } from "./formatter.ts";
