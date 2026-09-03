import { z } from "zod";

const positionSchema = z.object({
  line: z.number().int(),
  col: z.number().int(),
});

const selectionSchema = z.object({
  lines: z.array(z.string()),
  text: z.string(),
  from: positionSchema,
  to: positionSchema,
});

const yankSchema = z.object({
  text: z.string(),
  type: z.string(),
});

/**
 * Payload Neovim pushes to POST /nvim/state.
 *
 * Every field except `instance` is optional: the Lua plugin sends cheap
 * updates (cursor only) on CursorMoved and full updates (lines, selection)
 * on the events that can actually change them. Fields that are absent keep
 * their previous value.
 */
export const stateUpdateSchema = z.object({
  instance: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  file: z
    .object({
      absolute: z.string().optional(),
      relative: z.string().optional(),
    })
    .optional(),
  filetype: z.string().optional(),
  mode: z.string().optional(),
  cursor: positionSchema.optional(),
  lines: z.array(z.string()).optional(),
  selection: selectionSchema.nullable().optional(),
  yank: yankSchema.nullable().optional(),
  focused: z.boolean().optional(),
});

export type StateUpdate = z.infer<typeof stateUpdateSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Selection = z.infer<typeof selectionSchema>;
export type Yank = z.infer<typeof yankSchema>;

export interface EditorState {
  instance: string;
  name: string;
  file: { absolute: string; relative: string };
  filetype: string;
  mode: string;
  cursor: Position;
  lines: string[];
  selection: Selection | null;
  yank: Yank | null;
  updatedAt: number;
  linesUpdatedAt: number;
}

const editors = new Map<string, EditorState>();
let activeInstance: string | null = null;

function blankState(instance: string): EditorState {
  return {
    instance,
    name: instance,
    file: { absolute: "", relative: "" },
    filetype: "",
    mode: "",
    cursor: { line: 1, col: 1 },
    lines: [],
    selection: null,
    yank: null,
    updatedAt: 0,
    linesUpdatedAt: 0,
  };
}

/** Creates or merges an editor snapshot and returns the stored result. */
export function applyUpdate(update: StateUpdate): EditorState {
  const existing = editors.get(update.instance);
  const state = existing ?? blankState(update.instance);
  const now = Date.now();

  if (update.name !== undefined) state.name = update.name;
  if (update.file !== undefined) {
    state.file = {
      absolute: update.file.absolute ?? state.file.absolute,
      relative: update.file.relative ?? state.file.relative,
    };
  }
  if (update.filetype !== undefined) state.filetype = update.filetype;
  if (update.mode !== undefined) state.mode = update.mode;
  if (update.cursor !== undefined) state.cursor = update.cursor;
  if (update.lines !== undefined) {
    state.lines = update.lines;
    state.linesUpdatedAt = now;
  }
  if (update.selection !== undefined) state.selection = update.selection;
  if (update.yank !== undefined) state.yank = update.yank;
  state.updatedAt = now;

  editors.set(state.instance, state);

  // An explicit `focused: false` only says "I am not the focused instance";
  // it must not steal the active slot from whoever is.
  if (update.focused !== false) {
    activeInstance = state.instance;
  }

  return state;
}

export function setActive(instance: string): EditorState | null {
  const state = editors.get(instance);
  if (!state) return null;
  activeInstance = instance;
  return state;
}

export function detach(instance: string): boolean {
  const removed = editors.delete(instance);
  if (activeInstance === instance) {
    activeInstance = mostRecent()?.instance ?? null;
  }
  return removed;
}

export function list(): EditorState[] {
  return [...editors.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function mostRecent(): EditorState | undefined {
  return list()[0];
}

/**
 * Resolves the editor a tool call should read from: the requested instance,
 * or the focused one, falling back to whichever pushed most recently.
 */
export function resolve(instance?: string): EditorState {
  if (instance) {
    const state = editors.get(instance);
    if (!state) {
      const known = list().map((e) => e.instance);
      throw new Error(
        `Unknown Neovim instance "${instance}". ` +
          (known.length
            ? `Known instances: ${known.join(", ")}`
            : "No instances are currently registered."),
      );
    }
    return state;
  }

  const state =
    (activeInstance ? editors.get(activeInstance) : undefined) ?? mostRecent();

  if (!state) {
    throw new Error(
      "No Neovim instance has registered with this server.\n" +
        "Load nvim/nvim-mcp.lua in your Neovim config and point it at this " +
        "server's URL, then focus a Neovim window.",
    );
  }

  return state;
}

export function getActiveInstance(): string | null {
  return activeInstance;
}

export function reset(): void {
  editors.clear();
  activeInstance = null;
}
