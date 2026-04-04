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
  undertone: string | null;
}

export interface AnalysisResponse {
  skin_lab: [number, number, number];
  skin_hex: string;
  recommendations: RecommendationItem[];
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
