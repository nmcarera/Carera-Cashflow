"use server";

/**
 * Server action for the manual "resolve pending currency conversions" step
 * (Phase 4). Deliberately not automatic — see src/lib/currency/convert.ts's
 * header comment for why this can't happen inside the synchronous import
 * transaction, and README "How currency conversion works" for why it's
 * manual rather than a background job in a local-first, no-always-on-server
 * app.
 */
import { revalidatePath } from "next/cache";
import { resolvePendingConversions, type ResolvePendingSummary } from "@/lib/currency/convert";
import { CareraError } from "@/lib/logging/errors";
import { logError } from "@/lib/logging/logger";

export interface ResolveOutcome {
  ok: boolean;
  data?: ResolvePendingSummary;
  errorMessage?: string;
}

export async function resolvePendingConversionsAction(): Promise<ResolveOutcome> {
  try {
    const data = await resolvePendingConversions();
    revalidatePath("/transactions");
    revalidatePath("/review");
    revalidatePath("/import/history");
    revalidatePath("/");
    return { ok: true, data };
  } catch (err) {
    const careraErr =
      err instanceof CareraError
        ? err
        : new CareraError({ code: "FX_001_PROVIDER_UNAVAILABLE", category: "exchange_rate_service", cause: err });
    logError(careraErr, { operation: "currency.resolvePending" });
    return { ok: false, errorMessage: careraErr.toUserMessage() };
  }
}
