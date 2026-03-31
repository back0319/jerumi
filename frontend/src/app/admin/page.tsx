"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiAuthPost, apiAuthDelete } from "@/lib/api";
import type { Foundation } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [foundations, setFoundations] = useState<Foundation[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [filterBrand, setFilterBrand] = useState<string>("");

  // New foundation form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    brand: "",
    shade_name: "",
    shade_code: "",
    product_name: "",
    L_value: 0,
    a_value: 0,
    b_value: 0,
    hex_color: "#000000",
    undertone: "NEUTRAL",
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password }),
      });
      if (!res.ok) throw new Error("인증 실패");
      const data = await res.json();
      setToken(data.access_token);
    } catch {
      setLoginError("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  const loadData = useCallback(async () => {
    const b = await apiGet<string[]>("/api/foundations/brands");
    setBrands(b);
    const url = filterBrand
      ? `/api/foundations?brand=${encodeURIComponent(filterBrand)}`
      : "/api/foundations";
    const f = await apiGet<Foundation[]>(url);
    setFoundations(f);
  }, [filterBrand]);

  useEffect(() => {
    if (token) loadData();
  }, [token, loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await apiAuthPost("/api/foundations", form, token);
    setShowForm(false);
    loadData();
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm("정말 삭제하시겠습니까?")) return;
    await apiAuthDelete(`/api/foundations/${id}`, token);
    loadData();
  };

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-20 bg-white rounded-xl p-8 shadow-sm">
        <h1 className="text-xl font-bold mb-6">관리자 로그인</h1>
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
          <button className="w-full bg-rose-600 text-white py-2 rounded hover:bg-rose-700">
            로그인
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">파운데이션 DB 관리</h1>
        <div className="flex gap-3">
          <select
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">전체 브랜드</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-rose-600 text-white px-4 py-1.5 rounded text-sm hover:bg-rose-700"
          >
            + 새 제품 추가
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-xl p-6 shadow-sm mb-6 grid grid-cols-3 gap-4"
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
            <option value="WARM">Warm</option>
            <option value="COOL">Cool</option>
            <option value="NEUTRAL">Neutral</option>
          </select>
          <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            저장
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">색상</th>
              <th className="px-4 py-3 text-left">브랜드</th>
              <th className="px-4 py-3 text-left">이름</th>
              <th className="px-4 py-3 text-left">L*</th>
              <th className="px-4 py-3 text-left">a*</th>
              <th className="px-4 py-3 text-left">b*</th>
              <th className="px-4 py-3 text-left">언더톤</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {foundations.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div
                    className="w-8 h-8 rounded border"
                    style={{ backgroundColor: f.hex_color }}
                  />
                </td>
                <td className="px-4 py-3">{f.brand}</td>
                <td className="px-4 py-3">
                  {f.shade_name}
                  {f.shade_code && (
                    <span className="text-gray-400 ml-1">({f.shade_code})</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono">{f.L_value}</td>
                <td className="px-4 py-3 font-mono">{f.a_value}</td>
                <td className="px-4 py-3 font-mono">{f.b_value}</td>
                <td className="px-4 py-3">{f.undertone}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {foundations.length === 0 && (
          <p className="text-center text-gray-400 py-8">
            등록된 파운데이션이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
