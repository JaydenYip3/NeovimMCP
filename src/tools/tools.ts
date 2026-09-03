import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { list, resolve, type EditorState } from "../state/store.js";

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

/** Milliseconds since the instance last pushed, so callers can spot stale data. */
function freshness(state: EditorState): Record<string, unknown> {
  return {
    instance: state.instance,
    name: state.name,
    age_ms: Date.now() - state.updatedAt,
  };
}

const instanceArg = {
  instance: z
    .string()
    .optional()
    .describe(
      "Neovim instance id to read from. Defaults to the focused instance.",
    ),
};

type InstanceArgs = { instance?: string };

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
    "list_editors",
    {
      title: "List Neovim Instances",
      description:
        "Lists every Neovim instance currently pushing state to this server.",
      inputSchema: {},
    },
    withErrorHandling(async () => {
      const editors = list().map((state) => ({
        ...freshness(state),
        file: state.file.absolute,
        filetype: state.filetype,
        line_count: state.lines.length,
      }));
      return response(editors, { editors });
    }),
  );

  server.registerTool(
    "get_cursor_context",
    {
      title: "Get Cursor Context",
      description:
        "Returns current file, filetype, cursor position, and nearby lines.",
      inputSchema: instanceArg,
    },
    withErrorHandling(async ({ instance }: InstanceArgs) => {
      const state = resolve(instance);
      const line = state.cursor.line;
      const start = Math.max(1, line - 5);
      const finish = Math.min(state.lines.length, line + 5);
      const nearby = state.lines.slice(start - 1, finish);

      const payload = {
        file: state.file.absolute,
        filetype: state.filetype,
        cursor: state.cursor,
        nearby,
        ...freshness(state),
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
        ...instanceArg,
      },
    },
    withErrorHandling(
      async ({
        start,
        end,
        instance,
      }: InstanceArgs & { start: number; end: number }) => {
        if (start >= end) {
          return errorResponse("start must be less than end");
        }
        const state = resolve(instance);
        const lines = state.lines.slice(start, end);
        return response(lines.join("\n"), {
          start,
          end,
          lines,
          ...freshness(state),
        });
      },
    ),
  );

  server.registerTool(
    "get_selection",
    {
      title: "Get Visual Selection",
      description: "Returns last visual selection based on '< and '> marks.",
      inputSchema: instanceArg,
    },
    withErrorHandling(async ({ instance }: InstanceArgs) => {
      const state = resolve(instance);
      const selection = state.selection ?? {
        lines: [],
        text: "",
        from: { line: 0, col: 0 },
        to: { line: 0, col: 0 },
      };
      const payload = { ...selection, ...freshness(state) };
      return response(payload, payload);
    }),
  );

  server.registerTool(
    "get_yank",
    {
      title: "Get Yank Register",
      description: "Returns unnamed register text and register type.",
      inputSchema: instanceArg,
    },
    withErrorHandling(async ({ instance }: InstanceArgs) => {
      const state = resolve(instance);
      const yank = state.yank ?? { text: "", type: "" };
      const payload = { ...yank, ...freshness(state) };
      return response(payload, payload);
    }),
  );

  server.registerTool(
    "get_full_file",
    {
      title: "Get Full File",
      description: "Returns full current buffer content.",
      inputSchema: instanceArg,
    },
    withErrorHandling(async ({ instance }: InstanceArgs) => {
      const state = resolve(instance);
      return response(state.lines.join("\n"), {
        lines: state.lines,
        ...freshness(state),
      });
    }),
  );

  server.registerTool(
    "get_path",
    {
      title: "Get file path absolute and relative",
      description:
        "Returns the absolute and relative path of the current file.",
      inputSchema: instanceArg,
    },
    withErrorHandling(async ({ instance }: InstanceArgs) => {
      const state = resolve(instance);
      const payload = {
        relative_file_path: state.file.relative,
        absolute_file_path: state.file.absolute,
        ...freshness(state),
      };
      return response(payload, payload);
    }),
  );
}
