/**
 * Predict IQ — Vercel /api proxy tests.
 *
 * The handler is imported and invoked exactly the way Vercel invokes it (a Web
 * `Request` in, a Web `Response` out), against a real local HTTP backend. This
 * covers the behaviours that production depends on without needing a Vercel
 * deployment.
 *
 * Run: npm run test:proxy
 */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import handler from "../../api/index";

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type BackendMode = "ok" | "ready-unavailable" | "validation-error";

let captured: CapturedRequest | null = null;
let backendMode: BackendMode = "ok";

const backend = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    captured = {
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };

    if (backendMode === "ready-unavailable") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end('{"status":"not_ready"}');
      return;
    }
    if (backendMode === "validation-error") {
      res.writeHead(422, { "content-type": "application/json" });
      res.end('{"detail":[{"loc":["body","rpm"],"msg":"Input should be a valid number"}]}');
      return;
    }

    // Deliberately exercise header relay: two cookies, a custom header, and a
    // hop-by-hop header that must not reach the browser.
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("set-cookie", [
      "predictiq_session=one; Path=/; HttpOnly",
      "predictiq_workspace=two; Path=/",
    ]);
    res.setHeader("x-request-id", "req-from-backend");
    res.setHeader("keep-alive", "timeout=5");
    res.end(JSON.stringify({ ok: true, method: req.method, url: req.url }));
  });
});

const VERCEL_ORIGIN = "https://predictiq-neon.vercel.app";

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function lastBackendRequest(): CapturedRequest {
  assert.ok(captured, "the backend should have received a request");
  return captured as CapturedRequest;
}

async function callProxy(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  captured = null;
  return handler.fetch(new Request(`${VERCEL_ORIGIN}${pathAndQuery}`, init));
}

await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
const backendPort = (backend.address() as AddressInfo).port;
const backendOrigin = `http://127.0.0.1:${backendPort}`;
process.env.BACKEND_ORIGIN = backendOrigin;

