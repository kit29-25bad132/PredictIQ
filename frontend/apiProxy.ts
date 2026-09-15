/**
 * Predict IQ - /api reverse proxy for the Node frontend server.
 *
 * Vite env vars (VITE_API_URL) are BUILD-TIME values: they cannot be changed
 * from a runtime environment once the bundle exists. Instead of baking a URL,
 * the frontend ships with a same-origin API path ("/api") and the Node server
 * proxies those requests to the FastAPI backend identified by BACKEND_ORIGIN.
 *
 * Implemented with Node's built-in http/https modules — no extra runtime
 * dependency beyond express, which the server already requires.
 */

import http from "http";
import https from "https";
import { URL } from "url";
import type { NextFunction, Request, Response } from "express";

export function createApiProxy(backendOrigin: string) {
  const origin = new URL(backendOrigin);
  const transport = origin.protocol === "https:" ? https : http;

  return function proxyApi(req: Request, res: Response, next: NextFunction) {
    // Only /api/* is forwarded to the backend. Everything else falls through
    // to the static SPA bundle (and index.html fallback) served by the server.
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const headers = { ...req.headers, host: origin.host };

    const upstreamReq = transport.request(
      {
        protocol: origin.protocol,
        hostname: origin.hostname,
        port: origin.port || (origin.protocol === "https:" ? 443 : 80),
        // req.originalUrl preserves the full /api/... path including query.
        path: req.originalUrl || req.url,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        if (!upstreamRes.statusCode) {
          res.status(502).json({ error: "Backend returned no status code." });
          upstreamRes.resume();
          return;
        }
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on("error", (err: Error) => {
      // Honest failure: surface upstream unreachability instead of hanging.
      res.status(502).json({ error: `Backend unreachable: ${err.message}` });
    });

    // Stream the request body through; GET/HEAD end immediately.
    req.pipe(upstreamReq);
  };
}
