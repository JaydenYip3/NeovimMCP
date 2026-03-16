# NeoVimMCP

Minimal MCP server that tracks Neovim buffer content and exposes it to MCP clients.

## What it does

- Runs an MCP server over stdio
- Runs a local HTTP listener for Neovim buffer updates
- Stores latest buffers in memory
- Exposes tools to get active buffer, lookup a buffer, list buffers, and publish updates

## Run

```bash
npm install
npm start
```

Optional env var:

- `NVIM_BUFFER_PORT` (default: `4389`)

## HTTP listener (from Neovim)

Base URL: `http://127.0.0.1:4389`

- `GET /health`
- `GET /buffer/list`
- `POST /buffer/update`
- `POST /buffer/clear`

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

## MCP tools

- `nvim_get_active_buffer`
- `nvim_get_buffer`
- `nvim_list_buffers`
- `nvim_publish_buffer`
