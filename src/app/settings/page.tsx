import {
  listCategories,
  listPriorities,
  listHouseholdMembers,
  categoryUsageCounts,
  priorityUsageCounts,
  householdMemberUsageCounts,
} from "@/lib/db/queries";
import { SettingsPanels } from "@/components/settings/SettingsPanels";

export const metadata = { title: "Settings — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const categories = listCategories();
  const priorities = listPriorities();
  const members = listHouseholdMembers();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Settings</h1>
      <p className="text-muted mb-8 max-w-2xl">
        Manage the categories, priorities, and household members used throughout the app. Nothing is
        ever permanently deleted here — archiving keeps every past transaction&apos;s history intact.
      </p>
      <SettingsPanels
        categories={categories}
        priorities={priorities}
        members={members}
        categoryUsage={Object.fromEntries(categoryUsageCounts())}
        priorityUsage={Object.fromEntries(priorityUsageCounts())}
        memberUsage={Object.fromEntries(householdMemberUsageCounts())}
      />
    </div>
  );
}
