import { decideApproval, getIncident, updateIncident, logActivity } from "@/domain";
import { checkout } from "@/server/checkout";
import type { Approval, Payment } from "@/contracts";

export type TapAction = "approve" | "reject" | "ack";

export type TapResult = {
  ok: boolean;
  message: string;
  approval?: Approval;
  payment?: Payment;
};

export async function handleTap({
  action,
  id,
  actorId,
}: {
  action: TapAction;
  id: string;
  actorId: string;
}): Promise<TapResult> {
  if (action === "approve") {
    const { outcome, approval } = await decideApproval(id, "approve", actorId);

    if (outcome === "not_found") {
      return { ok: false, message: "This approval could not be found." };
    }
    if (outcome === "expired") {
      return { ok: false, message: "This approval has expired.", approval: approval ?? undefined };
    }
    if (outcome === "already_decided") {
      if (approval) {
        await logActivity(approval.elderId, "approval_duplicate_tap_ignored", "Second tap ignored — already handled.", approval.id);
      }
      return { ok: false, message: "This approval was already decided.", approval: approval ?? undefined };
    }

    if (!approval) {
      return { ok: false, message: "Something went wrong approving this order." };
    }

    await logActivity(approval.elderId, "approval_approved", "Approved the order.", approval.id);

    const result = await checkout(approval.basketId, approval.id);
    if (result.ok) {
      return { ok: true, message: "Approved — payment succeeded.", approval, payment: result.payment };
    }
    if (result.reason === "approval_not_consumable") {
      return { ok: false, message: "This approval was already used.", approval };
    }
    return { ok: false, message: "Approved, but payment failed.", approval, payment: result.payment };
  }

  if (action === "reject") {
    const { outcome, approval } = await decideApproval(id, "reject", actorId);

    if (outcome === "not_found") {
      return { ok: false, message: "This approval could not be found." };
    }
    if (outcome === "expired") {
      return { ok: false, message: "This approval has expired.", approval: approval ?? undefined };
    }
    if (outcome === "already_decided") {
      if (approval) {
        await logActivity(approval.elderId, "approval_duplicate_tap_ignored", "Second tap ignored — already handled.", approval.id);
      }
      return { ok: false, message: "This approval was already decided.", approval: approval ?? undefined };
    }

    if (approval) {
      await logActivity(approval.elderId, "approval_rejected", "Rejected the order.", approval.id);
    }
    return { ok: true, message: "Rejected.", approval: approval ?? undefined };
  }

  const incident = await getIncident(id);
  if (!incident) {
    return { ok: false, message: "This incident could not be found." };
  }
  await updateIncident(id, { status: "ACKNOWLEDGED", acknowledgedBy: actorId });
  await logActivity(incident.elderId, "incident_acknowledged", "Family member is on it.", incident.id);
  return { ok: true, message: "Got it, thanks for checking." };
}
