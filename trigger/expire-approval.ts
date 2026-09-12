import { task } from "@trigger.dev/sdk/v3";
import { expireApproval, getApproval, logActivity } from "@/domain";
import { editResult } from "@/integrations/telegram";

export const expireApprovalTask = task({
  id: "expire-approval",
  run: async (payload: { approvalId: string; chatId: string; messageId: number | null }) => {
    const flipped = await expireApproval(payload.approvalId);
    if (!flipped) return;

    const approval = await getApproval(payload.approvalId);
    if (approval) {
      await logActivity(approval.elderId, "approval_expired", "The approval window closed.", approval.id);
    }

    if (payload.messageId != null) {
      await editResult(payload.chatId, payload.messageId, "This approval has expired.");
    }
  },
});
