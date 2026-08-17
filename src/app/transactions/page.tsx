import {
  listHydratedTransactions,
  listActiveCategories,
  listActivePriorities,
  listActiveHouseholdMembers,
} from "@/lib/db/queries";
import { TransactionTable } from "@/components/TransactionTable";

export const metadata = { title: "Transactions — Carera's Cash Flow" };
// See src/app/page.tsx for why this is force-dynamic rather than static.
export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const transactions = listHydratedTransactions();
  const categories = listActiveCategories();
  const priorities = listActivePriorities();
  const householdMembers = listActiveHouseholdMembers();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Transactions</h1>
      <p className="text-muted mb-6">
        Every transaction across all accounts. Search, review, and traceability come from here —
        every number on the dashboard can be traced back to rows in this table. Change a category,
        priority, or owner directly in the table below.
      </p>
      <TransactionTable
        transactions={transactions}
        categories={categories}
        priorities={priorities}
        householdMembers={householdMembers}
      />
    </div>
  );
}
