import { clearAuthSession, getStoredAccessToken } from "@/lib/auth-session";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const renderApiUrl = "https://dms-project-250u.onrender.com/api/v1";

// Ưu tiên URL đã cấu hình trong môi trường (localhost khi dev, domain khi deploy).
// Chỉ fallback về Render khi không có cấu hình.
export const API_URL = configuredApiUrl || renderApiUrl;

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestUrl =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (typeof window === "undefined" || !requestUrl.startsWith(API_URL)) {
    return fetch(input, init);
  }

  const headers = new Headers(
    typeof input === "string" || input instanceof URL ? undefined : input.headers,
  );
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  const token = getStoredAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && token) {
    clearAuthSession(true);
  }
  return response;
}
