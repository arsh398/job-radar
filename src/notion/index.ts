// High-level Notion service: per JobAlert, deduplicate against the DB,
// upload the 1-2 tailored PDFs, then create a page with all structured
// properties. Fails gracefully — Notion errors don't block the pipeline.

import type { JobAlert } from "../types.ts";
import { createPage, queryByKey, uploadFile } from "./client.ts";
import { buildChildren, buildProperties } from "./schema.ts";

function databaseId(): string | null {
  const id = process.env["NOTION_DATABASE_ID"];
  if (!id) return null;
  return id.replace(/-/g, "");
}

export async function sendAlertToNotion(alert: JobAlert): Promise<void> {
  const dbId = databaseId();
  if (!dbId) return; // Notion not configured — skip silently.

  try {
    const existing = await queryByKey(dbId, alert.job.key);
    if (existing) {
      console.log(
        `[notion] skip ${alert.job.company} — ${alert.job.title} (already in DB)`
      );
      return;
    }

    // Upload the tailored PDFs (if any) in order and keep their IDs.
    const uploads: Array<{ uploadId: string; attachment: JobAlert["pdfs"][number] }> = [];
    for (const pdf of alert.pdfs) {
      try {
        const uploadId = await uploadFile(pdf.buffer, pdf.filename);
        uploads.push({ uploadId, attachment: pdf });
      } catch (err) {
        console.warn(
          `[notion] file upload failed for ${pdf.filename}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const properties = buildProperties(alert, uploads);
    const children = buildChildren(alert);

    const res = await createPage({
      parent: { database_id: dbId },
      properties,
      children,
    });
    console.log(
      `[notion] created ${alert.job.company} — ${alert.job.title} (${res.id.slice(0, 8)})`
    );
  } catch (err) {
    console.error(
      `[notion] failed for ${alert.job.company}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
