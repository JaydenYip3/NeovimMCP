export interface Config {
  transport: "http" | "stdio";
  host: string;
  port: number;
  token: string | null;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host);
}

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const envTransport = process.env.NVIM_MCP_TRANSPORT?.toLowerCase();
  let transport: Config["transport"] =
    envTransport === "stdio" ? "stdio" : "http";
  if (argv.includes("--stdio")) transport = "stdio";
  if (argv.includes("--http")) transport = "http";

  const port = Number(process.env.NVIM_MCP_PORT ?? process.env.PORT ?? 4389);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid NVIM_MCP_PORT: ${process.env.NVIM_MCP_PORT}`);
  }

  return {
    transport,
    // Bind all interfaces by default so other devices on the LAN can reach it.
    host: process.env.NVIM_MCP_HOST ?? "0.0.0.0",
    port,
    token: process.env.NVIM_MCP_TOKEN || null,
  };
}
