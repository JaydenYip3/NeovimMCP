import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NeovimClient } from "neovim";
import { getNvim } from "../neovim/neovim.js";

interface Position {
  line: number;
  col: number;
}

interface VisualSelection {
  lines: string[];
  text: string;
  from: Position;
  to: Position;
}

interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function response(
  value: unknown,
  structured: Record<string, unknown> = {},
): ToolResponse {
  return {
    content: [{ type: "text", text: asText(value) }],
    structuredContent: structured,
  };
}

function errorResponse(message: string): ToolResponse {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function getVisualSelection(
  nvim: NeovimClient,
): Promise<VisualSelection> {
  const start = (await nvim.call("getpos", ["'<"])) as number[];
  const end = (await nvim.call("getpos", ["'>"])) as number[];

  let startLine = start[1];
  let startCol = start[2];
  let endLine = end[1];
  let endCol = end[2];

  if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
    [startLine, endLine] = [endLine, startLine];
    [startCol, endCol] = [endCol, startCol];
  }

  const lines = (await nvim.call("getline", [startLine, endLine])) as string[];

  if (lines.length === 0) {
    return {
      lines: [],
      text: "",
      from: { line: startLine, col: startCol },
      to: { line: endLine, col: endCol },
    };
  }

  lines[0] = lines[0].slice(Math.max(0, startCol - 1));
  lines[lines.length - 1] = lines[lines.length - 1].slice(
    0,
    Math.max(0, endCol),
  );

  return {
    lines,
    text: lines.join("\n"),
    from: { line: startLine, col: startCol },
    to: { line: endLine, col: endCol },
  };
}

type ToolHandler<T = Record<string, unknown>> = (
  args: T,
) => Promise<ToolResponse>;

export function registerTools(server: McpServer): void {
  const withErrorHandling = <T>(handler: ToolHandler<T>): ToolHandler<T> => {
    return async (args: T): Promise<ToolResponse> => {
      try {
        return await handler(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResponse(message);
      }
    };
  };

  server.registerTool(
    "get_cursor_context",
    {
      title: "Get Cursor Context",
      description:
        "Returns current file, filetype, cursor position, and nearby lines.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const nvim = await getNvim();
      const file = (await nvim.call("expand", ["%:p"])) as string;
      const filetype = (await nvim.eval("&filetype")) as string;
      const pos = (await nvim.call("getcurpos", [])) as number[];
      const line = pos[1];
      const col = pos[2];
      const start = Math.max(1, line - 5);
      const finish = line + 5;
      const nearby = (await nvim.call("getline", [start, finish])) as string[];

      const payload = {
        file,
        filetype,
        cursor: { line, col },
        nearby,
      };

      return response(payload, payload);
    }),
  );

  server.registerTool(
    "get_lines",
    {
      title: "Get Line Range",
      description:
        "Returns lines from start to end (0-indexed, end-exclusive).",
      inputSchema: {
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      },
    },
    withErrorHandling(
      async ({ start, end }: { start: number; end: number }) => {
        if (start >= end) {
          return errorResponse("start must be less than end");
        }
        const nvim = await getNvim();
        const lines = (await nvim.call("getline", [
          start + 1,
          end,
        ])) as string[];
        return response(lines.join("\n"), { start, end, lines });
      },
    ),
  );

  server.registerTool(
    "get_selection",
    {
      title: "Get Visual Selection",
      description: "Returns last visual selection based on '< and '> marks.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const nvim = await getNvim();
      const selection = await getVisualSelection(nvim);
      return response(
        selection,
        selection as unknown as Record<string, unknown>,
      );
    }),
  );

  server.registerTool(
    "get_yank",
    {
      title: "Get Yank Register",
      description: "Returns unnamed register text and register type.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const nvim = await getNvim();
      const text = (await nvim.call("getreg", ['"'])) as string;
      const type = (await nvim.call("getregtype", ['"'])) as string;
      const payload = { text, type };
      return response(payload, payload);
    }),
  );

  server.registerTool(
    "get_full_file",
    {
      title: "Get Full File",
      description: "Returns full current buffer content.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const nvim = await getNvim();
      const lines = (await nvim.call("getline", [1, "$"])) as string[];
      return response(lines.join("\n"), { lines });
    }),
  );
  server.registerTool(
    "get_path",
    {
      title: "Get file path absolute and relative",
      description:
        "Returns the absolute and relative path of the current file.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const nvim = await getNvim();
      const absolute_path = (await nvim.eval('expand("%:p")')) as string;
      const relative_path = (await nvim.eval('expand("%:.")')) as string;
      const payload = {
        relative_file_path: relative_path,
        absolute_file_path: absolute_path,
      };
      return response(payload, payload);
    }),
  );
}
