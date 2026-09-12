import type { PersonOnFloorCandidateEvent } from "@/contracts";
import { createIncident, updateIncident, getIncident, logActivity, getBudget } from "@/domain";
import { sendIncidentAlert } from "@/integrations/telegram";

export async function handleFloorCandidate(
  event: PersonOnFloorCandidateEvent
): Promise<{ incidentId: string; question: string }> {
  const incident = await createIncident(event.elderId, event.confidence, event.note);
  await logActivity(event.elderId, "incident_detected", "Noticed something and is checking in.", incident.id);

  const question = "Marie? I noticed you're on the floor. Are you okay?";

  await updateIncident(incident.id, { status: "CHECKING" });
  await logActivity(event.elderId, "incident_checking", "Waiting to hear back.", incident.id);

  try {
    const { escalateIfSilentTask } = await import("../../trigger/escalate-if-silent");
    await escalateIfSilentTask.trigger({ incidentId: incident.id }, { delay: "20s" });
  } catch (err) {
    console.warn("Trigger.dev not configured; skipping escalateIfSilent enqueue", err);
  }

  return { incidentId: incident.id, question };
}

export async function recordCheckInResponse(
  incidentId: string,
  response: string | null
): Promise<void> {
  const incident = await getIncident(incidentId);
  if (!incident) return;
  if (incident.status !== "CHECKING") return;

  if (response && response.trim().length > 0) {
    await updateIncident(incidentId, { status: "RESOLVED_OK", elderResponse: response });
    await logActivity(incident.elderId, "incident_resolved_ok", "Responded and is okay.", incidentId);
    return;
  }

  const updated = await updateIncident(incidentId, { status: "ESCALATED" });
  await logActivity(incident.elderId, "incident_escalated", "No response — alerting family.", incidentId);

  try {
    const budget = await getBudget(incident.elderId);
    await sendIncidentAlert(updated, budget.approverChatId);
  } catch (err) {
    console.warn("Failed to send Telegram incident alert", err);
  }
}
