import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createApiProxy } from "./apiProxy";

const app = express();
const port = Number(process.env.PORT || 3000);

// Same-origin /api requests are proxied to the FastAPI backend so the browser
// never needs to know the backend URL. BACKEND_ORIGIN defaults to local dev.
app.use(createApiProxy(process.env.BACKEND_ORIGIN || "http://localhost:8000"));

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(vite.middlewares);
  app.use(express.static(path.resolve(process.cwd(), "dist")));
  app.get("*", (_request, response) => {
    response.sendFile(path.resolve(process.cwd(), "dist", "index.html"));
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`Predict IQ frontend available at http://localhost:${port}`);
    console.log(`/api requests are proxied to ${process.env.BACKEND_ORIGIN || "http://localhost:8000"}`);
    console.log("Data is provided only by the configured FastAPI API.");
  });
}

startServer().catch((error) => {
  console.error("Frontend server failed to start:", error);
  process.exitCode = 1;
});
