import type { PersonOnFloorCandidateEvent } from "@/contracts";
import { createIncident, updateIncident, getIncident, logActivity, getBudget } from "@/domain";
import { sendIncidentAlert, sendHeadsUp } from "@/integrations/telegram";
import { getOpenAI } from "@/integrations/openai";

export type CheckInOutcome = "resolved_ok" | "escalated" | "ignored";

const NOT_OK = /\b(not\s+(ok|okay|fine|good|well|alright)|hurt|pain|bleed|help|can'?t\s+(get|stand)|dizzy|ambulance|call\s+(someone|claire|my)|please\s+(help|come)|yes\b)/i;
const OK = /\b(i'?m\s+(ok|okay|fine|good|alright|all\s+right)|i\s+am\s+(ok|okay|fine)|just\s+(dropped|looking|resting|stretching)|no\s+need|don'?t\s+worry|all\s+good|nothing\s+happened)\b/i;

/** "ok" only when she clearly says so; asking for help, or an unclear answer, needs attention. */
async function classifyCheckIn(text: string): Promise<"ok" | "needs_help" | "unclear"> {
  if (NOT_OK.test(text)) return "needs_help";
  if (OK.test(text)) return "ok";
  try {
    const r = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_AGENT_MODEL ?? "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'An elderly person was asked "Are you okay?" after a possible fall. Classify her reply as JSON {"label":"ok"|"needs_help"|"unclear"}. Use "ok" only if she clearly says she is fine and needs nothing.',
        },
        { role: "user", content: text },
      ],
    });
    const label = JSON.parse(r.choices[0]?.message.content ?? "{}").label;
    return label === "ok" || label === "needs_help" ? label : "unclear";
  } catch {
    return "unclear";
  }
}

export async function handleFloorCandidate(
  event: PersonOnFloorCandidateEvent
): Promise<{ incidentId: string; question: string }> {
  const incident = await createIncident(event.elderId, event.confidence, event.note);
  await logActivity(event.elderId, "incident_detected", "Noticed something and is checking in.", incident.id);

  const question = "Marie? I noticed you're on the floor. Are you okay?";

  await updateIncident(incident.id, { status: "CHECKING" });
  await logActivity(event.elderId, "incident_checking", "Waiting to hear back.", incident.id);

  // Heads-up: family knows within seconds; the photo alert follows only if the check-in fails.
  try {
    const budget = await getBudget(event.elderId);
    await sendHeadsUp(budget.approverChatId, "\u26a0\ufe0f Possible fall in the salon \u2014 Hearth is checking with Marie now.");
  } catch (err) {
    console.warn("Failed to send Telegram heads-up", err);
  }

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
  response: string | null,
  photoBase64?: string
): Promise<{ outcome: CheckInOutcome; reason: string }> {
  const incident = await getIncident(incidentId);
  if (!incident) return { outcome: "ignored", reason: "not found" };
  if (incident.status !== "CHECKING") return { outcome: "ignored", reason: `status ${incident.status}` };

  const text = response?.trim() ?? "";
  let reason = "No answer to the check-in.";
  if (text) {
    const label = await classifyCheckIn(text);
    if (label === "ok") {
      await updateIncident(incidentId, { status: "RESOLVED_OK", elderResponse: text });
      await logActivity(incident.elderId, "incident_resolved_ok", "Responded and is okay.", incidentId);
      try {
        const budget = await getBudget(incident.elderId);
        await sendHeadsUp(budget.approverChatId, "\u2705 False alarm \u2014 Marie says she is fine.");
      } catch (err) {
        console.warn("Failed to send Telegram all-clear", err);
      }
      return { outcome: "resolved_ok", reason: "said she is okay" };
    }
    reason =
      label === "needs_help"
        ? `She asked for help: "${text.slice(0, 120)}"`
        : `Unclear answer: "${text.slice(0, 120)}"`;
  }

  const updated = await updateIncident(incidentId, { status: "ESCALATED", elderResponse: text || null });
  await logActivity(incident.elderId, "incident_escalated", `${reason} — alerting family.`, incidentId);

  try {
    const budget = await getBudget(incident.elderId);
    await sendIncidentAlert(updated, budget.approverChatId, { reason, photoBase64 });
  } catch (err) {
    console.warn("Failed to send Telegram incident alert", err);
  }
  return { outcome: "escalated", reason };
}

/** Marie asked for help or to reach her family in conversation — alert the family right away. */
export async function raiseHelpRequest(
  elderId: string,
  reason: string,
  photoBase64?: string
): Promise<{ incidentId: string }> {
  const incident = await createIncident(elderId, 1, reason, "asked_for_help");
  const updated = await updateIncident(incident.id, { status: "ESCALATED", elderResponse: reason });
  await logActivity(elderId, "incident_escalated", `She asked for help: "${reason.slice(0, 120)}" — alerting family.`, incident.id);
  try {
    const budget = await getBudget(elderId);
    await sendIncidentAlert(updated, budget.approverChatId, { reason: `She asked for help: "${reason.slice(0, 120)}"`, photoBase64 });
  } catch (err) {
    console.warn("Failed to send Telegram help alert", err);
  }
  return { incidentId: incident.id };
}
