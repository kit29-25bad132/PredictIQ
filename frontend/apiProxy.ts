/**
 * Predict IQ - /api reverse proxy core.
 *
 * Vite env vars (VITE_API_URL) are BUILD-TIME values: they cannot be changed
 * from a runtime environment once the bundle exists. Instead of baking a URL,
 * the frontend ships with a same-origin API path ("/api") and a proxy
 * forwards those requests to the FastAPI backend identified by BACKEND_ORIGIN.
 *
 * Two hosts share this one implementation:
 *   - Express host (Docker / Node): createApiProxy()   -> server.prod.ts
 *   - Vercel serverless host:       forwardApiRequest() -> api/index.ts
 *
 * Implemented with Node's built-in http/https modules — no extra runtime
 * dependency beyond express, which the Node server already requires.
 */

import http from "http";
import https from "https";
import { URL } from "url";
import type { NextFunction, Request, Response } from "express";

/** Resolved upstream origin a request is forwarded to. */
export interface ProxyTarget {
  protocol: string;
  hostname: string;
  port: number;
  host: string;
}

export function resolveProxyTarget(backendOrigin: string): ProxyTarget {
  const origin = new URL(backendOrigin);
  return {
    protocol: origin.protocol,
    hostname: origin.hostname,
    port: Number(origin.port) || (origin.protocol === "https:" ? 443 : 80),
    host: origin.host,
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  if (res.headersSent) {
    // The upstream response already started streaming: drop the socket rather
    // than corrupt it with a second set of headers.
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

/**
 * Forward one /api/* request to the backend, preserving method, path, query
 * string, headers and body byte-for-byte, and returning the backend's status
 * code, headers and body unchanged.
 *
 * Accepts plain Node http objects, so the same code runs behind Express and
 * inside a Vercel serverless function.
 */
export function forwardApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: ProxyTarget,
): void {
  const transport = target.protocol === "https:" ? https : http;
  // Express exposes the un-trimmed path (with query) as originalUrl; the
  // Vercel function receives the original request URL as req.url.
  const originalUrl = (req as http.IncomingMessage & { originalUrl?: string })
    .originalUrl;
  const headers = { ...req.headers, host: target.host };

  const upstreamReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      // Full /api/... path including query.
      path: originalUrl || req.url || "/",
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      if (!upstreamRes.statusCode) {
        sendJson(res, 502, { error: "Backend returned no status code." });
        upstreamRes.resume();
        return;
      }
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err: Error) => {
    // Honest failure: surface upstream unreachability instead of hanging.
    sendJson(res, 502, { error: `Backend unreachable: ${err.message}` });
  });

  // Stream the request body through; GET/HEAD end immediately.
  req.pipe(upstreamReq);
}

/** Express middleware form used by the Node/Docker frontend server. */
export function createApiProxy(backendOrigin: string) {
  const target = resolveProxyTarget(backendOrigin);

  return function proxyApi(req: Request, res: Response, next: NextFunction) {
    // Only /api/* is forwarded to the backend. Everything else falls through
    // to the static SPA bundle (and index.html fallback) served by the server.
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    forwardApiRequest(req, res, target);
  };
}
