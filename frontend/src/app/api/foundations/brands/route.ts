/**
 * GET /api/foundations/brands
 * Returns a sorted list of distinct brand names.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabaseClient";

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("foundations")
    .select("brand")
    .order("brand");

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }

  // Deduplicate brands
  const seen = new Set<string>();
  const brands: string[] = [];
  for (const r of (data ?? []) as { brand: string }[]) {
    if (!seen.has(r.brand)) {
      seen.add(r.brand);
      brands.push(r.brand);
    }
  }
  return NextResponse.json(brands);
}
