/**
 * Predict IQ — Vercel entry point for every /api/* request.
 *
 * Why this file is self-contained (no local imports):
 * frontend/package.json declares "type": "module", so Vercel loads files in
 * /api as native ES modules. The previous version imported "../apiProxy" —
 * extensionless, and outside the api/ directory — which the Node ESM loader
 * cannot resolve and which Vercel's per-function packaging does not reliably
 * trace. The module failed during initialization, so Vercel answered every
 * /api/* request with FUNCTION_INVOCATION_FAILED. This entry point now uses
 * Vercel's documented Web `fetch` signature and depends only on runtime
 * globals (fetch / Request / Response / Headers / AbortSignal). There is no
 * import graph to resolve, so there is nothing that can fail at load time.
 *
 * Routing: vercel.json rewrites "/api/:path*" to this function (Vercel's
 * documented shared-entry-point pattern). The original path and query string
 * arrive in `request.url` and are forwarded unchanged, so the browser keeps
 * calling same-origin "/api/..." while the FastAPI backend stays behind the
 * runtime BACKEND_ORIGIN variable.
 */

/** Hop-by-hop headers must never be forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Upper bound for one upstream call; well inside a Vercel function's limit. */
const UPSTREAM_TIMEOUT_MS = 25_000;

interface ProxyErrorPayload {
  error: string;
  message: string;
  detail?: Record<string, unknown>;
}

function jsonResponse(status: number, payload: ProxyErrorPayload): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Request headers for the backend.
 *
 * Hop-by-hop headers and `host` are dropped (`fetch` derives Host from the
 * upstream URL), `content-length` is recomputed by the runtime, and
 * `accept-encoding: identity` keeps the backend response uncompressed so it can
 * be relayed byte-for-byte without mismatched Content-Encoding headers.
 */
function upstreamRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name)) return;
    if (name === "host" || name === "content-length") return;
    headers.set(name, value);
  });
  headers.set("accept-encoding", "identity");
  return headers;
}

/**
 * Response headers relayed to the browser.
 *
 * Hop-by-hop headers are dropped; `content-length`/`content-encoding` are
 * dropped because the relayed body is the decoded stream produced by `fetch`.
 * Set-Cookie is copied value-by-value so multiple cookies survive intact.
 */
function downstreamResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name)) return;
    if (name === "content-length" || name === "content-encoding") return;
    if (name === "set-cookie") return;
    headers.set(name, value);
  });

  const withCookieList = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookieList =
    typeof withCookieList.getSetCookie === "function"
      ? withCookieList.getSetCookie()
      : [];
  if (cookieList.length > 0) {
    for (const cookie of cookieList) headers.append("set-cookie", cookie);
  } else {
    const single = upstream.headers.get("set-cookie");
    if (single) headers.append("set-cookie", single);
  }

  return headers;
}

/** Path + query to request from the backend, taken from the original URL. */
function upstreamPath(request: Request): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const path = url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
  return `${path}${url.search}`;
}

/** Map a transport failure onto a structured JSON reply. */
function upstreamFailure(error: unknown): { status: number; payload: ProxyErrorPayload } {
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return {
      status: 504,
      payload: {
        error: "upstream_timeout",
        message: "The backend did not respond in time.",
        detail: { timeout_ms: UPSTREAM_TIMEOUT_MS },
      },
    };
  }

  // Network-layer failures expose their reason as `cause.code` (e.g.
  // ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED). Only the code is surfaced:
  // never the origin, credentials, or upstream headers.
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: string } | null)?.code;
  return {
    status: 502,
    payload: {
      error: "upstream_unreachable",
      message: "The backend could not be reached.",
      ...(code ? { detail: { code } } : {}),
    },
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const backendOrigin = process.env.BACKEND_ORIGIN;
    if (!backendOrigin) {
      // Honest failure: never silently serve the SPA for an API call.
      return jsonResponse(500, {
        error: "backend_origin_not_configured",
        message:
          "BACKEND_ORIGIN is not set, so /api requests cannot be forwarded to the FastAPI backend.",
      });
    }

    let target: URL;
    try {
      target = new URL(backendOrigin);
    } catch {
      return jsonResponse(500, {
        error: "backend_origin_invalid",
        message:
          "BACKEND_ORIGIN is not a valid origin URL (expected e.g. https://backend.example.com).",
      });
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return jsonResponse(500, {
        error: "backend_origin_invalid",
        message:
          "BACKEND_ORIGIN must use the http: or https: scheme (expected e.g. https://backend.example.com).",
      });
    }

    const path = upstreamPath(request);
    if (!path || !path.startsWith("/api")) {
      // Defence in depth: this function only ever proxies the API surface.
      return jsonResponse(404, {
        error: "not_found",
        message: "This route is not proxied. Only /api/* is forwarded to the backend.",
      });
    }

    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    // Buffer the body so the exact bytes are replayed (no stream duplex
    // negotiation in the serverless runtime) and Authorization/cookie headers
    // reach the backend untouched.
    let body: ArrayBuffer | undefined;
    if (hasBody) {
      try {
        body = await request.arrayBuffer();
      } catch {
        return jsonResponse(400, {
          error: "request_body_unreadable",
          message: "The request body could not be read.",
        });
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(new URL(path, target), {
        method,
        headers: upstreamRequestHeaders(request),
        ...(hasBody ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      const { status, payload } = upstreamFailure(error);
      return jsonResponse(status, payload);
    }

    // 204/205/304 and HEAD responses must not carry a body.
    const bodyForbidden =
      method === "HEAD" || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;

    return new Response(bodyForbidden ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: downstreamResponseHeaders(upstream),
    });
  },
};
