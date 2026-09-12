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

async function step1_orderGroceries(): Promise<string> {
  const step = "1. order groceries triggers approval_requested";
  const { status, json } = await postJson("/api/agent", {
    elderId: ELDER_ID,
    text: "Order my groceries for the week",
  });

  if (status < 200 || status >= 300) {
    fail(step, `POST /api/agent returned ${status}`);
    return "";
  }

  const db = supabaseAdmin();
  const { data: activityRows, error: activityError } = await db
    .from("activity")
    .select()
    .eq("elder_id", ELDER_ID)
    .eq("kind", "approval_requested")
    .order("created_at", { ascending: false })
    .limit(1);

  if (activityError || !activityRows || activityRows.length === 0) {
    fail(step, "no approval_requested activity found");
    return "";
  }

  const { data: pendingApprovals, error: approvalError } = await db
    .from("approvals")
    .select()
    .eq("elder_id", ELDER_ID)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(1);

  if (approvalError || !pendingApprovals || pendingApprovals.length === 0) {
    fail(step, "no PENDING approval found");
    return "";
  }

  pass(step);
  console.log(JSON.stringify({ agentResponse: json }));
  return pendingApprovals[0].id as string;
}

async function step2_firstApprove(approvalId: string): Promise<void> {
  const step = "2. first approve tap succeeds payment";
  const { status } = await postJson("/api/dev/tap", { action: "approve", id: approvalId });
  if (status < 200 || status >= 300) {
    fail(step, `POST /api/dev/tap returned ${status}`);
    return;
  }

  const db = supabaseAdmin();
  const { data: approval, error } = await db
    .from("approvals")
    .select("basket_id")
    .eq("id", approvalId)
    .single();
  if (error || !approval) {
    fail(step, "could not read approval after tap");
    return;
  }

  const { data: payments, error: paymentsError } = await db
    .from("payments")
    .select()
    .eq("basket_id", approval.basket_id)
    .eq("status", "SUCCEEDED");

  if (paymentsError || !payments || payments.length === 0) {
    fail(step, "no SUCCEEDED payment found");
    return;
  }

  pass(step);
}

async function step3_secondApprove(approvalId: string): Promise<void> {
  const step = "3. duplicate approve tap is ignored";
  const { status } = await postJson("/api/dev/tap", { action: "approve", id: approvalId });
  if (status < 200 || status >= 300) {
    fail(step, `POST /api/dev/tap (second tap) returned ${status}`);
    return;
  }

  const db = supabaseAdmin();
  const { data: dupActivity, error } = await db
    .from("activity")
    .select()
    .eq("kind", "approval_duplicate_tap_ignored")
    .eq("ref_id", approvalId)
    .limit(1);

  if (error || !dupActivity || dupActivity.length === 0) {
    fail(step, "no approval_duplicate_tap_ignored activity found");
    return;
  }

  pass(step);
}

async function step4_exactlyOnePayment(approvalId: string): Promise<void> {
  const step = "4. exactly one SUCCEEDED payment for the basket";
  const db = supabaseAdmin();
  const { data: approval, error } = await db
    .from("approvals")
    .select("basket_id")
    .eq("id", approvalId)
    .single();
  if (error || !approval) {
    fail(step, "could not read approval");
    return;
  }

  const { data: payments, error: paymentsError } = await db
    .from("payments")
    .select()
    .eq("basket_id", approval.basket_id);

  if (paymentsError || !payments) {
    fail(step, "could not read payments");
    return;
  }

  const succeeded = payments.filter((p) => p.status === "SUCCEEDED");
  if (payments.length !== 1 || succeeded.length !== 1) {
    fail(
      step,
      `expected exactly 1 payment row with status SUCCEEDED, found ${payments.length} total, ${succeeded.length} succeeded`,
    );
    return;
  }

  pass(step);
}

async function main(): Promise<void> {
  const approvalId = await step1_orderGroceries();
  if (!approvalId) {
    console.error("Aborting: could not obtain a PENDING approval id from step 1.");
    process.exit(1);
  }

  await step2_firstApprove(approvalId);
  await step3_secondApprove(approvalId);
  await step4_exactlyOnePayment(approvalId);

  if (failed) {
    console.error("\nAcceptance test FAILED.");
    process.exit(1);
  }
  console.log("\nAcceptance test PASSED.");
}

main().catch((err) => {
  console.error("Acceptance test crashed:", err);
  process.exit(1);
});
