// server.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./src/tools/tools.js";
import { disconnectNvim } from "./src/neovim/neovim.js";

const server = new McpServer({ name: "neovim", version: "1.0.0" });

registerTools(server);

const cleanup = () => {
    disconnectNvim();
    process.exit(0);
};

process.on("SIGINT", cleanup); // signify intialize
process.on("SIGTERM", cleanup); // signify termination

const transport = new StdioServerTransport();
await server.connect(transport);
