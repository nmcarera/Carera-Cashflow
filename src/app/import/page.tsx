import Link from "next/link";
import { listAccounts } from "@/lib/db/queries";
import { listAdapterOptions } from "./actions";
import { ImportWorkflow } from "@/components/import/ImportWorkflow";

export const metadata = { title: "Import — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const accounts = listAccounts().map((a) => ({
    id: a.id,
    displayName: a.displayName,
    institution: a.institution,
  }));
  const adapterOptions = await listAdapterOptions();

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import statements</h1>
        <Link href="/import/history" className="text-sm text-muted underline">
          Import history
        </Link>
      </div>
      <p className="text-muted mb-6 max-w-2xl">
        Upload one or more CSV or Excel exports from ABN AMRO, EU American Express, or Chase.
        Nothing is imported until you review the preview and confirm — you&apos;ll see exactly what
        would be added, what looks like a duplicate, and what needs attention first.
      </p>
      <ImportWorkflow accounts={accounts} adapterOptions={adapterOptions} />
    </div>
  );
}
