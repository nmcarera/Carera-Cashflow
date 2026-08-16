"use server";

/**
 * Server actions for the /diagnostics page's restore-upload flow.
 *
 * This deliberately does NOT swap the live database — see the header
 * comment in scripts/restore.ts for why a long-lived server process can't
 * safely do that to its own open connection mid-request. All this does is
 * accept an uploaded file, validate it's a recognizable, non-corrupt
 * Carera Cash Flow backup, and stage it under data/pending-restore/ so the
 * household can finish the restore with the app stopped
 * (`npm run db:restore -- <staged path>`). Nothing here touches
 * data/carera-cashflow.db itself.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateSqliteBackupFile } from "@/lib/diagnostics/restoreValidation";
import type { StagedBackup } from "@/lib/diagnostics/queries";
import { CareraError } from "@/lib/logging/errors";
import { logError, logInfo } from "@/lib/logging/logger";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB — generous for a two-person household's SQLite file.

function stagingDir(): string {
  return path.join(process.cwd(), "data", "pending-restore");
}

export interface UploadRestoreResult {
  ok: boolean;
  data?: StagedBackup;
  errorMessage?: string;
}

export async function uploadRestoreCandidateAction(formData: FormData): Promise<UploadRestoreResult> {
  const file = formData.get("backupFile");
  if (!(file instanceof File)) {
    return { ok: false, errorMessage: "No file was uploaded." };
  }
  if (file.size === 0) {
    return { ok: false, errorMessage: "The uploaded file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      errorMessage: `This file is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit for a household database backup.`,
    };
  }

  const dir = stagingDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "backup.db";
  const stagedPath = path.join(dir, `${randomUUID()}-${safeName}`);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    fs.writeFileSync(stagedPath, bytes);

    const validation = validateSqliteBackupFile(stagedPath);
    if (!validation.ok) {
      fs.rmSync(stagedPath, { force: true });
      return { ok: false, errorMessage: validation.reason };
    }

    logInfo("diagnostics.restore.stage", "Restore candidate validated and staged.", {});
    return { ok: true, data: { stagedPath, fileName: safeName, sizeBytes: file.size } };
  } catch (err) {
    fs.rmSync(stagedPath, { force: true });
    const careraErr = new CareraError({ code: "FILE_001_NOT_FOUND", category: "file_access", cause: err });
    logError(careraErr, { operation: "diagnostics.restore.stage" });
    return { ok: false, errorMessage: "Could not read or save the uploaded file." };
  }
}

export interface ClearStagingResult {
  ok: boolean;
  removedCount?: number;
  errorMessage?: string;
}

export async function clearRestoreStagingAction(): Promise<ClearStagingResult> {
  try {
    const dir = stagingDir();
    if (!fs.existsSync(dir)) return { ok: true, removedCount: 0 };
    const files = fs.readdirSync(dir);
    for (const f of files) fs.rmSync(path.join(dir, f), { force: true });
    return { ok: true, removedCount: files.length };
  } catch (err) {
    const careraErr = new CareraError({ code: "FILE_001_NOT_FOUND", category: "file_access", cause: err });
    logError(careraErr, { operation: "diagnostics.restore.clear" });
    return { ok: false, errorMessage: "Could not clear staged restore files." };
  }
}

