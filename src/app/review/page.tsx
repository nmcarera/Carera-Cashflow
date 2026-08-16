import {
  listReviewQueue,
  listActiveCategories,
  listActivePriorities,
  listActiveHouseholdMembers,
} from "@/lib/db/queries";
import { TransactionTable } from "@/components/TransactionTable";
import { ResolvePendingConversionsButton } from "@/components/currency/ResolvePendingConversionsButton";

export const metadata = { title: "Review — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const items = listReviewQueue();
  const categories = listActiveCategories();
  const priorities = listActivePriorities();
  const householdMembers = listActiveHouseholdMembers();
  const pendingConversions = items.filter((t) => t.reviewReasons.includes("missing_conversion")).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Review queue</h1>
      <p className="text-muted mb-6 max-w-2xl">
        {items.length === 0
          ? "Nothing needs review right now."
          : `${items.length} transaction${items.length === 1 ? "" : "s"} need${
              items.length === 1 ? "s" : ""
            } a category, an owner, or a decision about a possible match. Nothing here is a confirmed
            fact — these are the app's best current guesses. Set a category, priority, or owner
            directly below, or confirm/reject a suggested transfer.`}
      </p>
      {pendingConversions > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-surface px-3 py-3">
          <p className="text-sm text-muted mb-2">
            {pendingConversions} of these are waiting on a currency conversion (checks the local rate
            cache first, then fetches whatever&apos;s missing).
          </p>
          <ResolvePendingConversionsButton />
        </div>
      )}
      <TransactionTable
        transactions={items}
        categories={categories}
        priorities={priorities}
        householdMembers={householdMembers}
      />
    </div>
  );
}
