"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { apiAuthPostFormData } from "@/lib/api";
import type {
  ActiveAdminPanel,
  PhotoMetaValues,
} from "@/components/admin/types";
import { createDefaultPhotoMeta } from "@/components/admin/types";
import type {
  DetectionPoint,
  Foundation,
  FoundationAnalysisResult,
  FoundationDetectionResult,
} from "@/types";

type UsePhotoFoundationWorkflowArgs = {
  token: string | null;
  activePanel: ActiveAdminPanel;
  setActivePanel: Dispatch<SetStateAction<ActiveAdminPanel>>;
  onFoundationCreated: (foundation: Foundation) => void;
};

export function usePhotoFoundationWorkflow({
  token,
  activePanel,
  setActivePanel,
  onFoundationCreated,
}: UsePhotoFoundationWorkflowArgs) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMeta, setPhotoMeta] = useState<PhotoMetaValues>(
    createDefaultPhotoMeta,
  );
  const [analysisResult, setAnalysisResult] =
    useState<FoundationAnalysisResult | null>(null);
  const [photoDetection, setPhotoDetection] =
    useState<FoundationDetectionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const photoImgRef = useRef<HTMLImageElement>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);

  const resetPhotoState = useCallback(() => {
    setPhotoFile(null);
    setPhotoPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setPhotoMeta(createDefaultPhotoMeta());
    setAnalysisResult(null);
    setPhotoDetection(null);
    setAnalyzing(false);
    setIsSavingPhoto(false);
    setPhotoError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  useEffect(() => {
    if (activePanel !== "photo") {
      resetPhotoState();
    }
  }, [activePanel, resetPhotoState]);

  const updatePhotoMetaField = useCallback(
    <Key extends keyof PhotoMetaValues>(
      key: Key,
      value: PhotoMetaValues[Key],
    ) => {
      setPhotoMeta((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handlePhotoUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        setPhotoError("파일 크기는 20MB 이하여야 합니다.");
        return;
      }

      setPhotoError(null);
      setPhotoFile(file);
      setPhotoPreview((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(file);
      });
      setAnalysisResult(null);
      setPhotoDetection(null);
    },
    [],
  );

  const drawPolygon = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      polygon: DetectionPoint[],
      stroke: string,
      fill: string,
    ) => {
      if (polygon.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(polygon[0].x, polygon[0].y);
      for (const point of polygon.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.fill();
      ctx.stroke();
    },
    [],
  );

  const drawPhotoCanvas = useCallback(
    (detection: FoundationDetectionResult | null = photoDetection) => {
      const image = photoImgRef.current;
      const canvas = photoCanvasRef.current;
      if (!image || !canvas) return;

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);

      if (!detection) return;

      ctx.save();
      ctx.lineWidth = Math.max(1.5, canvas.width / 900);

      if (detection.color_checker) {
        drawPolygon(
          ctx,
          detection.color_checker.polygon,
          "#7c3aed",
          "rgba(124, 58, 237, 0.12)",
        );
        ctx.lineWidth = Math.max(1, canvas.width / 1200);
        for (const patch of detection.color_checker.patches) {
          drawPolygon(
            ctx,
            patch.polygon,
            "rgba(124, 58, 237, 0.72)",
            "rgba(124, 58, 237, 0.03)",
          );
        }
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = Math.max(2, canvas.width / 720);
        const fiducialRadius = Math.max(4, canvas.width / 180);
        const centerPoint = detection.color_checker.fiducials.center;
        if (centerPoint) {
          ctx.beginPath();
          ctx.arc(centerPoint.x, centerPoint.y, fiducialRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (detection.swatch) {
        ctx.lineWidth = Math.max(1.5, canvas.width / 900);
        drawPolygon(
          ctx,
          detection.swatch.polygon,
          "#059669",
          "rgba(16, 185, 129, 0.16)",
        );
      }

      ctx.restore();
    },
    [drawPolygon, photoDetection],
  );

  const handlePhotoImageLoad = useCallback(() => {
    const image = photoImgRef.current;
    const canvas = photoCanvasRef.current;
    if (!image || !canvas) return;

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    drawPhotoCanvas();
  }, [drawPhotoCanvas]);

  const analyzeSwatch = useCallback(async () => {
    if (!photoFile || !token) return;

    setAnalyzing(true);
    setPhotoError(null);

    try {
      const formData = new FormData();
      formData.append("image", photoFile);

      const result = await apiAuthPostFormData<FoundationAnalysisResult>(
        "/foundations/analyze-swatch",
        formData,
        token,
      );
      setAnalysisResult(result);
      setPhotoDetection(result.detection ?? null);
      drawPhotoCanvas(result.detection ?? null);
    } catch (error: any) {
      setPhotoError(error.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }, [drawPhotoCanvas, photoFile, token]);

  const saveFromPhoto = useCallback(async () => {
    if (!photoFile || !token || !analysisResult) return;

    if (!photoMeta.brand || !photoMeta.shade_name) {
      setPhotoError("브랜드와 색상명은 필수 입력 항목입니다.");
      return;
    }

    setPhotoError(null);
    setIsSavingPhoto(true);

    try {
      const formData = new FormData();
      formData.append("image", photoFile);
      formData.append("brand", photoMeta.brand);
      formData.append("product_name", photoMeta.product_name);
      formData.append("shade_name", photoMeta.shade_name);
      formData.append("shade_code", photoMeta.shade_code);

      const created = await apiAuthPostFormData<Foundation>(
        "/foundations/from-photo",
        formData,
        token,
      );
      onFoundationCreated(created);
      setActivePanel("none");
    } catch (error: any) {
      setPhotoError(error.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingPhoto(false);
    }
  }, [
    analysisResult,
    onFoundationCreated,
    photoFile,
    photoMeta,
    setActivePanel,
    token,
  ]);

  const closePhotoPanel = useCallback(() => {
    setActivePanel("none");
  }, [setActivePanel]);

  return {
    photoPreview,
    photoMeta,
    analysisResult,
    photoDetection,
    analyzing,
    isSavingPhoto,
    photoError,
    photoImgRef,
    photoCanvasRef,
    updatePhotoMetaField,
    handlePhotoUpload,
    handlePhotoImageLoad,
    analyzeSwatch,
    saveFromPhoto,
    resetPhotoState,
    closePhotoPanel,
  };
}
