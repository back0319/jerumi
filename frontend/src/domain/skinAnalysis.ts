import { buildCheckerPatchesFromDetection } from "@/lib/colorChecker";
import type { ColorCheckerDetection } from "@/lib/colorChecker";
import { flattenSkinRegionPixels } from "@/lib/facemesh";
import {
  downsamplePixels,
  downsampleSkinRegions,
  type SkinExtraction,
} from "@/lib/skinSampling";
import type { AnalysisRequest } from "@/types";


const MAX_ANALYSIS_PIXELS = 10_000;
const MAX_REGION_ANALYSIS_PIXELS = 2_500;


export function prepareSkinAnalysisRequest(
  extraction: SkinExtraction,
  checker: ColorCheckerDetection | null,
  topN = 200,
): AnalysisRequest {
  const skinRegions = extraction.skinRegions
    ? downsampleSkinRegions(
        extraction.skinRegions,
        MAX_REGION_ANALYSIS_PIXELS,
      )
    : null;
  const skinPixels = skinRegions
    ? downsamplePixels(
        flattenSkinRegionPixels(skinRegions),
        MAX_ANALYSIS_PIXELS,
      )
    : downsamplePixels(extraction.combinedPixels, MAX_ANALYSIS_PIXELS);

  return {
    skin_pixels_rgb: skinPixels,
    skin_regions_rgb: skinRegions,
    checker_patches: buildCheckerPatchesFromDetection(checker),
    top_n: topN,
  };
}