const checks: Array<[string, () => Promise<void>]> = [
  [
    "module initializes with the Web fetch signature",
    async () => {
      assert.equal(typeof handler, "object");
      assert.equal(typeof handler.fetch, "function");
    },
  ],
  [
    "GET /api/health is forwarded to /api/health",
    async () => {
      const response = await callProxy("/api/health");
      assert.equal(response.status, 200);
      assert.equal(lastBackendRequest().method, "GET");
      assert.equal(lastBackendRequest().url, "/api/health");
      assert.equal((await response.json()).url, "/api/health");
    },
  ],
  [
    "GET /api/ready preserves the backend 503 status and body",
    async () => {
      backendMode = "ready-unavailable";
      const response = await callProxy("/api/ready");
      assert.equal(response.status, 503);
      assert.equal(lastBackendRequest().url, "/api/ready");
      assert.deepEqual(await response.json(), { status: "not_ready" });
      backendMode = "ok";
    },
  ],
  [
    "GET /api/machines forwards Authorization, X-Organization-Id and Cookie",
    async () => {
      const response = await callProxy("/api/machines", {
        headers: {
          authorization: "Bearer test-access-token",
          "x-organization-id": "11111111-2222-3333-4444-555555555555",
          cookie: "predictiq_session=abc",
        },
      });
      assert.equal(response.status, 200);
      const seen = lastBackendRequest();
      assert.equal(seen.url, "/api/machines");
      assert.equal(seen.headers.authorization, "Bearer test-access-token");
      assert.equal(
        seen.headers["x-organization-id"],
        "11111111-2222-3333-4444-555555555555",
      );
      assert.equal(seen.headers.cookie, "predictiq_session=abc");
    },
  ],
  [
    "query strings survive unchanged",
    async () => {
      const pathAndQuery =
        "/api/machines/M001/history?limit=2&start_time=2026-11-13T00%3A00%3A00Z";
      const response = await callProxy(pathAndQuery);
      assert.equal(response.status, 200);
      assert.equal(lastBackendRequest().url, pathAndQuery);
    },
  ],
  [
    "POST body and content-type are forwarded byte-for-byte",
    async () => {
      const payload = JSON.stringify({
        device_id: "ESP32_001",
        machine_id: "TEST-001",
        temperature: 71.5,
        vibration: 2.25,
        current: 8.5,
        rpm: 1440,
        timestamp: "2026-11-13T10:00:00Z",
        source: "WOKWI",
      });
      const response = await callProxy("/api/sensor-data", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-access-token" },
        body: payload,
      });
      assert.equal(response.status, 200);
      const seen = lastBackendRequest();
      assert.equal(seen.method, "POST");
      assert.equal(seen.url, "/api/sensor-data");
      assert.equal(seen.body, payload);
      assert.equal(seen.headers["content-type"], "application/json");
      assert.equal(seen.headers.authorization, "Bearer test-access-token");
    },
  ],
  [
    "backend validation errors propagate with status and body",
    async () => {
      backendMode = "validation-error";
      const response = await callProxy("/api/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"machine_id":"M001"}',
      });
      assert.equal(response.status, 422);
      assert.equal(lastBackendRequest().url, "/api/predict");
      const body = await response.json();
      assert.equal(body.detail[0].loc[1], "rpm");
      backendMode = "ok";
    },
  ],
  [
    "unreachable upstream returns a structured 502 JSON error",
    async () => {
      process.env.BACKEND_ORIGIN = "http://127.0.0.1:1";
      const response = await callProxy("/api/health");
      assert.equal(response.status, 502);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      const body = await response.json();
      assert.equal(body.error, "upstream_unreachable");
      assert.ok(body.message.length > 0);
      process.env.BACKEND_ORIGIN = backendOrigin;
    },
  ],
  [
    "response headers and multiple Set-Cookie values are preserved",
    async () => {
      const response = await callProxy("/api/health");
      assert.equal(response.headers.get("x-request-id"), "req-from-backend");
      const cookies = setCookieHeaders(response);
      assert.equal(cookies.length, 2);
      assert.ok(cookies.some((cookie) => cookie.startsWith("predictiq_session=one")));
      assert.ok(cookies.some((cookie) => cookie.startsWith("predictiq_workspace=two")));
    },
  ],
  [
    "hop-by-hop response headers are not relayed",
    async () => {
      const response = await callProxy("/api/health");
      assert.equal(response.headers.get("keep-alive"), null);
      assert.equal(response.headers.get("transfer-encoding"), null);
      assert.equal(response.headers.get("connection"), null);
    },
  ],
  [
    "original nested path is preserved under Vercel routing",
    async () => {
      const response = await callProxy("/api/machines/TEST-001/sensor-data?limit=5");
      assert.equal(response.status, 200);
      const seen = lastBackendRequest();
      assert.equal(seen.url, "/api/machines/TEST-001/sensor-data?limit=5");
      assert.ok(!seen.url.includes("__"), "no rewrite bookkeeping leaks upstream");
    },
  ],
  [
    "missing BACKEND_ORIGIN fails closed with structured JSON",
    async () => {
      const saved = process.env.BACKEND_ORIGIN;
      delete process.env.BACKEND_ORIGIN;
      const response = await callProxy("/api/health");
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error, "backend_origin_not_configured");
      process.env.BACKEND_ORIGIN = saved;
    },
  ],
  [
    "non-API paths are not proxied",
    async () => {
      captured = null;
      const response = await handler.fetch(new Request(`${VERCEL_ORIGIN}/dashboard`));
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "not_found");
      assert.equal(captured, null, "the backend must not be contacted");
    },
  ],
];

let failures = 0;
for (const [name, run] of checks) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

await new Promise<void>((resolve) => backend.close(() => resolve()));

if (failures > 0) {
  console.error(`\n${failures} of ${checks.length} proxy checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${checks.length} proxy checks passed.`);
}
