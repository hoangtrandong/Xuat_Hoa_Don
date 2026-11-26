import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_API_URL = (
  process.env.BACKEND_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "https://dms-project-250u.onrender.com/api/v1"
).replace(/\/$/, "");

export const dynamic = "force-dynamic";

async function proxyRequest(request: NextRequest) {
  // Preserve exact path (including trailing slash if present) and query string
  const prefix = "/api/proxy";
  const rawPathname = request.nextUrl.pathname;
  const subPath = rawPathname.startsWith(prefix)
    ? rawPathname.slice(prefix.length)
    : rawPathname;
  const search = request.nextUrl.search || "";
  const targetUrl = `${UPSTREAM_API_URL}${subPath}${search}`;

  const forwardHeaders = new Headers();
  const allowedRequestHeaders = [
    "authorization",
    "content-type",
    "accept",
    "accept-language",
    "x-distributor-id",
    "x-distributor-code",
  ];
  for (const name of allowedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) forwardHeaders.set(name, value);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body,
      redirect: "follow",
    });

    const responseHeaders = new Headers();
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);
    const contentDisposition = upstreamResponse.headers.get("content-disposition");
    if (contentDisposition) {
      responseHeaders.set("content-disposition", contentDisposition);
    }

    const responseBody = await upstreamResponse.arrayBuffer();
    return new NextResponse(responseBody, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream proxy error";
    return NextResponse.json(
      { detail: `Không thể kết nối máy chủ API (${targetUrl}): ${message}` },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request);
}
export async function POST(request: NextRequest) {
  return proxyRequest(request);
}
export async function PUT(request: NextRequest) {
  return proxyRequest(request);
}
export async function PATCH(request: NextRequest) {
  return proxyRequest(request);
}
export async function DELETE(request: NextRequest) {
  return proxyRequest(request);
}
export async function HEAD(request: NextRequest) {
  return proxyRequest(request);
}
