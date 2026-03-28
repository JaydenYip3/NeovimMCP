import { z } from "zod"
import { getNvim } from "../neovim/neovim.js"

function asText(value) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

function response(value, structured = {}) {
    return {
        content: [{ type: "text", text: asText(value) }],
        structuredContent: structured,
    }
}

function errorResponse(message) {
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    }
}

async function getVisualSelection(nvim) {
    const start = await nvim.call("getpos", ["'<"])
    const end = await nvim.call("getpos", ["'>"])

    let startLine = start[1]
    let startCol = start[2]
    let endLine = end[1]
    let endCol = end[2]

    if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
        ;[startLine, endLine] = [endLine, startLine]
            ;[startCol, endCol] = [endCol, startCol]
    }

    const lines = await nvim.call("getline", [startLine, endLine])

    if (lines.length === 0) {
        return { lines: [], text: "", from: { line: startLine, col: startCol }, to: { line: endLine, col: endCol } }
    }

    lines[0] = lines[0].slice(Math.max(0, startCol - 1))
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, Math.max(0, endCol))

    return {
        lines,
        text: lines.join("\n"),
        from: { line: startLine, col: startCol },
        to: { line: endLine, col: endCol },
    }
}

export function registerTools(server) {
    const withErrorHandling = (handler) => async (args) => {
        try {
            return await handler(args)
        } catch (err) {
            return errorResponse(err.message)
        }
    }

    server.registerTool(
        "get_cursor_context",
        {
            title: "Get Cursor Context",
            description: "Returns current file, filetype, cursor position, and nearby lines.",
            inputSchema: {},
        },
        withErrorHandling(async () => {
            const nvim = await getNvim()
            const file = await nvim.call("expand", ["%:p"])
            const filetype = await nvim.eval("&filetype")
            const [line, col] = await nvim.call("getcurpos", []).then((p) => [p[1], p[2]])
            const start = Math.max(1, line - 5)
            const finish = line + 5
            const nearby = await nvim.call("getline", [start, finish])

            const payload = {
                file,
                filetype,
                cursor: { line, col },
                nearby,
            }

            return response(payload, payload)
        }),
    )

    server.registerTool(
        "get_lines",
        {
            title: "Get Line Range",
            description: "Returns lines from start to end (0-indexed, end-exclusive).",
            inputSchema: {
                start: z.number().int().nonnegative(),
                end: z.number().int().nonnegative(),
            },
        },
        withErrorHandling(async ({ start, end }) => {
            if (start >= end) {
                return errorResponse("start must be less than end")
            }
            const nvim = await getNvim()
            const lines = await nvim.call("getline", [start + 1, end])
            return response(lines.join("\n"), { start, end, lines })
        }),
    )

    server.registerTool(
        "get_selection",
        {
            title: "Get Visual Selection",
            description: "Returns last visual selection based on '< and '> marks.",
            inputSchema: {},
        },
        withErrorHandling(async () => {
            const nvim = await getNvim()
            const selection = await getVisualSelection(nvim)
            return response(selection, selection)
        }),
    )

    server.registerTool(
        "get_yank",
        {
            title: "Get Yank Register",
            description: "Returns unnamed register text and register type.",
            inputSchema: {},
        },
        withErrorHandling(async () => {
            const nvim = await getNvim()
            const text = await nvim.call("getreg", ['"'])
            const type = await nvim.call("getregtype", ['"'])
            const payload = { text, type }
            return response(payload, payload)
        }),
    )

    server.registerTool(
        "get_full_file",
        {
            title: "Get Full File",
            description: "Returns full current buffer content.",
            inputSchema: {},
        },
        withErrorHandling(async () => {
            const nvim = await getNvim()
            const lines = await nvim.call("getline", [1, "$"])
            return response(lines.join("\n"), { lines })
        }),
    )
}
