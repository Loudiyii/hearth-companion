import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Incident, IncidentStatus } from "@/contracts";
import { mapIncident } from "./map";

export async function createIncident(
  elderId: string,
  confidence: number,
  note: string,
): Promise<Incident> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("incidents")
    .insert({
      elder_id: elderId,
      kind: "person_on_floor_candidate",
      confidence,
      note,
      status: "DETECTED",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`createIncident: ${error?.message ?? "insert failed"}`);
  }
  return mapIncident(data);
}

export async function updateIncident(
  id: string,
  patch: Partial<Pick<Incident, "status" | "elderResponse" | "acknowledgedBy">>,
): Promise<Incident> {
  const db = supabaseAdmin();
  const update: Record<string, string | IncidentStatus | null> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.elderResponse !== undefined) update.elder_response = patch.elderResponse;
  if (patch.acknowledgedBy !== undefined) update.acknowledged_by = patch.acknowledgedBy;

  const { data, error } = await db
    .from("incidents")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`updateIncident: ${error?.message ?? "update failed"}`);
  }
  return mapIncident(data);
}

export async function getIncident(id: string): Promise<Incident | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("incidents").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getIncident: ${error.message}`);
  return data ? mapIncident(data) : null;
}
