/**
 * Health check for the hosting platform (Railway's `deploy.healthcheckPath`
 * in railway.json) — deliberately excluded from the auth proxy (see
 * proxy.ts's matcher) since the platform's health prober never has a
 * session cookie, and a redirect-to-/login would read as "unhealthy."
 * Touches the database so a broken DB connection also fails the check,
 * not just "the Node process is still running."
 */
import { sqlite } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    sqlite.prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
