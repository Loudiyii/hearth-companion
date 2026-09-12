import { supabaseAdmin } from "@/lib/supabase-admin";

export async function getBudget(
  elderId: string,
): Promise<{ limitCents: number; approverId: string; approverChatId: string }> {
  const db = supabaseAdmin();

  const { data: budget, error: budgetError } = await db
    .from("budgets")
    .select("weekly_limit_cents")
    .eq("elder_id", elderId)
    .single();
  if (budgetError || !budget) {
    throw new Error(`getBudget: no budget for elder ${elderId}`);
  }

  const { data: approver, error: approverError } = await db
    .from("approvers")
    .select("id, telegram_chat_id")
    .eq("elder_id", elderId)
    .limit(1)
    .maybeSingle();
  if (approverError || !approver) {
    throw new Error(`getBudget: no approver for elder ${elderId}`);
  }

  return {
    limitCents: budget.weekly_limit_cents,
    approverId: approver.id,
    approverChatId: approver.telegram_chat_id,
  };
}
