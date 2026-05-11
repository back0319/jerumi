"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { apiAuthPostFormData } from "@/lib/api";
import { getSrgbCanvasContext } from "@/lib/canvasColor";
import { pairwiseDeltaStats } from "@/lib/labDelta";
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

const MAX_CANDIDATES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SAVE_IMAGE_MAX_DIMENSION = 1600;
const SAVE_IMAGE_QUALITY = 0.82;

function fileBaseName(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 ? filename.slice(0, dotIndex) : filename || "swatch";
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = objectUrl;
  });
}

async function resizePhotoForStorageUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const longestSide = Math.max(width, height);
    if (!width || !height || !longestSide) {
      return file;
    }

    const scale = Math.min(1, SAVE_IMAGE_MAX_DIMENSION / longestSide);
    if (scale === 1 && file.type === "image/jpeg" && file.size <= 900_000) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = getSrgbCanvasContext(canvas);
    if (!ctx) {
      return file;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", SAVE_IMAGE_QUALITY);
    });

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], `${fileBaseName(file.name)}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

function serializeCachedAnalysis(result: FoundationAnalysisResult): string {
  return JSON.stringify({
    L_value: result.L_value,
    a_value: result.a_value,
    b_value: result.b_value,
    hex_color: result.hex_color,
  });
}

export type PhotoCandidate = {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "analyzing" | "done" | "failed";
  result: FoundationAnalysisResult | null;
  error: string | null;
};

export type CandidateDeltaStats = {
  mean: number;
  max: number;
};

export function usePhotoFoundationWorkflow({
  token,
  activePanel,
  setActivePanel,
  onFoundationCreated,
}: UsePhotoFoundationWorkflowArgs) {
  const [candidates, setCandidates] = useState<PhotoCandidate[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [photoMeta, setPhotoMeta] = useState<PhotoMetaValues>(
    createDefaultPhotoMeta,
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const photoImgRef = useRef<HTMLImageElement>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);

  const primaryCandidate = useMemo(
    () => candidates.find((c) => c.id === primaryId) ?? null,
    [candidates, primaryId],
  );

  const photoFile = primaryCandidate?.file ?? null;
  const photoPreview = primaryCandidate?.preview ?? null;
  const analysisResult = primaryCandidate?.result ?? null;
  const photoDetection = analysisResult?.detection ?? null;

  const deltaStats = useMemo<CandidateDeltaStats | null>(() => {
    const labs: [number, number, number][] = candidates
      .filter((c) => c.result)
      .map((c) => [
        c.result!.L_value,
        c.result!.a_value,
        c.result!.b_value,
      ]);
    if (labs.length < 2) return null;
    const stats = pairwiseDeltaStats(labs);
    return { mean: stats.mean, max: stats.max };
  }, [candidates]);

  const releaseCandidatePreviews = useCallback(
    (toRelease: PhotoCandidate[]) => {
      for (const candidate of toRelease) {
        URL.revokeObjectURL(candidate.preview);
      }
    },
    [],
  );

  const resetPhotoState = useCallback(() => {
    setCandidates((current) => {
      releaseCandidatePreviews(current);
      return [];
    });
    setPrimaryId(null);
    setPhotoMeta(createDefaultPhotoMeta());
    setAnalyzing(false);
    setIsSavingPhoto(false);
    setPhotoError(null);
  }, [releaseCandidatePreviews]);

  useEffect(() => {
    return () => {
      releaseCandidatePreviews(candidates);
    };
  }, [candidates, releaseCandidatePreviews]);

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
      const ctx = getSrgbCanvasContext(canvas);
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
    const ctx = getSrgbCanvasContext(canvas);
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    drawPhotoCanvas();
  }, [drawPhotoCanvas]);

  const analyzeAllCandidates = useCallback(
    async (initialList: PhotoCandidate[]) => {
      if (!token) return;

      setAnalyzing(true);
      setPhotoError(null);

      const updateCandidate = (
        id: string,
        patch: Partial<PhotoCandidate>,
      ) => {
        setCandidates((current) =>
          current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        );
      };

      await Promise.all(
        initialList.map(async (candidate) => {
          updateCandidate(candidate.id, { status: "analyzing" });
          try {
            const formData = new FormData();
            formData.append("image", candidate.file);
            const result =
              await apiAuthPostFormData<FoundationAnalysisResult>(
                "/foundations/analyze-swatch",
                formData,
                token,
              );
            updateCandidate(candidate.id, {
              status: "done",
              result,
              error: null,
            });
          } catch (error: any) {
            updateCandidate(candidate.id, {
              status: "failed",
              result: null,
              error: error?.message || "분석 실패",
            });
          }
        }),
      );

      setAnalyzing(false);
    },
    [token],
  );

  const handlePhotoUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;

      const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
      const accepted = files.filter((f) => f.size <= MAX_FILE_SIZE);

      let warning: string | null = null;
      if (oversized.length > 0) {
        warning = `${oversized.length}개 사진이 20MB를 초과해 제외되었습니다.`;
      }
      const trimmed = accepted.slice(0, MAX_CANDIDATES);
      if (accepted.length > MAX_CANDIDATES) {
        warning = `한 번에 최대 ${MAX_CANDIDATES}장까지 처리합니다. 앞에서 ${MAX_CANDIDATES}장만 사용했습니다.`;
      }
      if (trimmed.length === 0) {
        setPhotoError(warning || "올린 사진을 사용할 수 없습니다.");
        return;
      }

      setCandidates((current) => {
        releaseCandidatePreviews(current);
        return [];
      });

      const nextCandidates: PhotoCandidate[] = trimmed.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        preview: URL.createObjectURL(file),
        status: "pending",
        result: null,
        error: null,
      }));

      setCandidates(nextCandidates);
      setPrimaryId(nextCandidates[0]?.id ?? null);
      setPhotoError(warning);

      void analyzeAllCandidates(nextCandidates);
    },
    [analyzeAllCandidates, releaseCandidatePreviews],
  );

  // Auto-promote highest-confidence candidate to primary once analysis settles.
  useEffect(() => {
    if (analyzing) return;
    const done = candidates.filter((c) => c.status === "done" && c.result);
    if (done.length === 0) return;

    const best = done.reduce((acc, candidate) => {
      const accScore = acc.result?.confidence?.score ?? -1;
      const candidateScore = candidate.result?.confidence?.score ?? -1;
      return candidateScore > accScore ? candidate : acc;
    }, done[0]);

    setPrimaryId((current) => {
      if (current && candidates.some((c) => c.id === current && c.result)) {
        return current;
      }
      return best.id;
    });
  }, [analyzing, candidates]);

  const setPrimary = useCallback((id: string) => {
    setPrimaryId(id);
  }, []);

  const analyzeSwatch = useCallback(async () => {
    const pending = candidates.filter(
      (c) => c.status === "pending" || c.status === "failed",
    );
    if (pending.length === 0) return;
    await analyzeAllCandidates(pending);
  }, [analyzeAllCandidates, candidates]);

  const saveFromPhoto = useCallback(async () => {
    if (!photoFile || !token || !analysisResult) return;

    if (!photoMeta.brand || !photoMeta.product_name || !photoMeta.shade_name) {
      setPhotoError("브랜드, 제품명, 색상명은 필수 입력 항목입니다.");
      return;
    }

    setPhotoError(null);
    setIsSavingPhoto(true);

    try {
      const uploadFile = await resizePhotoForStorageUpload(photoFile);
      const formData = new FormData();
      formData.append("image", uploadFile, uploadFile.name);
      formData.append("brand", photoMeta.brand);
      formData.append("product_name", photoMeta.product_name);
      formData.append("shade_name", photoMeta.shade_name);
      formData.append("shade_code", photoMeta.shade_code);
      formData.append(
        "analysis_result",
        serializeCachedAnalysis(analysisResult),
      );

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
    candidates,
    primaryId,
    setPrimary,
    deltaStats,
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
