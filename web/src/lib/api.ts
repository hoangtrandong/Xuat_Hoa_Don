import { clearAuthSession, getStoredAccessToken } from "@/lib/auth-session";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const renderApiUrl = "https://dms-project-250u.onrender.com/api/v1";

// Ưu tiên URL đã cấu hình trong môi trường (localhost khi dev, domain khi deploy).
// Chỉ fallback về Render khi không có cấu hình.
export const API_URL = configuredApiUrl || renderApiUrl;

function shouldUseSameOriginProxy(requestUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (!requestUrl.startsWith(API_URL)) return false;

  const host = window.location.hostname;
  const isLocalOrLan =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

  const isMixedContent =
    window.location.protocol === "https:" && requestUrl.startsWith("http://");

  // Nếu đang chạy ở localhost / mạng LAN (test điện thoại) mà gọi lên API remote,
  // hoặc trang HTTPS gọi API HTTP -> đi qua Next.js same-origin proxy (/api/proxy)
  // để tránh lỗi CORS (Disallowed CORS origin) và Mixed Content.
  if (isMixedContent) return true;
  if (isLocalOrLan) {
    try {
      const apiHost = new URL(API_URL).hostname;
      if (apiHost !== "localhost" && apiHost !== "127.0.0.1") {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function resolveApiRequestUrl(url: string): string {
  if (shouldUseSameOriginProxy(url)) {
    const rest = url.slice(API_URL.length);
    const qIdx = rest.indexOf("?");
    const rawPath = qIdx >= 0 ? rest.slice(0, qIdx) : rest;
    const rawSearch = qIdx >= 0 ? rest.slice(qIdx + 1) : "";
    const hadTrailingSlash = rawPath.length > 1 && rawPath.endsWith("/");
    const cleanPath = hadTrailingSlash ? rawPath.slice(0, -1) : rawPath;
    const params = new URLSearchParams(rawSearch);
    if (hadTrailingSlash) {
      params.set("_ts", "1");
    }
    const qs = params.toString();
    return `/api/proxy${cleanPath}${qs ? `?${qs}` : ""}`;
  }
  return url;
}

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

  const effectiveUrl = resolveApiRequestUrl(requestUrl);
  const response = await fetch(effectiveUrl, { ...init, headers });
  if (response.status === 401 && token) {
    clearAuthSession(true);
  }
  return response;
}
