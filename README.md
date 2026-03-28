# NeoVimMCP

MCP server that receives Neovim buffer updates and exposes editor context as MCP tools.

## Features

- MCP server over stdio for AI clients
- HTTP bridge endpoint Neovim can POST to
- In-memory buffer store with active buffer tracking
- Tools for active buffer, list/lookup, cursor context, publish, and clear

## Start server

```bash
npm install
npm start
```

Optional env var:

- `NVIM_BUFFER_PORT` (default `4389`)

Example publish call:

```bash
curl -X POST http://127.0.0.1:4389/buffer/update \
  -H 'content-type: application/json' \
  -d '{
    "bufnr": 1,
    "filePath": "/tmp/example.js",
    "filetype": "javascript",
    "cursorLine": 12,
    "content": "console.log(\"hello\")"
  }'
```

## MCP tools exposed

- `nvim_get_active_buffer`
- `nvim_list_buffers`
- `nvim_get_buffer`
- `nvim_get_cursor_context`
- `nvim_publish_buffer`
- `nvim_clear_buffer`

## Connect your MCP client

Example `mcpServers` entry:

```json
{
  "mcpServers": {
    "nvim": {
      "command": "node",
      "args": ["/absolute/path/to/nvimMCP/server.js"],
      "env": {
        "NVIM_SOCKET_PATH": "/tmp/nvim.sock (Neovim socket)"
      }
    }
  }
}
```

## Connect Neovim

Drop `nvim/nvim-mcp.lua` into your config (or source it directly), then call setup:

```lua
local nvim_mcp = dofile("/absolute/path/to/nvimMCP/nvim/nvim-mcp.lua")

nvim_mcp.setup({
  endpoint = "http://127.0.0.1:4389/buffer/update",
  clear_endpoint = "http://127.0.0.1:4389/buffer/clear",
  debounce_ms = 150,
})
```

Available user commands:

- `:NvimMcpPublish` (force publish current buffer)
- `:NvimMcpClear` (clear current buffer from server)
