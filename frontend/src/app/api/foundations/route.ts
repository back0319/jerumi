/**
 * GET  /api/foundations          – list (optional ?brand= filter)
 * POST /api/foundations          – create (admin-only, JSON body)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabaseClient";
import { requireAdmin } from "@/lib/authUtils";

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  const supabase = createServerClient();

  let query = supabase
    .from("foundations")
    .select("*")
    .order("brand")
    .order("shade_name");

  if (brand) {
    query = query.eq("brand", brand);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const { brand, shade_name, L_value, a_value, b_value } = body;
  if (!brand || !shade_name || L_value == null || a_value == null || b_value == null) {
    return NextResponse.json(
      { detail: "brand, shade_name, L_value, a_value, b_value are required" },
      { status: 422 }
    );
  }

  const record = {
    brand,
    product_name: body.product_name ?? "",
    shade_code: body.shade_code ?? "",
    shade_name,
    L_value,
    a_value,
    b_value,
    hex_color: body.hex_color ?? "#000000",
    undertone: body.undertone
      ? String(body.undertone).trim().toUpperCase() || null
      : null,
    swatch_image_url: body.swatch_image_url ?? null,
  };

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("foundations")
    .insert(record)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
