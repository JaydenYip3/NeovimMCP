import net from "net";
import { attach, NeovimClient } from "neovim";
import fs from "fs";

let socket: net.Socket | null = null;
let nvimInstance: NeovimClient | null = null;
let currentSocketPath: string | null = null;

// Path to the txt file that tracks which Neovim instance is currently focused
const ACTIVE_NVIM_FILE = process.env.NVIM_ACTIVE_FILE || "/tmp/nvim-active.txt";

/**
 * Reads the active Neovim socket path from the tracking file.
 * The tracking file is a plain txt file that Neovim writes to on FocusGained.
 */
function getActiveSocketPath(): string | null {
    // Create tracking file if it doesn't exist
    if (!fs.existsSync(ACTIVE_NVIM_FILE)) {
        fs.writeFileSync(ACTIVE_NVIM_FILE, "", "utf8");
        return null;
    }

    const socketPath = fs.readFileSync(ACTIVE_NVIM_FILE, "utf8").trim();
    return socketPath || null;
}

/**
 * Connects to a specific Neovim socket.
 */
function connectToSocket(socketPath: string): Promise<NeovimClient> {
    return new Promise((resolve, reject) => {
        socket = net.createConnection(socketPath);

        socket.on("error", (err: Error) => {
            reject(new Error(
                `Failed to connect to Neovim at ${socketPath}: ${err.message}`
            ));
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
    const socketPath = getActiveSocketPath();

    if (!socketPath) {
        throw new Error(
            `No active Neovim found. The tracking file (${ACTIVE_NVIM_FILE}) is empty.\n` +
            "Make sure Neovim is configured to write its socket path on focus:\n" +
            "  1. Start Neovim with: nvim --listen /tmp/nvim-$$.sock\n" +
            "  2. Add FocusGained autocmd to write socket path to " + ACTIVE_NVIM_FILE
        );
    }

    if (!fs.existsSync(socketPath)) {
        throw new Error(
            `Neovim socket not found at: ${socketPath}\n` +
            "The Neovim instance that was focused may have closed.\n" +
            "Focus a running Neovim instance to update the tracking file."
        );
    }

    // If socket path changed, clean up old connection silently
    if (currentSocketPath && currentSocketPath !== socketPath) {
        const oldSocket = socket;
        socket = null;
        nvimInstance = null;
        currentSocketPath = null;
        // Destroy old socket after clearing references to avoid error propagation
        if (oldSocket) {
            oldSocket.removeAllListeners();
            oldSocket.destroy();
        }
    }

    // Return cached instance if still connected to the same socket
    if (nvimInstance && currentSocketPath === socketPath) {
        return nvimInstance;
    }

    // Connect to the new socket
    nvimInstance = await connectToSocket(socketPath);
    currentSocketPath = socketPath;
    return nvimInstance;
}

export function disconnectNvim(): void {
    const oldSocket = socket;
    socket = null;
    nvimInstance = null;
    currentSocketPath = null;
    if (oldSocket) {
        oldSocket.removeAllListeners();
        oldSocket.destroy();
    }
}
