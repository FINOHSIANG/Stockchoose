export class ApiError extends Error {
  status: number;
  details: string;

  constructor(status: number, message: string, details = message) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-stockchoose-data-engine": "bun",
      ...headers
    }
  });
}

export function textResponse(text: string, status = 200, headers: HeadersInit = {}) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-stockchoose-data-engine": "bun",
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
  try {
    return (await request.json()) as T;
  } catch (error) {
    const details = error instanceof Error ? error.message : "invalid JSON";
    throw new ApiError(400, "Invalid JSON request body", details);
  }
}

export function notFound(pathname: string) {
  return jsonResponse({ message: "Bun data API route not found", details: pathname }, 404);
}

