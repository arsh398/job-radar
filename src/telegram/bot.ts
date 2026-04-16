const TELEGRAM_MAX_LEN = 4000;

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

export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing");
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}
