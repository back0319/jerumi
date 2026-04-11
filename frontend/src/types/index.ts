export interface Foundation {
  id: number;
  brand: string;
  product_name: string;
  shade_code: string;
  shade_name: string;
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string | null;
  swatch_image_url: string | null;
}

export interface RecommendationItem {
  id: number;
  brand: string;
  product_name: string;
  shade_code: string;
  shade_name: string;
  lab: [number, number, number];
  hex_color: string;
  delta_e: number;
  delta_e_category: string;
  delta_e_range: string;
  delta_e_description: string;
  undertone: string | null;
}

export interface AnalysisConfidence {
  score: number;
  level: string;
  notes: string[];
}

export interface AnalysisMeta {
  method: string;
  fallback_used: boolean;
  total_pixel_count: number;
  valid_region_count: number;
  region_pixel_counts: Record<string, number>;
  max_region_delta_e: number | null;
  confidence: AnalysisConfidence;
}

export interface AnalysisResponse {
  skin_lab: [number, number, number];
  skin_hex: string;
  recommendations: RecommendationItem[];
  analysis_meta: AnalysisMeta;
}

export interface ColorCheckerPatch {
  reference_lab: [number, number, number];
  measured_rgb: [number, number, number];
}

export interface FoundationAnalysisResult {
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string;
}
