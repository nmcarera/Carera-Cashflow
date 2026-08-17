import Link from "next/link";
import { listImportBatches } from "@/lib/db/queries";
import { formatDate } from "@/lib/format";
import { UndoImportButton } from "@/components/import/UndoImportButton";
import { ResolvePendingConversionsButton } from "@/components/currency/ResolvePendingConversionsButton";

export const metadata = { title: "Import history — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

export default async function ImportHistoryPage() {
  const batches = listImportBatches();
  const anyPending = batches.some((b) => b.exchangeRateStatus === "pending");

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import history</h1>
        <Link href="/import" className="text-sm text-muted underline">
          New import
        </Link>
      </div>
      <p className="text-muted mb-6">
        Every confirmed import, in one place. Undoing an import removes only the transactions it
        added — nothing from any other import, and none of your categorization rules.
      </p>
      {anyPending && (
        <div className="mb-6">
          <ResolvePendingConversionsButton />
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
              <th className="px-3 py-2 font-medium">Imported</th>
              <th className="px-3 py-2 font-medium">File</th>
              <th className="px-3 py-2 font-medium">Institution / account</th>
              <th className="px-3 py-2 font-medium text-right">Rows</th>
              <th className="px-3 py-2 font-medium text-right">Imported</th>
              <th className="px-3 py-2 font-medium text-right">Duplicates</th>
              <th className="px-3 py-2 font-medium text-right">Attention</th>
              <th className="px-3 py-2 font-medium">FX status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDate(b.importedAt.slice(0, 10))}</td>
                <td className="px-3 py-2">
                  <Link href={`/import/history/${b.id}`} className="underline">
                    {b.fileName}
                  </Link>
                  {b.status === "undone" && (
                    <span className="ml-2 text-xs text-muted-2">(undone)</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">
                  {b.institution.replace(/_/g, " ")}
                  {b.accountName ? ` · ${b.accountName}` : ""}
                </td>
                <td className="px-3 py-2 text-right">{b.rowsInspected}</td>
                <td className="px-3 py-2 text-right">{b.rowsImported}</td>
                <td className="px-3 py-2 text-right">{b.rowsDuplicate}</td>
                <td className="px-3 py-2 text-right">
                  {b.rowsWarning + b.rowsError > 0 ? b.rowsWarning + b.rowsError : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">
                  {b.exchangeRateStatus === "pending" ? "Pending" : b.exchangeRateStatus === "ok" ? "OK" : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {b.status === "committed" && <UndoImportButton batchId={b.id} fileName={b.fileName} />}
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted">
                  No imports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
