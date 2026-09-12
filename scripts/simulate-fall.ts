/**
 * Flow 3 end-to-end: person_on_floor_candidate detection -> check-in -> escalation / resolution.
 * Run with `npx tsx scripts/simulate-fall.ts` against APP_URL (default http://localhost:3000).
 *
 * This exercises the same HTTP contract Guardian (the external camera agent) will use:
 * POST /api/incidents and POST /api/incidents/[id]/response. See docs/GUARDIAN_INTEGRATION.md.
 */
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

function floorCandidateEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "person_on_floor_candidate",
    elderId: ELDER_ID,
    confidence: 0.82,
    note: "person appears to be lying on the floor near the sofa",
    at: new Date().toISOString(),
    ...overrides,
  };
}

async function hasActivity(elderId: string, kind: string, refId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("activity")
    .select()
    .eq("elder_id", elderId)
    .eq("kind", kind)
    .eq("ref_id", refId)
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
}

async function incidentStatus(id: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("incidents").select("status").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data.status as string;
}

// --- a. detection -----------------------------------------------------------

async function stepA_detect(): Promise<string> {
  const step = "a. POST /api/incidents (person_on_floor_candidate) -> 200 + DETECTED/CHECKING + incident_detected";
  const { status, json } = await postJson("/api/incidents", floorCandidateEvent());

  if (status < 200 || status >= 300) {
    fail(step, `returned ${status}: ${JSON.stringify(json)}`);
    return "";
  }
  const body = json as { incidentId?: string; question?: string };
  if (!body.incidentId || !body.question) {
    fail(step, `missing incidentId/question in response: ${JSON.stringify(json)}`);
    return "";
  }

  const status2 = await incidentStatus(body.incidentId);
  if (status2 !== "DETECTED" && status2 !== "CHECKING") {
    fail(step, `incident status is ${status2}, expected DETECTED or CHECKING`);
    return "";
  }

  const logged = await hasActivity(ELDER_ID, "incident_detected", body.incidentId);
  if (!logged) {
    fail(step, "no incident_detected activity row found");
    return "";
  }

  pass(step);
  return body.incidentId;
}

// --- b. silent response -> escalation ---------------------------------------

async function stepB_escalate(incidentId: string): Promise<void> {
  const step = "b. POST /api/incidents/[id]/response { response: null } -> ESCALATED + incident_escalated";
  const { status, json } = await postJson(`/api/incidents/${incidentId}/response`, { response: null });

  if (status < 200 || status >= 300) {
    fail(step, `returned ${status}: ${JSON.stringify(json)}`);
    return;
  }

  const finalStatus = await incidentStatus(incidentId);
  if (finalStatus !== "ESCALATED") {
    fail(step, `incident status is ${finalStatus}, expected ESCALATED`);
    return;
  }

  const logged = await hasActivity(ELDER_ID, "incident_escalated", incidentId);
  if (!logged) {
    fail(step, "no incident_escalated activity row found");
    return;
  }

  pass(step);
}

// --- c. ack -------------------------------------------------------------

async function stepC_ack(incidentId: string): Promise<void> {
  const step = "c. POST /api/dev/tap { action: ack } -> ACKNOWLEDGED + incident_acknowledged";
  const { status, json } = await postJson("/api/dev/tap", { action: "ack", id: incidentId });

  if (status < 200 || status >= 300) {
    fail(step, `returned ${status}: ${JSON.stringify(json)}`);
    return;
  }

  const finalStatus = await incidentStatus(incidentId);
  if (finalStatus !== "ACKNOWLEDGED") {
    fail(step, `incident status is ${finalStatus}, expected ACKNOWLEDGED`);
    return;
  }

  const logged = await hasActivity(ELDER_ID, "incident_acknowledged", incidentId);
  if (!logged) {
    fail(step, "no incident_acknowledged activity row found");
    return;
  }

  pass(step);
  console.log(JSON.stringify({ tapResponse: json }));
}

// --- d. elder answers -> resolved, no escalation -----------------------

async function stepD_resolvedOk(): Promise<void> {
  const step = "d. second run: elder answers -> RESOLVED_OK + incident_resolved_ok, no escalation";
  const { status, json } = await postJson("/api/incidents", floorCandidateEvent());
  if (status < 200 || status >= 300) {
    fail(step, `POST /api/incidents returned ${status}: ${JSON.stringify(json)}`);
    return;
  }
  const body = json as { incidentId?: string };
  if (!body.incidentId) {
    fail(step, `missing incidentId: ${JSON.stringify(json)}`);
    return;
  }

  const { status: respStatus, json: respJson } = await postJson(
    `/api/incidents/${body.incidentId}/response`,
    { response: "I'm fine, I dropped my glasses" },
  );
  if (respStatus < 200 || respStatus >= 300) {
    fail(step, `POST response returned ${respStatus}: ${JSON.stringify(respJson)}`);
    return;
  }

  const finalStatus = await incidentStatus(body.incidentId);
  if (finalStatus !== "RESOLVED_OK") {
    fail(step, `incident status is ${finalStatus}, expected RESOLVED_OK`);
    return;
  }

  const resolvedLogged = await hasActivity(ELDER_ID, "incident_resolved_ok", body.incidentId);
  if (!resolvedLogged) {
    fail(step, "no incident_resolved_ok activity row found");
    return;
  }

  const escalatedLogged = await hasActivity(ELDER_ID, "incident_escalated", body.incidentId);
  if (escalatedLogged) {
    fail(step, "found an incident_escalated activity row for a resolved incident");
    return;
  }

  pass(step);
}

// --- validation: bad input rejected with 400 ----------------------------

async function stepE_badInputIncidents(): Promise<void> {
  const step = "e. POST /api/incidents rejects missing elderId with 400";
  const { status, json } = await postJson("/api/incidents", {
    type: "person_on_floor_candidate",
    confidence: 0.82,
    note: "missing elderId",
    at: new Date().toISOString(),
  });
  if (status !== 400) {
    fail(step, `expected 400, got ${status}: ${JSON.stringify(json)}`);
    return;
  }
  pass(step);
}

async function stepF_badConfidence(): Promise<void> {
  const step = "f. POST /api/incidents rejects confidence 1.5 with 400";
  const { status, json } = await postJson("/api/incidents", floorCandidateEvent({ confidence: 1.5 }));
  if (status !== 400) {
    fail(step, `expected 400, got ${status}: ${JSON.stringify(json)}`);
    return;
  }
  pass(step);
}

async function stepG_wrongType(): Promise<void> {
  const step = "g. POST /api/incidents rejects wrong `type` with 400";
  const { status, json } = await postJson("/api/incidents", floorCandidateEvent({ type: "utterance" }));
  if (status !== 400) {
    fail(step, `expected 400, got ${status}: ${JSON.stringify(json)}`);
    return;
  }
  pass(step);
}

async function main(): Promise<void> {
  const incidentId = await stepA_detect();
  if (!incidentId) {
    console.error("Aborting: could not obtain an incidentId from step a.");
    process.exit(1);
  }

  await stepB_escalate(incidentId);
  await stepC_ack(incidentId);
  await stepD_resolvedOk();
  await stepE_badInputIncidents();
  await stepF_badConfidence();
  await stepG_wrongType();

  if (failed) {
    console.error("\nsimulate-fall FAILED.");
    process.exit(1);
  }
  console.log("\nsimulate-fall PASSED.");
}

main().catch((err) => {
  console.error("simulate-fall crashed:", err);
  process.exit(1);
});
