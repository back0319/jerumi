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
  skin_lab_raw: [number, number, number];
  skin_hex_raw: string;
  correction_applied: boolean;
  recommendations: RecommendationItem[];
  analysis_meta: AnalysisMeta;
}

export interface ColorCheckerPatch {
  reference_lab: [number, number, number];
  measured_rgb: [number, number, number];
}

export interface DetectionPoint {
  x: number;
  y: number;
}

export interface DetectedColorCheckerPatch {
  patch_index: number;
  measured_rgb: [number, number, number];
  center: DetectionPoint;
  polygon: DetectionPoint[];
}

export interface ColorCheckerFiducials {
  center: DetectionPoint | null;
  corners: DetectionPoint[];
}

export interface ColorCheckerDetectionResult {
  score: number;
  confidence: number;
  polygon: DetectionPoint[];
  patches: DetectedColorCheckerPatch[];
  fiducials: ColorCheckerFiducials;
}

export interface SwatchDetectionResult {
  polygon: DetectionPoint[];
  pixel_count: number;
  raw_pixel_count: number;
  sample_hex: string;
}

export interface FoundationDetectionResult {
  color_checker: ColorCheckerDetectionResult | null;
  swatch: SwatchDetectionResult | null;
  color_correction_applied: boolean;
  color_correction_source: string | null;
}

export interface FoundationAnalysisConfidence {
  score: number;
  level: string;
  notes: string[];
}

export interface FoundationAnalysisResult {
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string | null;
  detection: FoundationDetectionResult | null;
  confidence: FoundationAnalysisConfidence | null;
}
