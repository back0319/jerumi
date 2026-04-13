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
import {
  buildCheckerPatches,
  type MeasuredPatch,
} from "@/lib/colorChecker";
import type {
  ActiveAdminPanel,
  PhotoMetaValues,
} from "@/components/admin/types";
import { createDefaultPhotoMeta } from "@/components/admin/types";
import type { Foundation, FoundationAnalysisResult } from "@/types";

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
  const [checkerPatches, setCheckerPatches] = useState<MeasuredPatch[]>([]);
  const [selectingPatch, setSelectingPatch] = useState<number | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<FoundationAnalysisResult | null>(null);
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
    setCheckerPatches([]);
    setSelectingPatch(null);
    setAnalysisResult(null);
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
      setCheckerPatches([]);
      setSelectingPatch(null);
    },
    [],
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
  }, []);

  const handlePhotoCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingPatch === null) return;

      const canvas = photoCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((event.clientX - rect.left) * scaleX);
      const y = Math.round((event.clientY - rect.top) * scaleY);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const size = 5;
      const data = ctx.getImageData(
        Math.max(0, x - size),
        Math.max(0, y - size),
        size * 2,
        size * 2,
      );
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let count = 0;

      for (let index = 0; index < data.data.length; index += 4) {
        redTotal += data.data[index];
        greenTotal += data.data[index + 1];
        blueTotal += data.data[index + 2];
        count++;
      }

      const measured: MeasuredPatch = {
        patchIndex: selectingPatch,
        measuredRgb: [
          Math.round(redTotal / count),
          Math.round(greenTotal / count),
          Math.round(blueTotal / count),
        ],
      };

      setCheckerPatches((current) => {
        const filtered = current.filter(
          (patch) => patch.patchIndex !== selectingPatch,
        );
        return [...filtered, measured];
      });
      setSelectingPatch(null);
    },
    [selectingPatch],
  );

  const togglePatchSelection = useCallback((patchIndex: number) => {
    setSelectingPatch((current) => (current === patchIndex ? null : patchIndex));
  }, []);

  const analyzeSwatch = useCallback(async () => {
    if (!photoFile || !token) return;

    setAnalyzing(true);
    setPhotoError(null);

    try {
      const formData = new FormData();
      formData.append("image", photoFile);

      if (checkerPatches.length >= 3) {
        const patches = buildCheckerPatches(checkerPatches);
        formData.append("checker_patches", JSON.stringify(patches));
      }

      const result = await apiAuthPostFormData<FoundationAnalysisResult>(
        "/foundations/analyze-swatch",
        formData,
        token,
      );
      setAnalysisResult(result);
    } catch (error: any) {
      setPhotoError(error.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }, [checkerPatches, photoFile, token]);

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

      if (checkerPatches.length >= 3) {
        const patches = buildCheckerPatches(checkerPatches);
        formData.append("checker_patches", JSON.stringify(patches));
      }

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
    checkerPatches,
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
    checkerPatches,
    selectingPatch,
    analysisResult,
    analyzing,
    isSavingPhoto,
    photoError,
    photoImgRef,
    photoCanvasRef,
    updatePhotoMetaField,
    handlePhotoUpload,
    handlePhotoImageLoad,
    handlePhotoCanvasClick,
    togglePatchSelection,
    analyzeSwatch,
    saveFromPhoto,
    resetPhotoState,
    closePhotoPanel,
  };
}
