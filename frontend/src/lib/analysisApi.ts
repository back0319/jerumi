import { apiGet, apiPost } from "@/lib/api";
import type {
  AnalysisRequest,
  AnalysisResponse,
  RecommendationItem,
  RecommendationRequest,
} from "@/types";


export type AnalysisWithBrands = {
  analysis: AnalysisResponse;
  brands: string[] | null;
};


export async function analyzeSkin(
  request: AnalysisRequest,
): Promise<AnalysisWithBrands> {
  const [analysis, brands] = await Promise.all([
    submitSkinAnalysis(request),
    apiGet<string[]>("/foundations/brands").catch(() => null),
  ]);

  return { analysis, brands };
}


export function submitSkinAnalysis(
  request: AnalysisRequest,
): Promise<AnalysisResponse> {
  return apiPost<AnalysisResponse>("/analyze", request);
}


export function recommendForBrand(
  skinLab: number[],
  brand: string,
): Promise<RecommendationItem[]> {
  const request: RecommendationRequest = {
    skin_lab: skinLab,
    brands: [brand],
    top_n: 200,
  };
  return apiPost<RecommendationItem[]>("/recommendations", request);
}
