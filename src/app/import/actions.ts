"use server";

/**
 * Server actions for the import workflow. This is the only place in the UI
 * layer that touches the import pipeline — pages/components call these,
 * never src/lib/import/importPipeline.ts directly, so the trust boundary
 * (file bytes in, validated preview/commit results out) stays in one spot.
 */
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import {
  previewImport,
  commitImport,
  undoImportBatch,
  type ImportPreview,
  type AccountResolutionChoice,
  type CommitResult,
} from "@/lib/import/importPipeline";
import { savePreview, getPreview, deletePreview } from "@/lib/import/previewStore";
import { ADAPTERS } from "@/lib/import/adapters/registry";
import { CareraError } from "@/lib/logging/errors";
import { logError } from "@/lib/logging/logger";

export interface AdapterOption {
  id: string;
  label: string;
}

export async function listAdapterOptions(): Promise<AdapterOption[]> {
  return ADAPTERS.map((a) => ({ id: a.id, label: a.label }));
}

export interface PreviewOutcome {
  fileName: string;
  ok: boolean;
  preview?: ImportPreview;
  errorMessage?: string;
}

export async function previewFilesAction(formData: FormData): Promise<PreviewOutcome[]> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const outcomes: PreviewOutcome[] = [];

  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const preview = await previewImport(file.name, buffer);
      savePreview(preview.previewId, preview, buffer);
      outcomes.push({ fileName: file.name, ok: true, preview });
    } catch (err) {
      const careraErr =
        err instanceof CareraError
          ? err
          : new CareraError({
              code: "CSV_001_UNREADABLE",
              category: "csv_parsing",
              context: { fileName: file.name },
              cause: err,
            });
      logError(careraErr, { operation: "import.preview" });
      outcomes.push({ fileName: file.name, ok: false, errorMessage: careraErr.toUserMessage() });
    }
  }

  return outcomes;
}

/** Re-parses a previously uploaded file with a manually chosen institution,
 *  used when auto-detection didn't recognize the format (build brief §2:
 *  "a manual column-mapping workflow can be used when a format is not
 *  recognized" — here scoped to manual institution selection, which covers
 *  the common case of a bank changing its export slightly). */
export async function reselectAdapterAction(
  previewId: string,
  adapterId: string
): Promise<PreviewOutcome> {
  const stored = getPreview(previewId);
  if (!stored) {
    return { fileName: "", ok: false, errorMessage: "This preview has expired. Please re-upload the file." };
  }
  deletePreview(previewId);
  try {
    const preview = await previewImport(stored.preview.fileName, stored.fileBuffer, adapterId);
    savePreview(preview.previewId, preview, stored.fileBuffer);
    return { fileName: preview.fileName, ok: true, preview };
  } catch (err) {
    const careraErr =
      err instanceof CareraError
        ? err
        : new CareraError({ code: "CSV_001_UNREADABLE", category: "csv_parsing", cause: err });
    logError(careraErr, { operation: "import.preview.reselect" });
    return { fileName: stored.preview.fileName, ok: false, errorMessage: careraErr.toUserMessage() };
  }
}

export interface ConfirmImportInput {
  previewId: string;
  accountResolutions: Record<string, AccountResolutionChoice>;
}

export interface ConfirmOutcome {
  ok: boolean;
  result?: CommitResult;
  errorMessage?: string;
}

export async function confirmImportAction(input: ConfirmImportInput): Promise<ConfirmOutcome> {
  const stored = getPreview(input.previewId);
  if (!stored) {
    return { ok: false, errorMessage: "This preview has expired. Please re-upload the file and try again." };
  }
  try {
    const result = commitImport(stored.preview, input.accountResolutions);
    deletePreview(input.previewId);
    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/import/history");
    revalidatePath("/review");
    return { ok: true, result };
  } catch (err) {
    const careraErr =
      err instanceof CareraError
        ? err
        : new CareraError({
            code: "DB_001_WRITE_FAILED",
            category: "database",
            cause: err,
            whatWasSaved: "Nothing — the import was rolled back.",
          });
    logError(careraErr, { operation: "import.commit" });
    return { ok: false, errorMessage: careraErr.toUserMessage() };
  }
}

export async function undoImportAction(batchId: string): Promise<{ undone: boolean; reason?: string }> {
  const result = undoImportBatch(batchId);
  if (result.undone) {
    revalidatePath("/");
    revalidatePath("/transactions");
    revalidatePath("/import/history");
    revalidatePath("/review");
  }
  return result;
}

// Re-exported so client components can generate a stable key without a
// server round-trip.
export async function newClientId(): Promise<string> {
  return randomUUID();
}
