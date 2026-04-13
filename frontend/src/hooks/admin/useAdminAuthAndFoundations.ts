"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";

import {
  apiAuthDelete,
  apiAuthPost,
  apiAuthPut,
  apiFormPost,
  apiGet,
} from "@/lib/api";
import type {
  ActiveAdminPanel,
  ManualFoundationFormValues,
} from "@/components/admin/types";
import { createDefaultManualForm } from "@/components/admin/types";
import type { Foundation } from "@/types";

type UseAdminAuthAndFoundationsArgs = {
  activePanel: ActiveAdminPanel;
  setActivePanel: Dispatch<SetStateAction<ActiveAdminPanel>>;
};

function isManualPanel(panel: ActiveAdminPanel): boolean {
  return panel === "manual-create" || panel === "manual-edit";
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
  return Array.from(new Set(items.map((item) => item.brand))).sort((left, right) =>
    left.localeCompare(right, "ko"),
  );
}

export function useAdminAuthAndFoundations({
  activePanel,
  setActivePanel,
}: UseAdminAuthAndFoundationsArgs) {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [allFoundations, setAllFoundations] = useState<Foundation[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [listError, setListError] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [editingFoundationId, setEditingFoundationId] = useState<number | null>(
    null,
  );
  const [manualForm, setManualForm] = useState<ManualFoundationFormValues>(
    createDefaultManualForm,
  );
  const [isSavingManual, setIsSavingManual] = useState(false);

  const brands = buildBrandList(allFoundations);
  const foundations = filterBrand
    ? allFoundations.filter((foundation) => foundation.brand === filterBrand)
    : allFoundations;

  const resetManualState = useCallback(() => {
    setEditingFoundationId(null);
    setManualForm(createDefaultManualForm());
    setIsSavingManual(false);
  }, []);

  const refreshFoundations = useCallback(async () => {
    setIsLoadingData(true);
    setListError("");

    try {
      const foundationList = await apiGet<Foundation[]>("/foundations");
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

  useEffect(() => {
    if (token) {
      void refreshFoundations();
    }
  }, [token, refreshFoundations]);

  useEffect(() => {
    if (
      filterBrand &&
      !allFoundations.some((foundation) => foundation.brand === filterBrand)
    ) {
      setFilterBrand("");
    }
  }, [allFoundations, filterBrand]);

  useEffect(() => {
    if (!isManualPanel(activePanel)) {
      resetManualState();
    }
  }, [activePanel, resetManualState]);

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoginError("");
      setIsLoggingIn(true);

      try {
        const data = await apiFormPost<{ access_token: string }>(
          "/auth/login",
          new URLSearchParams({ username, password }),
        );
        setToken(data.access_token);
      } catch {
        setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
      } finally {
        setIsLoggingIn(false);
      }
    },
    [password, username],
  );

  const updateManualField = useCallback(
    <Key extends keyof ManualFoundationFormValues>(
      key: Key,
      value: ManualFoundationFormValues[Key],
    ) => {
      setManualForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const toggleCreatePanel = useCallback(() => {
    if (activePanel === "manual-create") {
      setActivePanel("none");
      return;
    }

    setEditingFoundationId(null);
    setManualForm(createDefaultManualForm());
    setActivePanel("manual-create");
  }, [activePanel, setActivePanel]);

  const openEditPanel = useCallback(
    (foundation: Foundation) => {
      setEditingFoundationId(foundation.id);
      setManualForm({
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
      setActivePanel("manual-edit");
    },
    [setActivePanel],
  );

  const closeManualPanel = useCallback(() => {
    setActivePanel("none");
  }, [setActivePanel]);

  const integrateCreatedFoundation = useCallback(
    (created: Foundation) => {
      startTransition(() => {
        setAllFoundations((current) => sortFoundations([...current, created]));
        if (filterBrand && filterBrand !== created.brand) {
          setFilterBrand(created.brand);
        }
      });
    },
    [filterBrand],
  );

  const handleManualSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!token) return;

      setIsSavingManual(true);
      setListError("");

      const payload = {
        ...manualForm,
        undertone: manualForm.undertone || null,
      };

      try {
        if (editingFoundationId === null) {
          const created = await apiAuthPost<Foundation>(
            "/foundations",
            payload,
            token,
          );
          startTransition(() => {
            setAllFoundations((current) => sortFoundations([...current, created]));
            setActivePanel("none");
            if (filterBrand && filterBrand !== created.brand) {
              setFilterBrand(created.brand);
            }
          });
          return;
        }

        const updated = await apiAuthPut<Foundation>(
          `/foundations/${editingFoundationId}`,
          payload,
          token,
        );
        startTransition(() => {
          setAllFoundations((current) =>
            sortFoundations(
              current.map((foundation) =>
                foundation.id === editingFoundationId ? updated : foundation,
              ),
            ),
          );
          setActivePanel("none");
          if (filterBrand && filterBrand !== updated.brand) {
            setFilterBrand(updated.brand);
          }
        });
      } catch {
        setListError(
          editingFoundationId === null
            ? "파운데이션을 저장하지 못했습니다. 다시 시도해주세요."
            : "파운데이션을 수정하지 못했습니다. 다시 시도해주세요.",
        );
      } finally {
        setIsSavingManual(false);
      }
    },
    [editingFoundationId, filterBrand, manualForm, setActivePanel, token],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!token || !confirm("정말 삭제하시겠습니까?")) return;

      setDeletingId(id);
      setListError("");

      try {
        await apiAuthDelete(`/foundations/${id}`, token);
        startTransition(() => {
          setAllFoundations((current) =>
            current.filter((foundation) => foundation.id !== id),
          );
          if (editingFoundationId === id) {
            setActivePanel("none");
          }
        });
      } catch {
        setListError("데이터를 삭제하지 못했습니다. 다시 시도해주세요.");
      } finally {
        setDeletingId(null);
      }
    },
    [editingFoundationId, setActivePanel, token],
  );

  return {
    auth: {
      token,
      username,
      password,
      loginError,
      isLoggingIn,
      updateUsername: setUsername,
      updatePassword: setPassword,
      handleLogin,
    },
    foundations: {
      brands,
      foundations,
      filterBrand,
      isLoadingData,
      listError,
      deletingId,
      updateFilterBrand: setFilterBrand,
      refreshFoundations,
      handleDelete,
      integrateCreatedFoundation,
    },
    manual: {
      editingFoundationId,
      form: manualForm,
      isOpen: isManualPanel(activePanel),
      isCreateOpen: activePanel === "manual-create",
      isSavingManual,
      toggleCreatePanel,
      openEditPanel,
      closeManualPanel,
      updateManualField,
      handleManualSubmit,
    },
  };
}
