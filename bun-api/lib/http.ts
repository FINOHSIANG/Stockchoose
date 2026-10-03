export class ApiError extends Error {
  status: number;
  details: string;

  constructor(status: number, message: string, details = message) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-stockchoose-data-engine": "bun"
};

export function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}) {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BODY_BYTES) {
    return new Response(JSON.stringify({ message: "Bun data API response is too large" }), {
      status: 413,
      headers: {
        ...responseHeaders,
        "content-type": "application/json; charset=utf-8"
      }
    });
  }
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...responseHeaders,
      ...headers
    }
  });
}

export function textResponse(text: string, status = 200, headers: HeadersInit = {}) {
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY_BYTES) {
    return jsonResponse({ message: "Bun data API response is too large" }, 413);
  }
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...responseHeaders,
      ...headers
    }
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse({ message: error.message, details: error.details }, error.status);
  }
  const details = error instanceof Error ? error.message : String(error);
  return jsonResponse({ message: "Bun data API request failed", details }, 502);
}

export async function requestJson<T = unknown>(request: Request): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError(413, "Request body is too large");
  }
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new ApiError(413, "Request body is too large");
    }
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const details = error instanceof Error ? error.message : "invalid JSON";
    throw new ApiError(400, "Invalid JSON request body", details);
  }
}

export function notFound(pathname: string) {
  return jsonResponse({ message: "Bun data API route not found", details: pathname }, 404);
}
