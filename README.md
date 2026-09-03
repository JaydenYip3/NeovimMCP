# NeoVimMCP

MCP server that receives Neovim buffer updates over HTTP and exposes editor
context as MCP tools — to clients on this machine *or* on any other device on
your network.

<img width="1405" height="538" alt="image" src="https://github.com/user-attachments/assets/c98964e7-4c8a-4903-a7d0-b669fdbf1e61" />

<img width="1424" height="550" alt="image" src="https://github.com/user-attachments/assets/3b87054e-4c60-4f41-9fef-f79064aba23d" />

## How it works

```
Neovim (Lua plugin) --HTTP POST--> NeoVimMCP server <--MCP over HTTP-- phone / laptop / any client
```

Neovim pushes buffer, cursor, selection and yank state to the server on
autocmds; the server keeps the latest snapshot per instance in memory and
serves it over the MCP Streamable HTTP transport. Nothing depends on a Unix
socket, so an MCP client on another device only needs to reach this machine's
IP and port.

## Features

- MCP over Streamable HTTP — reachable from other devices on the same network
- HTTP ingest endpoint Neovim POSTs to
- In-memory state store with focus tracking across multiple Neovim instances
- Tools for cursor context, line ranges, selection, yank, full buffer and paths
- Optional bearer-token auth
- stdio transport still available for local-only setups

## Start the server

```bash
npm install
npm run build
npm start
```

The startup banner prints the URLs to use:

```
[MCP] HTTP listening on 0.0.0.0:4389
[MCP]   MCP endpoint:   http://192.168.1.42:4389/mcp
[MCP]   Neovim ingest:  http://192.168.1.42:4389/nvim/state
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NVIM_MCP_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep it local-only. |
| `NVIM_MCP_PORT` | `4389` | Listen port. |
| `NVIM_MCP_TOKEN` | *(unset)* | When set, every request except `/health` needs `Authorization: Bearer <token>`. |
| `NVIM_MCP_TRANSPORT` | `http` | Set to `stdio` (or pass `--stdio`) to also serve MCP over stdio. |

> **Security:** the default bind exposes your buffer contents to everyone on the
> network. Set `NVIM_MCP_TOKEN` whenever the server is not bound to loopback —
> the server warns at startup if you have not. For access beyond your LAN, put
> it behind a tunnel or reverse proxy with TLS rather than forwarding the port.

## Connect Neovim

Copy `nvim/nvim-mcp.lua` into your config's `lua/` directory (or add this repo's
`nvim/` folder to your `runtimepath`), then:

```lua
require("nvim-mcp").setup({
  url = "http://127.0.0.1:4389",
  -- token = "your-token",          -- must match NVIM_MCP_TOKEN
  -- instance = "work-laptop",      -- defaults to hostname-pid
})
```

Requires `curl` on `PATH`. Commands: `:NvimMcpSync` pushes immediately,
`:NvimMcpStatus` shows the configured URL and instance id.

## Connect an MCP client

Any client that speaks the MCP Streamable HTTP transport, on any device that can
reach the machine:

```json
{
  "mcpServers": {
    "nvim": {
      "type": "http",
      "url": "http://192.168.1.42:4389/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

In Claude Code: `claude mcp add --transport http nvim http://192.168.1.42:4389/mcp`.

For a local-only stdio setup instead:

```json
{
  "mcpServers": {
    "nvim": {
      "command": "node",
      "args": ["/absolute/path/to/nvimMCP/dist/server.js", "--stdio"]
    }
  }
}
```

Note that stdio mode still binds the HTTP ingest port so Neovim has somewhere to
POST — only one instance can own that port at a time.

## MCP tools exposed

- `list_editors` — every registered Neovim instance and how stale it is
- `get_cursor_context`
- `get_lines`
- `get_selection`
- `get_yank`
- `get_full_file`
- `get_path`

Every tool except `list_editors` takes an optional `instance` argument; without
it, the most recently focused Neovim is used. Responses include `age_ms` so a
client can tell how fresh the snapshot is.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/mcp` | MCP Streamable HTTP endpoint (also `GET`/`DELETE` for sessions) |
| `POST` | `/nvim/state` | Neovim pushes a state snapshot; absent fields keep their previous value |
| `POST` | `/nvim/focus` | Mark `{ "instance": "..." }` as the active editor |
| `POST` | `/nvim/detach` | Remove an instance from the store |
| `GET` | `/nvim/state` | Dump the store (debugging) |
| `GET` | `/health` | Unauthenticated liveness check |

## Docker

```bash
docker build -t nvimmcp .
docker run -p 4389:4389 -e NVIM_MCP_TOKEN=your-token nvimmcp
```
