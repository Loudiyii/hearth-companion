import { task } from "@trigger.dev/sdk/v3";
import { getIncident } from "@/domain";
import { recordCheckInResponse } from "@/server/escalation";

export const escalateIfSilentTask = task({
  id: "escalate-if-silent",
  run: async (payload: { incidentId: string }) => {
    const incident = await getIncident(payload.incidentId);
    if (!incident || incident.status !== "CHECKING") return;

    await recordCheckInResponse(payload.incidentId, null);
  },
});
