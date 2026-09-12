import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Basket, BasketItem } from "@/contracts";
import { mapBasket } from "./map";

function quoteHash(items: BasketItem[]): string {
  const sorted = [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, qty, unitCents }) => ({ name, qty, unitCents }));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

async function insertBasket(elderId: string, items: BasketItem[]): Promise<Basket> {
  const totalCents = items.reduce((sum, item) => sum + item.qty * item.unitCents, 0);
  const hash = quoteHash(items);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("baskets")
    .insert({
      elder_id: elderId,
      items,
      total_cents: totalCents,
      quote_hash: hash,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`insertBasket: ${error?.message ?? "insert failed"}`);
  }
  return mapBasket(data);
}

export async function buildBasket(
  elderId: string,
  items: { name: string; qty: number }[],
): Promise<Basket> {
  const db = supabaseAdmin();
  const { data: catalogRows, error } = await db
    .from("catalog")
    .select("sku, name, unit_cents");
  if (error || !catalogRows) {
    throw new Error(`buildBasket: could not load catalog: ${error?.message}`);
  }

  const byLowerName = new Map(catalogRows.map((row) => [row.name.toLowerCase(), row]));

  const basketItems: BasketItem[] = items.map((item) => {
    const match = byLowerName.get(item.name.toLowerCase());
    if (!match) {
      throw new Error(`buildBasket: unknown item "${item.name}"`);
    }
    return { name: match.name, qty: item.qty, unitCents: match.unit_cents };
  });

  return insertBasket(elderId, basketItems);
}

export async function buildUsualBasket(elderId: string): Promise<Basket> {
  const db = supabaseAdmin();
  const { data: usualRows, error } = await db
    .from("usual_list")
    .select("sku, qty")
    .eq("elder_id", elderId);
  if (error || !usualRows) {
    throw new Error(`buildUsualBasket: could not load usual_list: ${error?.message}`);
  }
  if (usualRows.length === 0) {
    throw new Error(`buildUsualBasket: no usual list for elder ${elderId}`);
  }

  const { data: catalogRows, error: catalogError } = await db
    .from("catalog")
    .select("sku, name, unit_cents")
    .in(
      "sku",
      usualRows.map((row) => row.sku),
    );
  if (catalogError || !catalogRows) {
    throw new Error(`buildUsualBasket: could not load catalog: ${catalogError?.message}`);
  }
  const bySku = new Map(catalogRows.map((row) => [row.sku, row]));

  const basketItems: BasketItem[] = usualRows.map((row) => {
    const match = bySku.get(row.sku);
    if (!match) {
      throw new Error(`buildUsualBasket: usual_list references unknown sku "${row.sku}"`);
    }
    return { name: match.name, qty: row.qty, unitCents: match.unit_cents };
  });

  return insertBasket(elderId, basketItems);
}

export async function getBasket(id: string): Promise<Basket | null> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("baskets").select().eq("id", id).maybeSingle();
  if (error) throw new Error(`getBasket: ${error.message}`);
  return data ? mapBasket(data) : null;
}
