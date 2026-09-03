-- nvim-mcp: pushes editor state to a NeoVimMCP server over HTTP.
--
--   require("nvim-mcp").setup({ url = "http://127.0.0.1:4389" })
--
-- The server keeps the last pushed snapshot in memory, so MCP clients on any
-- device that can reach the server (phone, tablet, another laptop) can read
-- this buffer without touching a local socket.

local M = {}

local uv = vim.uv or vim.loop

local config = {
  url = "http://127.0.0.1:4389",
  token = nil,
  -- Stable-per-process id. Hostname + pid keeps several nvim instances apart.
  instance = nil,
  name = nil,
  timeout = 2000,
  enabled = true,
}

local pending = false
local queued = nil

local function post(path, payload)
  local args = {
    "curl",
    "--silent",
    "--show-error",
    "--max-time",
    tostring(math.max(1, math.floor(config.timeout / 1000))),
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
  }
  if config.token then
    table.insert(args, "-H")
    table.insert(args, "Authorization: Bearer " .. config.token)
  end
  table.insert(args, "--data-binary")
  table.insert(args, "@-")
  table.insert(args, config.url .. path)

  local body = vim.json.encode(payload)

  if vim.system then
    vim.system(args, { stdin = body, text = true }, function() end)
  else
    local job = vim.fn.jobstart(args, { stdout_buffered = true })
    if job > 0 then
      vim.fn.chansend(job, body)
      vim.fn.chanclose(job, "stdin")
    end
  end
end

local function cursor()
  local pos = vim.api.nvim_win_get_cursor(0)
  return { line = pos[1], col = pos[2] + 1 }
end

local function selection()
  local from = vim.fn.getpos("'<")
  local to = vim.fn.getpos("'>")
  local start_line, start_col = from[2], from[3]
  local end_line, end_col = to[2], to[3]

  if start_line == 0 or end_line == 0 then
    return vim.NIL
  end

  if start_line > end_line or (start_line == end_line and start_col > end_col) then
    start_line, end_line = end_line, start_line
    start_col, end_col = end_col, start_col
  end

  local lines = vim.fn.getline(start_line, end_line)
  if type(lines) ~= "table" or #lines == 0 then
    return vim.NIL
  end

  lines[1] = string.sub(lines[1], math.max(1, start_col))
  lines[#lines] = string.sub(lines[#lines], 1, math.max(0, end_col))

  return {
    lines = lines,
    text = table.concat(lines, "\n"),
    from = { line = start_line, col = start_col },
    to = { line = end_line, col = end_col },
  }
end

--- Builds a payload. `full` includes buffer lines, selection and yank;
--- otherwise only the cheap cursor/mode fields are sent.
local function snapshot(full, focused)
  local payload = {
    instance = config.instance,
    name = config.name,
    filetype = vim.bo.filetype,
    mode = vim.api.nvim_get_mode().mode,
    cursor = cursor(),
    file = {
      absolute = vim.fn.expand("%:p"),
      relative = vim.fn.expand("%:."),
    },
    focused = focused,
  }

  if full then
    payload.lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
    payload.selection = selection()
    payload.yank = {
      text = vim.fn.getreg('"'),
      type = vim.fn.getregtype('"'),
    }
  end

  return payload
end

--- Coalesces bursts of autocmds into one request per tick.
local function push(full, focused)
  if not config.enabled then
    return
  end

  queued = { full = (queued and queued.full) or full, focused = focused }
  if pending then
    return
  end
  pending = true

  vim.schedule(function()
    local job = queued
    pending, queued = false, nil
    if job then
      post("/nvim/state", snapshot(job.full, job.focused))
    end
  end)
end

function M.sync()
  push(true, true)
end

function M.setup(opts)
  config = vim.tbl_extend("force", config, opts or {})
  config.url = config.url:gsub("/+$", "")
  config.instance = config.instance
    or string.format("%s-%d", uv.os_gethostname(), uv.os_getpid())
  config.name = config.name or config.instance

  local group = vim.api.nvim_create_augroup("NvimMcp", { clear = true })

  -- Content can change: send the whole snapshot.
  vim.api.nvim_create_autocmd({
    "BufEnter",
    "BufWritePost",
    "TextChanged",
    "TextChangedI",
    "TextYankPost",
    "ModeChanged",
    "FocusGained",
  }, {
    group = group,
    callback = function()
      push(true, true)
    end,
  })

  -- Cursor only: cheap update, no buffer body.
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = group,
    callback = function()
      push(false, true)
    end,
  })

  vim.api.nvim_create_autocmd("FocusLost", {
    group = group,
    callback = function()
      push(false, false)
    end,
  })

  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = group,
    callback = function()
      post("/nvim/detach", { instance = config.instance })
    end,
  })

  vim.api.nvim_create_user_command("NvimMcpSync", M.sync, {})
  vim.api.nvim_create_user_command("NvimMcpStatus", function()
    vim.notify(
      string.format("nvim-mcp -> %s as %s", config.url, config.instance),
      vim.log.levels.INFO
    )
  end, {})

  M.sync()
end

return M
