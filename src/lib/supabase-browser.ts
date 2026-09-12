"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

let browserClient: SupabaseClient | null = null;

/** Singleton browser client using the public anon key. Never import server-side. */
export function supabaseBrowser(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  browserClient = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return browserClient;
}

/** snake_case -> camelCase, recursively over plain object keys (not array values, not dates). */
function camelize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = row[key];
  }
  return out as T;
}

interface RealtimeQuery {
  /** column = value filters, applied with .eq() */
  filter?: Record<string, string | number>;
  limit?: number;
}

/**
 * Loads the latest rows from `table` (ordered by created_at desc) and keeps them fresh
 * via a postgres_changes subscription (INSERT + UPDATE). Rows are mapped snake_case -> camelCase.
 */
export function useRealtimeTable<T extends { id: string }>(
  table: string,
  query: RealtimeQuery = {}
): { rows: T[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = query.limit ?? 50;
  const filterKey = JSON.stringify(query.filter ?? {});

  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseBrowser();

    async function load() {
      setLoading(true);
      let q = supabase.from(table).select("*").order("created_at", { ascending: false }).limit(limit);
      const filter = query.filter ?? {};
      for (const [col, val] of Object.entries(filter)) {
        q = q.eq(col, val);
      }
      const { data, error: err } = await q;
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const mapped = (data ?? []).map((r) => camelize<T>(r as Record<string, unknown>));
      setRows(mapped);
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`realtime:${table}:${filterKey}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        (payload) => {
          const row = camelize<T>(payload.new as Record<string, unknown>);
          const filter = query.filter ?? {};
          for (const [col, val] of Object.entries(filter)) {
            const camelCol = col.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
            if ((row as unknown as Record<string, unknown>)[camelCol] !== val) return;
          }
          setRows((prev) => [row, ...prev].slice(0, limit));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table },
        (payload) => {
          const row = camelize<T>(payload.new as Record<string, unknown>);
          setRows((prev) => {
            const exists = prev.some((r) => r.id === row.id);
            if (!exists) return [row, ...prev].slice(0, limit);
            return prev.map((r) => (r.id === row.id ? row : r));
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, limit, filterKey]);

  return { rows, loading, error };
}
