import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "../tools/tools.js";
import {
  applyUpdate,
  detach,
  getActiveInstance,
  list,
  setActive,
  stateUpdateSchema,
} from "../state/store.js";
import type { Config } from "../config.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "neovim", version: "1.0.0" });
  registerTools(server);
  return server;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buf);
  }

  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const alt = req.headers["x-nvim-mcp-token"];
  return typeof alt === "string" ? alt : null;
}

export interface RunningServer {
  server: http.Server;
  close: () => Promise<void>;
}

export async function startHttpServer(config: Config): Promise<RunningServer> {
  // One MCP server + transport per client session, so several devices can be
  // connected at the same time.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handleMcp = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"];
    const existing =
      typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Missing or expired MCP session" },
        id: null,
      });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: {
          code: -32700,
          message: err instanceof Error ? err.message : "Parse error",
        },
        id: null,
      });
      return;
    }

    if (!isInitializeRequest(body)) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: server not initialized for this session",
        },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
        console.error(`[MCP] Session opened: ${id}`);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        console.error(`[MCP] Session closed: ${id}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await createMcpServer().connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const handleIngest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
  ): Promise<void> => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, {
        error: err instanceof Error ? err.message : "Invalid JSON",
      });
      return;
    }

    if (path === "/nvim/state") {
      const parsed = stateUpdateSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, { error: "Invalid payload", issues: parsed.error.issues });
        return;
      }
      const state = applyUpdate(parsed.data);
      sendJson(res, 200, { ok: true, instance: state.instance });
      return;
    }

    const instance = (body as { instance?: unknown })?.instance;
    if (typeof instance !== "string" || !instance) {
      sendJson(res, 400, { error: "instance is required" });
      return;
    }

    if (path === "/nvim/focus") {
      const state = setActive(instance);
      if (!state) {
        sendJson(res, 404, { error: `Unknown instance: ${instance}` });
        return;
      }
      sendJson(res, 200, { ok: true, active: instance });
      return;
    }

    // /nvim/detach
    sendJson(res, 200, { ok: true, removed: detach(instance) });
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "/").split("?")[0];

      try {
        if (path === "/health") {
          sendJson(res, 200, { ok: true, editors: list().length });
          return;
        }

        if (config.token && bearerToken(req) !== config.token) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        if (path === "/mcp") {
          await handleMcp(req, res);
          return;
        }

        if (path === "/nvim/state" && req.method === "GET") {
          sendJson(res, 200, {
            active: getActiveInstance(),
            editors: list(),
          });
          return;
        }

        if (
          path === "/nvim/state" ||
          path === "/nvim/focus" ||
          path === "/nvim/detach"
        ) {
          await handleIngest(req, res, path);
          return;
        }

        sendJson(res, 404, { error: "Not found" });
      } catch (err) {
        console.error(`[MCP] Request failed: ${String(err)}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        } else {
          res.end();
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    server,
    close: async () => {
      for (const transport of sessions.values()) {
        await transport.close().catch(() => {});
      }
      sessions.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
