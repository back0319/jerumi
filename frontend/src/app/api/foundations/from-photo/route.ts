/**
 * POST /api/foundations/from-photo  (admin-only)
 *
 * FormData fields:
 *   image           – image file (JPEG/PNG/WebP, max 4 MB)
 *   brand           – string (required)
 *   shade_name      – string (required)
 *   product_name    – string (optional, default "")
 *   shade_code      – string (optional, default "")
 *   checker_patches – optional JSON string of ColorCheckerPatch[]
 *
 * Analyses the swatch image, uploads it to Supabase Storage,
 * creates a foundation record, and returns the new FoundationOut.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authUtils";
import { extractSwatchFromImage } from "@/lib/swatchAnalysis";
import { createServerClient } from "@/lib/supabaseClient";
import type { ColorCheckerPatch } from "@/lib/colorScience";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ detail: "Invalid form data" }, { status: 400 });
  }

  const imageFile = formData.get("image") as File | null;
  const brand = formData.get("brand") as string | null;
  const shadeName = formData.get("shade_name") as string | null;

  if (!imageFile || !brand || !shadeName) {
    return NextResponse.json(
      { detail: "image, brand, and shade_name are required" },
      { status: 422 }
    );
  }

  const productName = (formData.get("product_name") as string) ?? "";
  const shadeCode = (formData.get("shade_code") as string) ?? "";

  const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

  let patches: ColorCheckerPatch[] | null = null;
  const rawPatches = formData.get("checker_patches");
  if (rawPatches) {
    try {
      patches = JSON.parse(String(rawPatches));
    } catch {
      return NextResponse.json(
        { detail: "Invalid checker_patches JSON" },
        { status: 400 }
      );
    }
  }

  // Analyse swatch
  let swatchResult;
  try {
    swatchResult = await extractSwatchFromImage(imageBuffer, patches);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Swatch extraction failed";
    return NextResponse.json({ detail: message }, { status: 400 });
  }

  // Upload image to Supabase Storage
  const supabase = createServerClient();
  const safeName = `${brand}_${shadeName}`.replace(/[^\w\-]/g, "_");
  const filename = `${safeName}_${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("swatches")
    .upload(filename, imageBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  let swatchImageUrl: string | null = null;
  if (!uploadError) {
    const { data: urlData } = supabase.storage
      .from("swatches")
      .getPublicUrl(filename);
    swatchImageUrl = urlData.publicUrl;
  }
  // If upload fails we still save the record without an image URL

  // Insert foundation record
  const { data, error } = await supabase
    .from("foundations")
    .insert({
      brand,
      product_name: productName,
      shade_code: shadeCode,
      shade_name: shadeName,
      L_value: swatchResult.L_value,
      a_value: swatchResult.a_value,
      b_value: swatchResult.b_value,
      hex_color: swatchResult.hex_color,
      undertone: swatchResult.undertone,
      swatch_image_url: swatchImageUrl,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
