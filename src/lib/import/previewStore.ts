/**
 * In-memory store for pending import previews.
 *
 * A local-first, single-user app doesn't need a distributed session store:
 * previewing a file and confirming it happen in the same running server
 * process, seconds to minutes apart. Nothing is written to the database
 * until `commitImport` runs (see importPipeline.ts) — a preview that's
 * never confirmed simply expires and leaves no trace. If the dev server
 * restarts between preview and confirm, the preview is lost and the user
 * re-uploads; no data was ever at risk since nothing had been saved.
 */
import type { ImportPreview } from "./importPipeline";

const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredPreview {
  preview: ImportPreview;
  fileBuffer: Buffer;
  expiresAt: number;
}

const store = new Map<string, StoredPreview>();

function sweep() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

export function savePreview(id: string, preview: ImportPreview, fileBuffer: Buffer) {
  sweep();
  store.set(id, { preview, fileBuffer, expiresAt: Date.now() + TTL_MS });
}

export function getPreview(id: string): StoredPreview | undefined {
  sweep();
  return store.get(id);
}

export function deletePreview(id: string) {
  store.delete(id);
}
