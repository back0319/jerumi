import type { components } from "./api.generated";

type Schemas = components["schemas"];

export type Foundation = Schemas["FoundationOut"];
export type RecommendationItem = Schemas["RecommendationItem"];
export type AnalysisConfidence = Schemas["AnalysisConfidence"];
export type AnalysisMeta = Schemas["AnalysisMeta"];
export type AnalysisRequest = Schemas["AnalysisRequest"];
export type AnalysisResponse = Schemas["AnalysisResponse"];
export type RecommendationRequest = Schemas["RecommendationRequest"];
export type SkinRegionPixelsRequest = Schemas["SkinRegionPixels"];
export type ColorCheckerPatch = Schemas["ColorCheckerPatch"];
export type DetectionPoint = Schemas["DetectionPoint"];
export type DetectedColorCheckerPatch = Schemas["DetectedColorCheckerPatch"];
export type ColorCheckerFiducials = Schemas["ColorCheckerFiducials"];
export type ColorCheckerDetectionResult =
  Schemas["ColorCheckerDetectionResult"];
export type SwatchDetectionResult = Schemas["SwatchDetectionResult"];
export type FoundationDetectionResult = Schemas["FoundationDetectionResult"];
export type FoundationAnalysisConfidence =
  Schemas["FoundationAnalysisConfidence"];
export type FoundationAnalysisResult = Schemas["FoundationAnalysisResult"];
export type FoundationCreate = Schemas["FoundationCreate"];
export type FoundationUpdate = Schemas["FoundationUpdate"];
