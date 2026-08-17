import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getImportBatch,
  listImportRowIssues,
  listImportedTransactionsForBatch,
} from "@/lib/db/queries";
import { formatDate, formatEur } from "@/lib/format";
import { UndoImportButton } from "@/components/import/UndoImportButton";

export const dynamic = "force-dynamic";

export default async function ImportBatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batch = getImportBatch(id);
  if (!batch) notFound();

  const issues = listImportRowIssues(id);
  const importedTransactions = listImportedTransactionsForBatch(id);

  return (
    <div>
      <Link href="/import/history" className="text-sm text-muted underline">
        ← Import history
      </Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">{batch.fileName}</h1>
        {batch.status === "committed" && <UndoImportButton batchId={batch.id} fileName={batch.fileName} />}
      </div>
      <p className="text-muted mb-6">
        Imported {formatDate(batch.importedAt.slice(0, 10))} · {batch.institution.replace(/_/g, " ")}
        {batch.status === "undone" && " · this import has been undone"}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          ["Rows inspected", batch.rowsInspected],
          ["Imported", batch.rowsImported],
          ["Duplicates skipped", batch.rowsDuplicate],
          ["Need attention", batch.rowsWarning + batch.rowsError],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
            <p className="text-xl font-semibold mt-1">{value}</p>
          </div>
        ))}
      </div>

      {issues.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
            Skipped or flagged rows ({issues.length})
          </h2>
          <div className="rounded-xl border border-border bg-surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Explanation</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-muted">{issue.sourceRowNumber}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{issue.issueType.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">
          Transactions imported by this batch ({importedTransactions.length})
        </h2>
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium text-right">EUR</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {importedTransactions.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDate(t.transactionDate)}</td>
                  <td className="px-3 py-2">{t.cleanedDescription}</td>
                  <td className="px-3 py-2 text-right">{formatEur(t.eurAmount)}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {t.reviewStatus === "needs_review" ? "Needs review" : "OK"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
