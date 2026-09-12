import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Approval, Basket } from "@/contracts";
import { getBudget } from "./budget";
import { mapApproval } from "./map";

export async function createApproval(basket: Basket, ttlMinutes = 15): Promise<Approval> {
  const budget = await getBudget(basket.elderId);
  const excessCents = basket.totalCents - budget.limitCents;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("approvals")
    .insert({
      elder_id: basket.elderId,
      approver_id: budget.approverId,
      basket_id: basket.id,
      quote_hash: basket.quoteHash,
      total_cents: basket.totalCents,
      limit_cents: budget.limitCents,
      excess_cents: excessCents,
      status: "PENDING",
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`createApproval: ${error?.message ?? "insert failed"}`);
  }
  return mapApproval(data);
}

export async function getApproval(id: string): Promise<Approval | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("approvals").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getApproval: ${error.message}`);
  return data ? mapApproval(data) : null;
}

export async function decideApproval(
  id: string,
  decision: "approve" | "reject",
  approverId: string,
): Promise<{
  outcome: "decided" | "already_decided" | "expired" | "not_found";
  approval: Approval | null;
}> {
  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const nextStatus = decision === "approve" ? "APPROVED" : "REJECTED";

  const { data, error } = await db
    .from("approvals")
    .update({ status: nextStatus, decided_at: nowIso, decided_by: approverId })
    .eq("id", id)
    .eq("status", "PENDING")
    .gt("expires_at", nowIso)
    .select();

  if (error) throw new Error(`decideApproval: ${error.message}`);

  if (data && data.length > 0) {
    return { outcome: "decided", approval: mapApproval(data[0]) };
  }

  const existing = await getApproval(id);
  if (!existing) {
    return { outcome: "not_found", approval: null };
  }
  if (existing.status !== "PENDING") {
    return { outcome: "already_decided", approval: existing };
  }
  return { outcome: "expired", approval: existing };
}

export async function consumeApproval(id: string): Promise<Approval | null> {
  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from("approvals")
    .update({ status: "CONSUMED", consumed_at: nowIso })
    .eq("id", id)
    .eq("status", "APPROVED")
    .gt("expires_at", nowIso)
    .select();

  if (error) throw new Error(`consumeApproval: ${error.message}`);
  if (!data || data.length === 0) return null;
  return mapApproval(data[0]);
}

export async function expireApproval(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("approvals")
    .update({ status: "EXPIRED" })
    .eq("id", id)
    .eq("status", "PENDING")
    .select();

  if (error) throw new Error(`expireApproval: ${error.message}`);
  return !!data && data.length > 0;
}

export async function listPendingExpired(): Promise<Approval[]> {
  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("approvals")
    .select()
    .eq("status", "PENDING")
    .lt("expires_at", nowIso);

  if (error) throw new Error(`listPendingExpired: ${error.message}`);
  return (data ?? []).map(mapApproval);
}
