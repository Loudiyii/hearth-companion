import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Activity, ActivityKind } from "@/contracts";
import { mapActivity } from "./map";

export async function logActivity(
  elderId: string,
  kind: ActivityKind,
  message: string,
  refId?: string,
): Promise<Activity> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("activity")
    .insert({
      elder_id: elderId,
      kind,
      message,
      ref_id: refId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`logActivity: ${error?.message ?? "insert failed"}`);
  }
  return mapActivity(data);
}
