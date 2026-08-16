/**
 * Central definition of "does this transaction need review, and why."
 *
 * Used everywhere a transaction's category/owner/transfer/conversion state
 * changes — import, rule application, manual edits, transfer confirmation —
 * so the review queue's reasons never drift out of sync with reality
 * because one code path forgot to recompute them.
 */
import type { ReviewReason, ReviewStatus } from "../domain/enums";

export interface ReviewInput {
  hasCategory: boolean;
  hasOwner: boolean;
  transferStatus: string;
  conversionStatus: string;
  hasRuleConflict?: boolean;
}

export function computeReviewStatus(input: ReviewInput): {
  reviewStatus: ReviewStatus;
  reviewReasons: ReviewReason[];
} {
  const reasons: ReviewReason[] = [];
  if (input.hasRuleConflict) reasons.push("conflicting_rules");
  if (!input.hasCategory) reasons.push("no_category");
  if (!input.hasOwner) reasons.push("no_owner");
  if (input.transferStatus === "suggested") reasons.push("possible_transfer");
  if (input.conversionStatus === "pending") reasons.push("missing_conversion");

  return {
    reviewStatus: reasons.length > 0 ? "needs_review" : "ok",
    reviewReasons: reasons,
  };
}
