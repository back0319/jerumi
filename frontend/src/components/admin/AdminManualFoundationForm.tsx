import type { FormEvent } from "react";

import type { ManualFoundationFormValues } from "@/components/admin/types";

type AdminManualFoundationFormProps = {
  editingFoundationId: number | null;
  form: ManualFoundationFormValues;
  isSavingManual: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFieldChange: <Key extends keyof ManualFoundationFormValues>(
    key: Key,
    value: ManualFoundationFormValues[Key],
  ) => void;
};

export function AdminManualFoundationForm({
  editingFoundationId,
  form,
  isSavingManual,
  onClose,
  onSubmit,
  onFieldChange,
}: AdminManualFoundationFormProps) {
  const updateField = <Key extends keyof ManualFoundationFormValues>(
    key: Key,
    value: ManualFoundationFormValues[Key],
  ) => {
    onFieldChange(key, value);
  };

  return (
    <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {editingFoundationId === null ? "직접 입력" : "파운데이션 수정"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          닫기
        </button>
      </div>
      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        <input
          placeholder="브랜드"
          value={form.brand}
          onChange={(event) => updateField("brand", event.target.value)}
          className="rounded border px-3 py-2"
          required
        />
        <input
          placeholder="색상명"
          value={form.shade_name}
          onChange={(event) => updateField("shade_name", event.target.value)}
          className="rounded border px-3 py-2"
          required
        />
        <input
          placeholder="호수 (예: 21호)"
          value={form.shade_code}
          onChange={(event) => updateField("shade_code", event.target.value)}
          className="rounded border px-3 py-2"
        />
        <input
          placeholder="L* 값"
          type="number"
          step="0.01"
          value={form.L_value}
          onChange={(event) =>
            updateField("L_value", parseFloat(event.target.value) || 0)
          }
          className="rounded border px-3 py-2"
        />
        <input
          placeholder="a* 값"
          type="number"
          step="0.01"
          value={form.a_value}
          onChange={(event) =>
            updateField("a_value", parseFloat(event.target.value) || 0)
          }
          className="rounded border px-3 py-2"
        />
        <input
          placeholder="b* 값"
          type="number"
          step="0.01"
          value={form.b_value}
          onChange={(event) =>
            updateField("b_value", parseFloat(event.target.value) || 0)
          }
          className="rounded border px-3 py-2"
        />
        <input
          placeholder="HEX (#ff0000)"
          value={form.hex_color}
          onChange={(event) => updateField("hex_color", event.target.value)}
          className="rounded border px-3 py-2"
        />
        <select
          value={form.undertone}
          onChange={(event) => updateField("undertone", event.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">비워두기</option>
          <option value="WARM">Warm</option>
          <option value="COOL">Cool</option>
          <option value="NEUTRAL">Neutral</option>
        </select>
        <button
          disabled={isSavingManual}
          className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
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
  );
}
