const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
const API_TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "/api";
  if (normalized === "/") return "";
  return normalized.replace(/\/+$/, "");
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

async function readApiError(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    detail = payload.detail;
  } catch {
    // Non-JSON server responses are mapped to a stable user-facing message.
  }

  if (
    response.status >= 400 &&
    response.status < 500 &&
    typeof detail === "string" &&
    detail.length <= 300
  ) {
    return new ApiError(detail, response.status);
  }

  const message =
    response.status === 401
      ? "로그인이 만료되었거나 권한이 없습니다. 다시 로그인해주세요."
      : response.status === 413
        ? "파일 크기가 너무 큽니다. 더 작은 파일로 다시 시도해주세요."
        : response.status === 422
          ? "입력값을 확인한 뒤 다시 시도해주세요."
          : response.status >= 500
            ? "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
            : "요청을 처리하지 못했습니다. 다시 시도해주세요.";
  return new ApiError(message, response.status);
}

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) throw await readApiError(response);
  return response;
}

export function prewarmApi(path: string): void {
  void fetch(buildApiUrl(path), {
    method: "GET",
    cache: "no-store",
    keepalive: true,
  }).catch(() => undefined);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다. 다시 시도해주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return res.json();
}

export async function apiFormPost<T>(
  path: string,
  body: URLSearchParams,
  headers?: HeadersInit
): Promise<T> {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  }));
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await requireOk(
    await fetchWithTimeout(buildApiUrl(path), { cache: "no-store" }),
  );
  return res.json();
}

export async function apiAuthPost<T>(
  path: string,
  body: unknown,
  token: string
): Promise<T> {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }));
  return res.json();
}

export async function apiAuthPostFormData<T>(
  path: string,
  formData: FormData,
  token: string
): Promise<T> {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  }));
  return res.json();
}

export async function apiAuthDelete(path: string, token: string) {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }));
  return res.json();
}

export async function apiAuthPut<T>(
  path: string,
  body: unknown,
  token: string
): Promise<T> {
  const res = await requireOk(await fetchWithTimeout(buildApiUrl(path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }));
  return res.json();
}
