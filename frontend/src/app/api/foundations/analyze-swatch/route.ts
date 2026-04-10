/**
 * POST /api/foundations/analyze-swatch  (admin-only)
 *
 * FormData fields:
 *   image          – image file (JPEG/PNG/WebP, max 4 MB)
 *   checker_patches – optional JSON string of ColorCheckerPatch[]
 *
 * Returns { L_value, a_value, b_value, hex_color, undertone }
 * without saving to the database.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authUtils";
import { extractSwatchFromImage } from "@/lib/swatchAnalysis";
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
  if (!imageFile) {
    return NextResponse.json({ detail: "image field is required" }, { status: 422 });
  }

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

  try {
    const result = await extractSwatchFromImage(imageBuffer, patches);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Swatch extraction failed";
    return NextResponse.json({ detail: message }, { status: 400 });
  }
}
