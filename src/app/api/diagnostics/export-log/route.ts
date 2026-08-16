import { buildSanitizedExportJson } from "@/lib/diagnostics/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const body = buildSanitizedExportJson(500);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="carera-cashflow-diagnostics-${stamp}.json"`,
    },
  });
}
