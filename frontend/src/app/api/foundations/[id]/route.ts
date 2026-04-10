/**
 * GET    /api/foundations/[id]  – single foundation
 * PUT    /api/foundations/[id]  – update (admin-only, JSON body, partial)
 * DELETE /api/foundations/[id]  – delete (admin-only)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabaseClient";
import { requireAdmin } from "@/lib/authUtils";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ detail: "Invalid id" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("foundations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ detail: "Foundation not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ detail: "Invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  // Only include provided fields in the update
  const allowed = [
    "brand", "product_name", "shade_code", "shade_name",
    "L_value", "a_value", "b_value", "hex_color", "undertone", "swatch_image_url",
  ];
  const updateData: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) {
      if (key === "undertone" && body[key] != null) {
        updateData[key] = String(body[key]).trim().toUpperCase() || null;
      } else {
        updateData[key] = body[key];
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ detail: "No valid fields to update" }, { status: 422 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("foundations")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ detail: error?.message ?? "Foundation not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ detail: "Invalid id" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("foundations")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
