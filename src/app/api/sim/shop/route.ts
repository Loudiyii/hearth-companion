import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin()
      .from("catalog")
      .select("sku, name, unit_cents")
      .order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const catalog = (data ?? []).map((row) => ({
      sku: row.sku as string,
      name: row.name as string,
      unitCents: row.unit_cents as number,
    }));

    return NextResponse.json({ catalog });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
