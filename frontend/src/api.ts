const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";
const TOKEN_KEY = "internflow.token";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function urlFor(path: string): string {
  return `${API_BASE}${path}`;
}

function authorizationHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseError(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  let message = `Request failed with status ${response.status}`;
  try {
    const data = await response.json();
    detail = data;
    if (typeof data?.detail === "string") {
      message = data.detail;
    } else if (Array.isArray(data?.detail)) {
      message = data.detail
        .map((item: { msg?: string; loc?: unknown[] }) => {
          const field = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
          return field ? `${field}: ${item.msg}` : item.msg || "Invalid value";
        })
        .join("; ");
    } else if (typeof data?.message === "string") {
      message = data.message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
      // ignore
    }
  }
  return new ApiError(message, response.status, detail);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  isForm = false,
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!isForm && options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(urlFor(path), { ...options, headers });
  } catch {
    throw new ApiError(
      "Cannot reach the InternFlow API. Check that the backend is running on port 8000.",
      0,
    );
  }

  if (response.status === 401 && !path.includes("/auth/login")) {
    setToken(null);
    window.dispatchEvent(new Event("internflow:unauthorized"));
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
  upload<T>(path: string, formData: FormData): Promise<T> {
    return request<T>(path, { method: "POST", body: formData }, true);
  },
  async download(path: string, filename?: string): Promise<void> {
    const response = await fetch(urlFor(path), {
      headers: authorizationHeaders(),
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename || "internflow-download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  },
};
