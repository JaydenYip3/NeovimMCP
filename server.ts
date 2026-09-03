#!/usr/bin/env node
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./src/tools/tools.js";
import { startHttpServer } from "./src/http/server.js";
import { isLoopback, loadConfig } from "./src/config.js";

/** Best-effort LAN address, so the startup banner is copy-pasteable. */
function lanAddress(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

const config = loadConfig();
const running = await startHttpServer(config);

const displayHost =
  config.host === "0.0.0.0" || config.host === "::"
    ? (lanAddress() ?? "127.0.0.1")
    : config.host;

console.error(`[MCP] HTTP listening on ${config.host}:${config.port}`);
console.error(`[MCP]   MCP endpoint:   http://${displayHost}:${config.port}/mcp`);
console.error(`[MCP]   Neovim ingest:  http://${displayHost}:${config.port}/nvim/state`);

if (!config.token && !isLoopback(config.host)) {
  console.error(
    `[MCP] WARNING: bound to ${config.host} with no NVIM_MCP_TOKEN set. ` +
      `Anyone on this network can read your buffers. Set NVIM_MCP_TOKEN to require a bearer token.`,
  );
}

if (config.transport === "stdio") {
  const server = new McpServer({ name: "neovim", version: "1.0.0" });
  registerTools(server);
  await server.connect(new StdioServerTransport());
  console.error("[MCP] Also serving MCP over stdio");
}

let closing = false;
const cleanup = (): void => {
  if (closing) return;
  closing = true;
  void running.close().finally(() => process.exit(0));
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
