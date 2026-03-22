import net from "net";
import { attach } from "neovim";
import fs from "fs";

let instance = null;
let socket = null;

export async function getNvim() {
    if (instance) return instance;

    const socketPath = process.env.NVIM;
    if (!socketPath) {
        throw new Error(
            "NVIM environment variable not set. " +
            "Start Neovim with: nvim --listen /tmp/nvim.sock " +
            "Then set NVIM=/tmp/nvim.sock"
        );
    }

    if (!fs.existsSync(socketPath)) {
        throw new Error(
            `Neovim socket not found at: ${socketPath}. ` +
            "Make sure Neovim is running with --listen flag. " +
            "Example: nvim --listen /tmp/nvim.sock"
        );
    }

    return new Promise((resolve, reject) => {
        socket = net.createConnection(socketPath);

        socket.on("error", (err) => {
            instance = null;
            reject(new Error(
                `Failed to connect to Neovim at ${socketPath}: ${err.message}. ` +
                "Ensure Neovim is running with --listen flag."
            ));
        });

        socket.on("close", () => {
            instance = null;
            socket = null;
        });

        socket.on("connect", async () => {
            try {
                instance = await attach({
                    reader: socket,
                    writer: socket,
                });
                resolve(instance);
            } catch (err) {
                reject(new Error(`Failed to attach to Neovim: ${err.message}`));
            }
        });
    });
}

export function disconnectNvim() {
    if (socket) {
        socket.destroy();
        socket = null;
        instance = null;
    }
}
