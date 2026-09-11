import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

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
    console.log("Data is provided only by the configured FastAPI API.");
  });
}

startServer().catch((error) => {
  console.error("Frontend server failed to start:", error);
  process.exitCode = 1;
});
