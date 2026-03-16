const http = require("node:http");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const nvimPort = Number(process.env.NVIM_BUFFER_PORT || 4389);

const bufferStore = new Map();
let activeBufferId = null;

function bufferIdFromPayload(payload = {}) {
  if (payload.bufnr !== undefined && payload.bufnr !== null) {
    return String(payload.bufnr);
  }

  if (payload.filePath) {
    return String(payload.filePath);
  }

  return "active";
}

function upsertBuffer(payload) {
  const id = bufferIdFromPayload(payload);
  const now = new Date().toISOString();

  const current = bufferStore.get(id) || {};
  const next = {
    id,
    bufnr: payload.bufnr ?? current.bufnr ?? null,
    filePath: payload.filePath ?? current.filePath ?? null,
    filetype: payload.filetype ?? current.filetype ?? null,
    cursorLine: payload.cursorLine ?? current.cursorLine ?? null,
    content: payload.content ?? current.content ?? "",
    updatedAt: payload.updatedAt ?? now
  };

  bufferStore.set(id, next);
  activeBufferId = id;

  return next;
}

function getActiveBuffer() {
  if (!activeBufferId) return null;
  return bufferStore.get(activeBufferId) || null;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function formatBuffer(buffer) {
  if (!buffer) {
    return "No buffer has been published by Neovim yet.";
  }

  return [
    `id: ${buffer.id}`,
    `bufnr: ${buffer.bufnr ?? "n/a"}`,
    `filePath: ${buffer.filePath ?? "n/a"}`,
    `filetype: ${buffer.filetype ?? "n/a"}`,
    `cursorLine: ${buffer.cursorLine ?? "n/a"}`,
    `updatedAt: ${buffer.updatedAt}`,
    "",
    "content:",
    buffer.content || ""
  ].join("\n");
}

const publishBufferSchema = z.object({
  bufnr: z.number().int().nonnegative().optional(),
  filePath: z.string().optional(),
  filetype: z.string().optional(),
  cursorLine: z.number().int().nonnegative().optional(),
  content: z.string(),
  updatedAt: z.string().optional()
});

const clearBufferSchema = z.object({
  id: z.string().optional(),
  bufnr: z.number().int().nonnegative().optional(),
  filePath: z.string().optional()
});

function startNvimListener() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, {
          ok: true,
          buffers: bufferStore.size,
          activeBufferId
        });
        return;
      }

      if (req.method === "GET" && req.url === "/buffer/list") {
        sendJson(res, 200, {
          ok: true,
          buffers: Array.from(bufferStore.values()),
          activeBufferId
        });
        return;
      }

      if (req.method === "POST" && req.url === "/buffer/update") {
        const payload = await parseJsonBody(req);
        const parsed = publishBufferSchema.safeParse(payload);

        if (!parsed.success) {
          sendJson(res, 400, {
            ok: false,
            error: parsed.error.issues.map((issue) => issue.message).join("; ")
          });
          return;
        }

        const buffer = upsertBuffer(parsed.data);
        sendJson(res, 200, { ok: true, buffer });
        return;
      }

      if (req.method === "POST" && req.url === "/buffer/clear") {
        const payload = await parseJsonBody(req);
        const parsed = clearBufferSchema.safeParse(payload);

        if (!parsed.success) {
          sendJson(res, 400, {
            ok: false,
            error: parsed.error.issues.map((issue) => issue.message).join("; ")
          });
          return;
        }

        const id = parsed.data.id || bufferIdFromPayload(parsed.data);

        if (!id || id === "active") {
          bufferStore.clear();
          activeBufferId = null;
          sendJson(res, 200, { ok: true, cleared: "all" });
          return;
        }

        const existed = bufferStore.delete(id);
        if (activeBufferId === id) {
          activeBufferId = null;
        }

        sendJson(res, 200, { ok: true, cleared: id, existed });
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: "Route not found"
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  server.listen(nvimPort, () => {
    console.error(`[nvim-mcp] Neovim buffer listener on http://127.0.0.1:${nvimPort}`);
  });

  return server;
}

async function startMcpServer() {
  const server = new McpServer({
    name: "nvim-buffer-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "nvim_get_active_buffer",
    {
      title: "Get Active Neovim Buffer",
      description: "Returns the latest buffer published by Neovim.",
      inputSchema: {}
    },
    async () => {
      const buffer = getActiveBuffer();

      return {
        content: [{ type: "text", text: formatBuffer(buffer) }],
        structuredContent: { buffer }
      };
    }
  );

  server.registerTool(
    "nvim_get_buffer",
    {
      title: "Get Specific Neovim Buffer",
      description: "Returns one tracked buffer by id, bufnr, or path.",
      inputSchema: {
        id: z.string().optional(),
        bufnr: z.number().int().nonnegative().optional(),
        filePath: z.string().optional()
      }
    },
    async ({ id, bufnr, filePath }) => {
      const lookupId = id || bufferIdFromPayload({ bufnr, filePath });
      const buffer = bufferStore.get(lookupId) || null;

      return {
        content: [{ type: "text", text: formatBuffer(buffer) }],
        structuredContent: { lookupId, buffer }
      };
    }
  );

  server.registerTool(
    "nvim_list_buffers",
    {
      title: "List Neovim Buffers",
      description: "Lists all buffers currently published by Neovim.",
      inputSchema: {}
    },
    async () => {
      const buffers = Array.from(bufferStore.values());
      const text = buffers.length
        ? buffers
            .map(
              (buffer) =>
                `- ${buffer.id} (${buffer.filetype || "unknown"}) ${buffer.filePath || ""}`
            )
            .join("\n")
        : "No buffers are tracked yet.";

      return {
        content: [{ type: "text", text }],
        structuredContent: { buffers, activeBufferId }
      };
    }
  );

  server.registerTool(
    "nvim_publish_buffer",
    {
      title: "Publish Neovim Buffer",
      description: "Publishes or updates a Neovim buffer in this MCP server.",
      inputSchema: {
        bufnr: z.number().int().nonnegative().optional(),
        filePath: z.string().optional(),
        filetype: z.string().optional(),
        cursorLine: z.number().int().nonnegative().optional(),
        content: z.string(),
        updatedAt: z.string().optional()
      }
    },
    async (payload) => {
      const buffer = upsertBuffer(payload);

      return {
        content: [{ type: "text", text: `Updated buffer ${buffer.id}` }],
        structuredContent: { buffer }
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[nvim-mcp] MCP stdio transport connected");
}

async function main() {
  startNvimListener();
  await startMcpServer();
}

main().catch((error) => {
  console.error("[nvim-mcp] Fatal error:", error);
  process.exit(1);
});
