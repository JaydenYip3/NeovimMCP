import net from "net";
import fs from "fs";
import { attach, NeovimClient } from "neovim";

let socket: net.Socket | null = null;
let nvimInstance: NeovimClient | null = null;
let currentSocketPath: string | null = null;
let activeSocketPath: string | null = null;
let registrationServer: net.Server | null = null;

const REGISTRATION_SOCKET = process.env.NVIM_MCP_SOCKET || "/tmp/nvim-mcp.sock";

/**
 * Starts the registration server that listens for Neovim instances.
 * Neovim sends its socket path when it gains focus.
 */
export function startRegistrationServer(): void {
  // Remove stale socket file if it exists
  if (fs.existsSync(REGISTRATION_SOCKET)) {
    fs.unlinkSync(REGISTRATION_SOCKET);
  }

  registrationServer = net.createServer((conn) => {
    console.error("[MCP] New connection to registration server");

    conn.on("data", (data) => {
      const socketPath = data.toString().trim();
      console.error(`[MCP] Received socket path: "${socketPath}"`);

      if (socketPath && fs.existsSync(socketPath)) {
        activeSocketPath = socketPath;
        console.error(`[MCP] Active Neovim set to: ${socketPath}`);
      } else {
        console.error(`[MCP] Socket path invalid or doesn't exist`);
      }
    });
  });

  registrationServer.on("error", (err) => {
    console.error(`Registration server error: ${err.message}`);
  });

  registrationServer.listen(REGISTRATION_SOCKET, () => {
    fs.chmodSync(REGISTRATION_SOCKET, 0o777);
    console.error(
      `[MCP] Registration server listening on ${REGISTRATION_SOCKET}`,
    );
  });
}

/**
 * Connects to a specific Neovim socket.
 */
function connectToSocket(socketPath: string): Promise<NeovimClient> {
  return new Promise((resolve, reject) => {
    socket = net.createConnection(socketPath);

    socket.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to connect to Neovim at ${socketPath}: ${err.message}`,
        ),
      );
    });

    socket.on("close", () => {
      socket = null;
      nvimInstance = null;
      currentSocketPath = null;
    });

    socket.on("connect", async () => {
      try {
        const nvim = await attach({
          reader: socket!,
          writer: socket!,
        });
        resolve(nvim);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to attach to Neovim: ${message}`));
      }
    });
  });
}

/**
 * Connects to the currently active Neovim instance.
 * Automatically reconnects if the focused Neovim instance has changed.
 */
export async function getNvim(): Promise<NeovimClient> {
  console.error(`[MCP] getNvim called`);
  console.error(`[MCP]   activeSocketPath: ${activeSocketPath}`);
  console.error(`[MCP]   currentSocketPath: ${currentSocketPath}`);

  if (!activeSocketPath) {
    throw new Error(
      "No active Neovim found.\n" +
        "Make sure Neovim is configured to register on focus:\n" +
        `  1. Start Neovim with: nvim --listen /tmp/nvim-$$.sock\n` +
        `  2. Add FocusGained autocmd to connect to ${REGISTRATION_SOCKET}`,
    );
  }

  if (!fs.existsSync(activeSocketPath)) {
    activeSocketPath = null;
    throw new Error(
      "Neovim socket no longer exists.\n" +
        "The Neovim instance that was focused may have closed.\n" +
        "Focus a running Neovim instance to register it.",
    );
  }

  // If socket path changed, clean up old connection
  if (currentSocketPath && currentSocketPath !== activeSocketPath) {
    console.error(`[MCP] Socket changed, reconnecting...`);
    const oldSocket = socket;
    socket = null;
    nvimInstance = null;
    currentSocketPath = null;
    if (oldSocket) {
      oldSocket.removeAllListeners();
      oldSocket.destroy();
    }
  }

  // Return cached instance if still connected to the same socket
  if (nvimInstance && currentSocketPath === activeSocketPath) {
    console.error(`[MCP] Returning cached instance`);
    return nvimInstance;
  }

  // Connect to the active socket
  console.error(`[MCP] Connecting to ${activeSocketPath}`);
  nvimInstance = await connectToSocket(activeSocketPath);
  currentSocketPath = activeSocketPath;
  return nvimInstance;
}

export function disconnectNvim(): void {
  const oldSocket = socket;
  socket = null;
  nvimInstance = null;
  currentSocketPath = null;
  activeSocketPath = null;

  if (oldSocket) {
    oldSocket.removeAllListeners();
    oldSocket.destroy();
  }

  if (registrationServer) {
    registrationServer.close();
    registrationServer = null;
  }

  // Clean up socket file
  if (fs.existsSync(REGISTRATION_SOCKET)) {
    fs.unlinkSync(REGISTRATION_SOCKET);
  }
}
