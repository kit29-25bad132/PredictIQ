/**
 * Predict IQ - Vercel entry point for every /api/* request.
 *
 * vercel.json rewrites "/api/:path*" to this function, which forwards the
 * ORIGINAL request (method, full path, query string, headers and body) to the
 * FastAPI backend named by the runtime BACKEND_ORIGIN variable — the same
 * contract the Express/Docker host implements in apiProxy.ts.
 *
 * BACKEND_ORIGIN is read at request time, never baked into the bundle, so the
 * backend location is changed with an environment variable only.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { forwardApiRequest, resolveProxyTarget } from "../apiProxy";

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const backendOrigin = process.env.BACKEND_ORIGIN;
  if (!backendOrigin) {
    // Honest failure: never silently serve the SPA for an API call.
    sendJson(res, 500, {
      error: "BACKEND_ORIGIN is not set.",
      detail:
        "Set the BACKEND_ORIGIN environment variable to the FastAPI backend origin so /api requests can be forwarded.",
    });
    return;
  }

  let target;
  try {
    target = resolveProxyTarget(backendOrigin);
  } catch {
    sendJson(res, 500, {
      error: "BACKEND_ORIGIN is not a valid origin URL.",
      detail: "BACKEND_ORIGIN must look like https://backend.example.com",
    });
    return;
  }

  forwardApiRequest(req, res, target);
}
