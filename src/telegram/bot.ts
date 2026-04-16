const TELEGRAM_MAX_LEN = 4000;
const TELEGRAM_CAPTION_MAX_LEN = 1024;

function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LEN) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MAX_LEN) {
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MAX_LEN);
    if (cut < TELEGRAM_MAX_LEN / 2) cut = TELEGRAM_MAX_LEN;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

type SendOptions = {
  parseMode?: "MarkdownV2" | "HTML";
  replyToMessageId?: number;
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
};

export type SendResult = { messageId: number };

export async function sendTelegramMessage(
  text: string,
  opts: SendOptions = {}
): Promise<SendResult> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing");
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = chunkMessage(text);
  let lastMessageId = 0;
  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: opts.disableWebPagePreview ?? true,
    };
    if (opts.parseMode) body["parse_mode"] = opts.parseMode;
    if (opts.replyToMessageId) body["reply_to_message_id"] = opts.replyToMessageId;
    if (opts.disableNotification) body["disable_notification"] = true;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respBody = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status}: ${respBody.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      result?: { message_id?: number };
    };
    if (json.result?.message_id) lastMessageId = json.result.message_id;
  }
  return { messageId: lastMessageId };
}

type DocumentOptions = {
  filename: string;
  caption?: string;
  parseMode?: "MarkdownV2" | "HTML";
  replyToMessageId?: number;
  disableNotification?: boolean;
};

export async function sendTelegramDocument(
  buffer: Uint8Array,
  opts: DocumentOptions
): Promise<SendResult> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing");
  }
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", chatId);
  // Copy the Uint8Array bytes into a fresh ArrayBuffer — Blob's constructor
  // accepts ArrayBuffer but not SharedArrayBuffer, and the underlying buffer
  // of a Node Uint8Array is typed as ArrayBufferLike.
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  form.append(
    "document",
    new Blob([ab], { type: "application/pdf" }),
    opts.filename
  );
  if (opts.caption) {
    form.append("caption", opts.caption.slice(0, TELEGRAM_CAPTION_MAX_LEN));
  }
  if (opts.parseMode) form.append("parse_mode", opts.parseMode);
  if (opts.replyToMessageId) {
    form.append("reply_to_message_id", String(opts.replyToMessageId));
  }
  if (opts.disableNotification) form.append("disable_notification", "true");

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const respBody = await res.text().catch(() => "");
    throw new Error(`Telegram sendDocument ${res.status}: ${respBody.slice(0, 300)}`);
  }
  const json = (await res.json()) as { result?: { message_id?: number } };
  return { messageId: json.result?.message_id ?? 0 };
}
