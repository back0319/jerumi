"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  apiGet,
  apiFormPost,
  apiAuthPost,
  apiAuthPut,
  apiAuthDelete,
  apiAuthPostFormData,
} from "@/lib/api";
import {
  COLORCHECKER_REFERENCE,
  type MeasuredPatch,
  buildCheckerPatches,
} from "@/lib/colorChecker";
import type { Foundation, FoundationAnalysisResult } from "@/types";

function createDefaultManualForm() {
  return {
    brand: "",
    shade_name: "",
    shade_code: "",
    product_name: "",
    L_value: 0,
    a_value: 0,
    b_value: 0,
    hex_color: "#000000",
    undertone: "",
  };
}

function createDefaultPhotoMeta() {
  return {
    brand: "",
    product_name: "",
    shade_name: "",
    shade_code: "",
  };
}

function sortFoundations(items: readonly Foundation[]) {
  return [...items].sort((left, right) => {
    const byBrand = left.brand.localeCompare(right.brand, "ko");
    if (byBrand !== 0) {
      return byBrand;
    }

    return left.shade_name.localeCompare(right.shade_name, "ko");
  });
}

function buildBrandList(items: readonly Foundation[]) {
  return Array.from(new Set(items.map((item) => item.brand))).sort(
    (left, right) => left.localeCompare(right, "ko"),
  );
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [allFoundations, setAllFoundations] = useState<Foundation[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [listError, setListError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filterBrand, setFilterBrand] = useState<string>("");

  // New foundation form (manual)
  const [showForm, setShowForm] = useState(false);
  const [editingFoundationId, setEditingFoundationId] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState(createDefaultManualForm);

  // Photo analysis form
  const [showPhotoForm, setShowPhotoForm] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMeta, setPhotoMeta] = useState(createDefaultPhotoMeta);
  const [analysisResult, setAnalysisResult] =
    useState<FoundationAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // ColorChecker for photo analysis
  const [checkerPatches, setCheckerPatches] = useState<MeasuredPatch[]>([]);
  const [selectingPatch, setSelectingPatch] = useState<number | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const brands = buildBrandList(allFoundations);
  const foundations = filterBrand
    ? allFoundations.filter((foundation) => foundation.brand === filterBrand)
    : allFoundations;

  const resetPhotoState = useCallback(() => {
    setPhotoFile(null);
    setPhotoPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setAnalysisResult(null);
    setCheckerPatches([]);
    setSelectingPatch(null);
    setPhotoMeta(createDefaultPhotoMeta());
    setPhotoError(null);
  }, []);

  const loadFoundations = useCallback(async () => {
    setIsLoadingData(true);
    setListError("");

    try {
      const foundationList = await apiGet<Foundation[]>("/api/foundations");
      startTransition(() => {
        setAllFoundations(sortFoundations(foundationList));
      });
    } catch {
      setListError(
        "파운데이션 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    try {
      const data = await apiFormPost<{ access_token: string }>(
        "/api/auth/login",
        new URLSearchParams({ username, password }),
      );
      setToken(data.access_token);
    } catch {
      setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadFoundations();
    }
  }, [token, loadFoundations]);

  useEffect(() => {
    if (
      filterBrand &&
      !allFoundations.some((foundation) => foundation.brand === filterBrand)
    ) {
      setFilterBrand("");
    }
  }, [allFoundations, filterBrand]);

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  const openCreateForm = useCallback(() => {
    setEditingFoundationId(null);
    setForm(createDefaultManualForm());
    setShowPhotoForm(false);
    setShowForm(true);
  }, []);

  const openEditForm = useCallback((foundation: Foundation) => {
    setEditingFoundationId(foundation.id);
    setForm({
      brand: foundation.brand,
      shade_name: foundation.shade_name,
      shade_code: foundation.shade_code,
      product_name: foundation.product_name,
      L_value: foundation.L_value,
      a_value: foundation.a_value,
      b_value: foundation.b_value,
      hex_color: foundation.hex_color,
      undertone: foundation.undertone ?? "",
    });
    setShowPhotoForm(false);
    setShowForm(true);
  }, []);

  const closeManualForm = useCallback(() => {
    setShowForm(false);
    setEditingFoundationId(null);
    setForm(createDefaultManualForm());
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setIsSavingManual(true);
    setListError("");

    const payload = {
      ...form,
      undertone: form.undertone || null,
    };

    try {
      if (editingFoundationId === null) {
        const created = await apiAuthPost<Foundation>(
          "/api/foundations",
          payload,
          token,
        );
        startTransition(() => {
          setAllFoundations((prev) => sortFoundations([...prev, created]));
          closeManualForm();
          if (filterBrand && filterBrand !== created.brand) {
            setFilterBrand(created.brand);
          }
        });
      } else {
        const updated = await apiAuthPut<Foundation>(
          `/api/foundations/${editingFoundationId}`,
          payload,
          token,
        );
        startTransition(() => {
          setAllFoundations((prev) =>
            sortFoundations(
              prev.map((foundation) =>
                foundation.id === editingFoundationId ? updated : foundation,
              ),
            ),
          );
          closeManualForm();
          if (filterBrand && filterBrand !== updated.brand) {
            setFilterBrand(updated.brand);
          }
        });
      }
    } catch {
      setListError(
        editingFoundationId === null
          ? "파운데이션을 저장하지 못했습니다. 다시 시도해주세요."
          : "파운데이션을 수정하지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm("정말 삭제하시겠습니까?")) return;
    setDeletingId(id);
    setListError("");

    try {
      await apiAuthDelete(`/api/foundations/${id}`, token);
      const nextFoundations = allFoundations.filter(
        (foundation) => foundation.id !== id,
      );
      startTransition(() => {
        setAllFoundations(nextFoundations);
        if (editingFoundationId === id) {
          closeManualForm();
        }
      });
    } catch {
      setListError("데이터를 삭제하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setDeletingId(null);
    }
  };

  // Photo analysis handlers
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
  };

  const handlePhotoImageLoad = () => {
    const img = photoImgRef.current;
    const canvas = photoCanvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
  };

  const handlePhotoCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingPatch === null) return;
      const canvas = photoCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const size = 5;
      const data = ctx.getImageData(
        Math.max(0, x - size),
        Math.max(0, y - size),
        size * 2,
        size * 2,
      );
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        count = 0;
      for (let i = 0; i < data.data.length; i += 4) {
        rSum += data.data[i];
        gSum += data.data[i + 1];
        bSum += data.data[i + 2];
        count++;
      }

      const measured: MeasuredPatch = {
        patchIndex: selectingPatch,
        measuredRgb: [
          Math.round(rSum / count),
          Math.round(gSum / count),
          Math.round(bSum / count),
        ],
      };

      setCheckerPatches((prev) => {
        const filtered = prev.filter((p) => p.patchIndex !== selectingPatch);
        return [...filtered, measured];
      });
      setSelectingPatch(null);
    },
    [selectingPatch],
  );

  const handleAnalyzeSwatch = async () => {
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
        "/api/foundations/analyze-swatch",
        formData,
        token,
      );
      setAnalysisResult(result);
    } catch (err: any) {
      setPhotoError(err.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveFromPhoto = async () => {
    if (!photoFile || !token || !analysisResult) return;
    if (!photoMeta.brand || !photoMeta.shade_name) {
      setPhotoError("브랜드와 색상명은 필수 입력 항목입니다.");
      return;
    }
    setPhotoError(null);
    setIsSavingPhoto(true);
    setListError("");

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
        "/api/foundations/from-photo",
        formData,
        token,
      );

      startTransition(() => {
        setAllFoundations((prev) => sortFoundations([...prev, created]));
        setShowPhotoForm(false);
        resetPhotoState();
        if (filterBrand && filterBrand !== created.brand) {
          setFilterBrand(created.brand);
        }
      });
    } catch (err: any) {
      setPhotoError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingPhoto(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-bold mb-2">관리자 로그인</h1>
        <p className="mb-6 text-sm text-gray-500">
          등록, 수정, 삭제를 위해 로그인하세요.
        </p>
        {loginError && (
          <p className="text-red-600 text-sm mb-4">{loginError}</p>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="아이디"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
          <button
            disabled={isLoggingIn}
            className="w-full bg-rose-600 text-white py-2 rounded hover:bg-rose-700 disabled:opacity-50"
          >
            {isLoggingIn ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">파운데이션 데이터 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            브랜드별로 빠르게 확인하고 바로 수정할 수 있습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <select
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            disabled={isLoadingData}
            className="rounded border px-3 py-1.5 text-sm"
          >
            <option value="">전체 브랜드</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => void loadFoundations()}
            disabled={isLoadingData}
            className="rounded border border-gray-200 bg-white px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoadingData ? "동기화 중..." : "새로고침"}
          </button>
          <button
            onClick={() => {
              setShowPhotoForm(!showPhotoForm);
              closeManualForm();
            }}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            사진 등록
          </button>
          <button
            onClick={() => {
              if (showForm && editingFoundationId === null) {
                closeManualForm();
              } else {
                openCreateForm();
              }
            }}
            className="rounded bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700"
          >
            + 직접 등록
          </button>
        </div>
      </div>

      {listError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {listError}
        </div>
      )}

      {/* Photo Analysis Form */}
      {showPhotoForm && (
        <div className="mb-6 rounded-xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-lg font-semibold">사진으로 색상 추출</h2>
          <p className="mb-4 text-sm text-gray-500">
            흰 종이에 바른 파운데이션과 컬러체커가 함께 보이도록 촬영한 사진을
            올리세요.
          </p>

          {photoError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
              {photoError}
            </div>
          )}

          {/* Product metadata */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <input
              placeholder="브랜드 *"
              value={photoMeta.brand}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, brand: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
              required
            />
            <input
              placeholder="제품명"
              value={photoMeta.product_name}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, product_name: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              placeholder="색상명 *"
              value={photoMeta.shade_name}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, shade_name: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
              required
            />
            <input
              placeholder="호수 (예: 21호)"
              value={photoMeta.shade_code}
              onChange={(e) =>
                setPhotoMeta({ ...photoMeta, shade_code: e.target.value })
              }
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Image upload */}
          {!photoPreview && (
            <label className="mb-4 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-indigo-400 sm:p-8">
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <span className="text-gray-500 text-sm">
                사진 선택 (JPEG/PNG, 최대 20MB)
              </span>
            </label>
          )}

          {/* Image preview + ColorChecker calibration */}
          {photoPreview && (
            <div className="grid lg:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {selectingPatch !== null
                    ? `"${COLORCHECKER_REFERENCE[selectingPatch].name}" 패치를 사진에서 클릭하세요`
                    : "필요하면 참조 패치를 고른 뒤 사진에서 같은 칸을 클릭하세요"}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={photoImgRef}
                  src={photoPreview}
                  alt="파운데이션 사진"
                  className="hidden"
                  onLoad={handlePhotoImageLoad}
                />
                <canvas
                  ref={photoCanvasRef}
                  className="max-w-full border rounded cursor-crosshair"
                  style={{ maxHeight: "320px" }}
                  onClick={handlePhotoCanvasClick}
                />
                <button
                  onClick={() => {
                    resetPhotoState();
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                >
                  다른 사진 선택
                </button>
              </div>

              {/* ColorChecker patch grid */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  참조 패치 ({checkerPatches.length}/24)
                </p>
                <div className="grid grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                  {COLORCHECKER_REFERENCE.map((patch, idx) => {
                    const measured = checkerPatches.find(
                      (p) => p.patchIndex === idx,
                    );
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectingPatch(idx)}
                        className={`p-1.5 rounded text-xs border transition ${
                          selectingPatch === idx
                            ? "border-indigo-500 bg-indigo-50"
                            : measured
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-gray-400"
                        }`}
                        title={patch.name}
                      >
                        <div className="text-center truncate text-[10px]">
                          {patch.name}
                        </div>
                        {measured && (
                          <div
                            className="w-5 h-5 rounded mx-auto mt-0.5"
                            style={{
                              backgroundColor: `rgb(${measured.measuredRgb.join(",")})`,
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                {checkerPatches.length > 0 && checkerPatches.length < 3 && (
                  <p className="text-xs text-amber-600 mt-2">
                    색 보정을 적용하려면 패치를 3개 이상 선택하세요.
                  </p>
                )}
                {checkerPatches.length >= 3 && (
                  <p className="text-xs text-green-600 mt-2">
                    패치 {checkerPatches.length}개 선택됨. 색 보정이 적용됩니다.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Analysis result preview */}
          {analysisResult && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-semibold mb-3">추출 결과</h3>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-lg shadow-inner border"
                  style={{ backgroundColor: analysisResult.hex_color }}
                />
                <div className="text-sm">
                  <p className="font-mono">
                    L*={analysisResult.L_value} a*={analysisResult.a_value} b*=
                    {analysisResult.b_value}
                  </p>
                  <p className="text-gray-500">
                    HEX: {analysisResult.hex_color} | 언더톤:{" "}
                    {analysisResult.undertone}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {photoFile && !analysisResult && (
              <button
                onClick={handleAnalyzeSwatch}
                disabled={analyzing}
                className="bg-indigo-600 text-white px-5 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {analyzing ? "추출 중..." : "색상 추출"}
              </button>
            )}
            {analysisResult && (
              <>
                <button
                  onClick={handleSaveFromPhoto}
                  disabled={isSavingPhoto}
                  className="bg-green-600 text-white px-5 py-2 rounded text-sm hover:bg-green-700"
                >
                  {isSavingPhoto ? "저장 중..." : "DB에 저장"}
                </button>
                <button
                  onClick={handleAnalyzeSwatch}
                  disabled={analyzing}
                  className="bg-gray-200 text-gray-700 px-5 py-2 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
                >
                  {analyzing ? "분석 중..." : "다시 분석"}
                </button>
              </>
            )}
            <button
              onClick={() => {
                setShowPhotoForm(false);
                resetPhotoState();
              }}
              className="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Manual Form */}
      {showForm && (
        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {editingFoundationId === null ? "직접 입력" : "파운데이션 수정"}
            </h2>
            <button
              type="button"
              onClick={closeManualForm}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              닫기
            </button>
          </div>
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <input
              placeholder="브랜드"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className="border rounded px-3 py-2"
              required
            />
            <input
              placeholder="색상명"
              value={form.shade_name}
              onChange={(e) => setForm({ ...form, shade_name: e.target.value })}
              className="border rounded px-3 py-2"
              required
            />
            <input
              placeholder="호수 (예: 21호)"
              value={form.shade_code}
              onChange={(e) => setForm({ ...form, shade_code: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="L* 값"
              type="number"
              step="0.01"
              value={form.L_value}
              onChange={(e) =>
                setForm({ ...form, L_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="a* 값"
              type="number"
              step="0.01"
              value={form.a_value}
              onChange={(e) =>
                setForm({ ...form, a_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="b* 값"
              type="number"
              step="0.01"
              value={form.b_value}
              onChange={(e) =>
                setForm({ ...form, b_value: parseFloat(e.target.value) || 0 })
              }
              className="border rounded px-3 py-2"
            />
            <input
              placeholder="HEX (#ff0000)"
              value={form.hex_color}
              onChange={(e) => setForm({ ...form, hex_color: e.target.value })}
              className="border rounded px-3 py-2"
            />
            <select
              value={form.undertone}
              onChange={(e) => setForm({ ...form, undertone: e.target.value })}
              className="border rounded px-3 py-2"
            >
              <option value="">비워두기</option>
              <option value="WARM">Warm</option>
              <option value="COOL">Cool</option>
              <option value="NEUTRAL">Neutral</option>
            </select>
            <button
              disabled={isSavingManual}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {isSavingManual
                ? editingFoundationId === null
                  ? "저장 중..."
                  : "수정 중..."
                : editingFoundationId === null
                  ? "저장"
                  : "수정 저장"}
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-gray-500">
          <p>
            {filterBrand ? `"${filterBrand}" ` : ""}파운데이션{" "}
            {foundations.length}개
          </p>
          {isLoadingData && <p>최신 목록을 불러오는 중입니다...</p>}
        </div>
        <div className="divide-y lg:hidden">
          {foundations.map((f) => (
            <div key={f.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start gap-3">
                <div
                  className="h-10 w-10 shrink-0 rounded-lg border"
                  style={{ backgroundColor: f.hex_color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {f.brand}
                  </p>
                  <p className="truncate text-sm text-gray-700">
                    {f.shade_name}
                    {f.shade_code && (
                      <span className="ml-1 text-gray-400">
                        ({f.shade_code})
                      </span>
                    )}
                  </p>
                  {f.product_name && (
                    <p className="truncate text-xs text-gray-400">
                      {f.product_name}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                  {f.undertone || "-"}
                </span>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] text-gray-600">
                L* {f.L_value} / a* {f.a_value} / b* {f.b_value}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-gray-400">{f.hex_color}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openEditForm(f)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    disabled={deletingId === f.id}
                    className="text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingId === f.id ? "삭제 중..." : "삭제"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden lg:block">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left">색상</th>
                <th className="w-[32%] px-4 py-3 text-left">브랜드 / 색상</th>
                <th className="w-[24%] px-4 py-3 text-left">LAB</th>
                <th className="w-20 px-4 py-3 text-left">톤</th>
                <th className="w-28 px-4 py-3 text-left">HEX</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {foundations.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div
                      className="h-8 w-8 rounded border"
                      style={{ backgroundColor: f.hex_color }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate font-medium text-gray-900">
                      {f.brand}
                    </p>
                    <p className="truncate text-gray-700">
                      {f.shade_name}
                      {f.shade_code && (
                        <span className="ml-1 text-gray-400">
                          ({f.shade_code})
                        </span>
                      )}
                    </p>
                    {f.product_name && (
                      <p className="truncate text-xs text-gray-400">
                        {f.product_name}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    L* {f.L_value} / a* {f.a_value} / b* {f.b_value}
                  </td>
                  <td className="px-4 py-3">{f.undertone || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{f.hex_color}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => openEditForm(f)}
                      className="mr-3 text-xs text-blue-600 hover:text-blue-800"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      disabled={deletingId === f.id}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {deletingId === f.id ? "삭제 중..." : "삭제"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoadingData && foundations.length === 0 && (
          <p className="text-center text-gray-400 py-8">
            등록된 파운데이션이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
