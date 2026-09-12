import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { supabaseAdmin } from "../src/lib/supabase-admin";

function loadDotEnvLocal(): void {
  const path = resolve(__dirname, "..", ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvLocal();

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ELDER_ID = process.env.DEMO_ELDER_ID ?? "marie";

let failed = false;

function pass(step: string): void {
  console.log(`PASS: ${step}`);
}

function fail(step: string, detail: string): void {
  failed = true;
  console.error(`FAIL: ${step} — ${detail}`);
}

async function postJson(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function orderGroceries(): Promise<{ approvalId: string; basketId: string }> {
  const { status } = await postJson("/api/agent", {
    elderId: ELDER_ID,
    text: "Order my groceries for the week",
  });
  if (status < 200 || status >= 300) {
    throw new Error(`POST /api/agent returned ${status}`);
  }

  const db = supabaseAdmin();
  const { data: pendingApprovals, error } = await db
    .from("approvals")
    .select()
    .eq("elder_id", ELDER_ID)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !pendingApprovals || pendingApprovals.length === 0) {
    throw new Error("no PENDING approval found after ordering groceries");
  }

  return { approvalId: pendingApprovals[0].id as string, basketId: pendingApprovals[0].basket_id as string };
}

async function countPayments(basketId: string): Promise<{ total: number; succeeded: number }> {
  const db = supabaseAdmin();
  const { data: payments, error } = await db.from("payments").select().eq("basket_id", basketId);
  if (error) throw new Error(`countPayments: ${error.message}`);
  const rows = payments ?? [];
  return { total: rows.length, succeeded: rows.filter((p) => p.status === "SUCCEEDED").length };
}

// ---------------------------------------------------------------------------
// a. Reject
// ---------------------------------------------------------------------------
async function scenarioReject(): Promise<void> {
  const step = "a. reject then approve is refused";
  const { approvalId, basketId } = await orderGroceries();

  const { status: rejectStatus } = await postJson("/api/dev/tap", {
    action: "reject",
    id: approvalId,
  });
  if (rejectStatus < 200 || rejectStatus >= 300) {
    fail(step, `reject tap returned ${rejectStatus}`);
    return;
  }

  const db = supabaseAdmin();
  const { data: approval, error } = await db
    .from("approvals")
    .select("status")
    .eq("id", approvalId)
    .single();
  if (error || !approval) {
    fail(step, "could not read approval after reject");
    return;
  }
  if (approval.status !== "REJECTED") {
    fail(step, `expected approval status REJECTED, got ${approval.status}`);
    return;
  }

  const { data: rejectedActivity, error: activityError } = await db
    .from("activity")
    .select()
    .eq("kind", "approval_rejected")
    .eq("ref_id", approvalId)
    .limit(1);
  if (activityError || !rejectedActivity || rejectedActivity.length === 0) {
    fail(step, "no approval_rejected activity found");
    return;
  }

  const afterReject = await countPayments(basketId);
  if (afterReject.total !== 0) {
    fail(step, `expected zero payments after reject, found ${afterReject.total}`);
    return;
  }

  const { status: secondStatus, json: secondJson } = await postJson("/api/dev/tap", {
    action: "approve",
    id: approvalId,
  });
  if (secondStatus < 200 || secondStatus >= 300) {
    fail(step, `approve-after-reject tap returned ${secondStatus}`);
    return;
  }
  const body = secondJson as { ok?: boolean; message?: string } | null;
  if (body?.ok !== false) {
    fail(step, `expected approve-after-reject to be refused, got ${JSON.stringify(secondJson)}`);
    return;
  }

  const afterSecond = await countPayments(basketId);
  if (afterSecond.total !== 0) {
    fail(step, `expected zero payments after approve-on-rejected, found ${afterSecond.total}`);
    return;
  }

  pass(step);
}

// ---------------------------------------------------------------------------
// b. Expired
// ---------------------------------------------------------------------------
async function scenarioExpired(): Promise<void> {
  const step = "b. approve on expired approval is refused";
  const { approvalId, basketId } = await orderGroceries();

  const db = supabaseAdmin();
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const { error: updateError } = await db
    .from("approvals")
    .update({ expires_at: expiredAt })
    .eq("id", approvalId);
  if (updateError) {
    fail(step, `could not force-expire approval: ${updateError.message}`);
    return;
  }

  const { status, json } = await postJson("/api/dev/tap", { action: "approve", id: approvalId });
  if (status < 200 || status >= 300) {
    fail(step, `approve tap returned ${status}`);
    return;
  }
  const body = json as { ok?: boolean; message?: string } | null;
  if (body?.ok !== false || !/expir/i.test(body?.message ?? "")) {
    fail(step, `expected a refusal mentioning expiry, got ${JSON.stringify(json)}`);
    return;
  }

  const { data: approval, error } = await db
    .from("approvals")
    .select("status")
    .eq("id", approvalId)
    .single();
  if (error || !approval) {
    fail(step, "could not read approval after expired-approve attempt");
    return;
  }
  if (approval.status !== "PENDING" && approval.status !== "EXPIRED") {
    fail(step, `expected status PENDING or EXPIRED, got ${approval.status}`);
    return;
  }

  const payments = await countPayments(basketId);
  if (payments.total !== 0) {
    fail(step, `expected zero payments, found ${payments.total}`);
    return;
  }

  pass(step);
}

// ---------------------------------------------------------------------------
// c. Quote-hash mismatch
// ---------------------------------------------------------------------------
async function scenarioQuoteHashMismatch(): Promise<void> {
  const step = "c. tampered quote_hash refuses checkout";
  const { approvalId, basketId } = await orderGroceries();

  const db = supabaseAdmin();
  const { error: tamperError } = await db
    .from("baskets")
    .update({ quote_hash: "tampered-hash-does-not-match" })
    .eq("id", basketId);
  if (tamperError) {
    fail(step, `could not tamper basket quote_hash: ${tamperError.message}`);
    return;
  }

  const { status, json } = await postJson("/api/dev/tap", { action: "approve", id: approvalId });
  if (status < 200 || status >= 300) {
    fail(step, `approve tap returned ${status}`);
    return;
  }
  const body = json as { ok?: boolean; message?: string } | null;
  if (body?.ok !== false) {
    fail(step, `expected checkout to refuse on quote_hash mismatch, got ${JSON.stringify(json)}`);
    return;
  }

  const payments = await countPayments(basketId);
  if (payments.succeeded !== 0) {
    fail(step, `expected zero SUCCEEDED payments, found ${payments.succeeded}`);
    return;
  }

  pass(step);
}

// ---------------------------------------------------------------------------
// d. Concurrent consume is atomic
// ---------------------------------------------------------------------------
async function scenarioConcurrentConsume(): Promise<void> {
  const step = "d. concurrent approve taps produce exactly one SUCCEEDED payment";
  const { approvalId, basketId } = await orderGroceries();

  const { status: firstStatus } = await postJson("/api/dev/tap", { action: "approve", id: approvalId });
  if (firstStatus < 200 || firstStatus >= 300) {
    fail(step, `first approve tap returned ${firstStatus}`);
    return;
  }

  const results = await Promise.all(
    Array.from({ length: 5 }, () => postJson("/api/dev/tap", { action: "approve", id: approvalId })),
  );
  for (const r of results) {
    if (r.status < 200 || r.status >= 300) {
      fail(step, `a parallel approve tap returned ${r.status}`);
      return;
    }
  }

  const payments = await countPayments(basketId);
  if (payments.succeeded !== 1) {
    fail(step, `expected exactly 1 SUCCEEDED payment, found ${payments.succeeded} (total rows ${payments.total})`);
    return;
  }

  pass(step);
}

async function main(): Promise<void> {
  await scenarioReject();
  await scenarioExpired();
  await scenarioQuoteHashMismatch();
  await scenarioConcurrentConsume();

  if (failed) {
    console.error("\nEdge-case acceptance test FAILED.");
    process.exit(1);
  }
  console.log("\nEdge-case acceptance test PASSED.");
}

main().catch((err) => {
  console.error("Edge-case acceptance test crashed:", err);
  process.exit(1);
});
