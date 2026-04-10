/**
 * POST /api/analyze
 *
 * Body (JSON):
 * {
 *   skin_pixels_rgb: [[R, G, B], ...],   // 0–255 per channel
 *   checker_patches?: [{ measured_rgb, reference_lab }, ...],
 *   brands?: string[],
 *   top_n?: number   // default 5
 * }
 *
 * Returns:
 * {
 *   skin_lab: [L, a, b],
 *   skin_hex: "#rrggbb",
 *   recommendations: [...]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildCorrectionMatrix,
  computeRecommendations,
  labToHex,
  rgbPixelsToLab,
  trimmedMeanLab,
} from "@/lib/colorScience";
import { createServerClient } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
  let body: {
    skin_pixels_rgb: number[][];
    checker_patches?: { measured_rgb: [number,number,number]; reference_lab: [number,number,number] }[];
    brands?: string[];
    top_n?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

  const { skin_pixels_rgb, checker_patches, brands, top_n = 5 } = body;

  if (!Array.isArray(skin_pixels_rgb) || skin_pixels_rgb.length === 0) {
    return NextResponse.json(
      { detail: "skin_pixels_rgb must be a non-empty array" },
      { status: 422 }
    );
  }

  // Build colour correction matrix from ColorChecker patches (optional)
  const correction = checker_patches ? buildCorrectionMatrix(checker_patches) : null;

  // Convert pixels to LAB
  const labPixels = rgbPixelsToLab(skin_pixels_rgb, correction);

  // Trimmed mean
  const skinLab = trimmedMeanLab(labPixels);
  const skinHex = labToHex(skinLab.L, skinLab.a, skinLab.b);

  // Query foundations from Supabase
  const supabase = createServerClient();
  let query = supabase
    .from("foundations")
    .select("id, brand, product_name, shade_code, shade_name, L_value, a_value, b_value, hex_color, undertone, swatch_image_url")
    .order("brand")
    .order("shade_name");

  if (brands && brands.length > 0) {
    query = query.in("brand", brands);
  }

  const { data: foundations, error } = await query;

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 500 });
  }

  // Compute CIEDE2000 rankings
  const ranked = computeRecommendations(skinLab, foundations ?? [], top_n);

  const recommendations = ranked.map((r) => ({
    id: r.id,
    brand: r.brand,
    product_name: r.product_name,
    shade_code: r.shade_code,
    shade_name: r.shade_name,
    lab: [
      Math.round(r.L_value * 100) / 100,
      Math.round(r.a_value * 100) / 100,
      Math.round(r.b_value * 100) / 100,
    ],
    hex_color: r.hex_color,
    delta_e: r.delta_e,
    delta_e_category: r.delta_e_category,
    delta_e_range: r.delta_e_range,
    delta_e_description: r.delta_e_description,
    undertone: r.undertone ?? null,
    swatch_image_url: r.swatch_image_url ?? null,
  }));

  return NextResponse.json({
    skin_lab: [
      Math.round(skinLab.L * 100) / 100,
      Math.round(skinLab.a * 100) / 100,
      Math.round(skinLab.b * 100) / 100,
    ],
    skin_hex: skinHex,
    recommendations,
  });
}
