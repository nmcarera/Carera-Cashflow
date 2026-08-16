import { countByReviewStatus, listActiveHouseholdMembers } from "@/lib/db/queries";
import { listAnalyticsRows } from "@/lib/analytics/queries";
import { listSavingsGoalProgress } from "@/lib/analytics/savingsGoals";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

// This page reads live database state on every request rather than being
// statically prerendered at build time — a local-first finance app must
// never show a stale snapshot from whenever `next build` happened to run.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const needsReview = countByReviewStatus();
  const rows = listAnalyticsRows();
  const goals = listSavingsGoalProgress();
  const members = listActiveHouseholdMembers().map((m) => ({ id: m.id, name: m.name }));

  return <DashboardClient rows={rows} goals={goals} members={members} needsReview={needsReview} />;
}
