"use client";

import { CopilotKit, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { useRealtimeTable } from "@/lib/supabase-browser";
import type { Approval, Activity, Incident, Payment } from "@/contracts";
import { ApprovalCard } from "./ApprovalCard";
import { ActivityFeed } from "./ActivityFeed";
import { AlertsColumn } from "./AlertsColumn";

function DashboardContent() {
  const { rows: approvals } = useRealtimeTable<Approval>("approvals", { limit: 50 });
  const { rows: activity } = useRealtimeTable<Activity>("activity", { limit: 30 });
  const { rows: incidents } = useRealtimeTable<Incident>("incidents", { limit: 50 });
  const { rows: payments } = useRealtimeTable<Payment>("payments", { limit: 50 });

  useCopilotReadable({
    description: "Current pending and recent approvals for Marie's spending",
    value: approvals,
  });
  useCopilotReadable({
    description: "Recent payments made on Marie's behalf",
    value: payments,
  });
  useCopilotReadable({
    description: "The last 30 activity entries for Marie (what the companion did)",
    value: activity,
  });

  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");
  const otherApprovals = approvals.filter((a) => a.status !== "PENDING").slice(0, 10);
  const openAlerts = incidents.filter((i) => i.status !== "RESOLVED_OK" && i.status !== "ACKNOWLEDGED");
  const otherAlerts = incidents
    .filter((i) => i.status === "RESOLVED_OK" || i.status === "ACKNOWLEDGED")
    .slice(0, 10);

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 bg-zinc-50 p-6 md:grid-cols-3">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Pending approvals</h2>
        <div className="flex flex-col gap-3">
          {pendingApprovals.length === 0 && otherApprovals.length === 0 && (
            <p className="text-sm text-zinc-400">Nothing pending.</p>
          )}
          {pendingApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
          {otherApprovals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Activity feed</h2>
        <ActivityFeed rows={activity} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Alerts</h2>
        <AlertsColumn incidents={[...openAlerts, ...otherAlerts]} />
      </section>
    </div>
  );
}

export function FamilyDashboard() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <CopilotSidebar
        labels={{
          title: "Ask about Marie",
          initial: "What did Mom order this week?",
        }}
      >
        <DashboardContent />
      </CopilotSidebar>
    </CopilotKit>
  );
}
