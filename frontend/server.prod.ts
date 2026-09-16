/**
 * Predict IQ - Production frontend server (built bundle + /api proxy).
 *
 * Runtime architecture (fixes the VITE_API_URL build-time/runtime mismatch):
 * the Vite bundle is built with NO absolute API URL, so the browser calls
 * same-origin "/api/...". This server proxies those requests to BACKEND_ORIGIN
 * (runtime env var, e.g. http://backend:8000 inside Docker). Changing the
 * backend location requires only a container env change — never a rebuild.
 */

import express from "express";
import path from "path";
import { createApiProxy } from "./apiProxy";

const app = express();
const port = Number(process.env.PORT || 3000);
const backendOrigin = process.env.BACKEND_ORIGIN;

if (!backendOrigin) {
  console.error(
    "BACKEND_ORIGIN is not set. The /api proxy cannot forward requests. " +
      "Set it to the FastAPI origin (e.g. http://backend:8000)."
  );
  process.exit(1);
}

app.use(createApiProxy(backendOrigin));

const distDir = path.resolve(process.cwd(), "dist");
app.use(express.static(distDir));
app.get("*", (_request, response) => {
  response.sendFile(path.resolve(distDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Predict IQ frontend available at http://localhost:${port}`);
  console.log(`/api requests are proxied to ${backendOrigin}`);
});
