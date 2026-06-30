// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-tools.mjs
 *        The editor MCP tool registry. Each tool maps 1:1 to an EditorControlSurface
 *        method, so the MCP server adds NO new editor truth — it is a transport over
 *        the surface (exactly what EditorControlSurface.ts:7-9 anticipated). Kept
 *        dependency-free (JSON-Schema + light manual validation, no zod import) so the
 *        dispatch unit-tests without Electron and resolves under vite/vitest; the
 *        Electron entry (editor-mcp.mjs) supplies the executeJavaScript driver and the
 *        MCP SDK wiring. See docs/REARCH_EDITOR_ARCH.md §11.
 */

const obj = (properties, required = []) => ({ type: 'object', properties, required });

/** name → { description, schema (JSON Schema), method (surface), args(input)→[] }. */
export const TOOLS = [
  { name: 'load_scene',
    description: 'Load a scene (and optional asset manifest) into the headless World; returns the spawned entity count.',
    schema: obj({ sceneUrl: { type: 'string' }, manifestUrl: { type: 'string' } }, ['sceneUrl']),
    method: 'loadScene', args: (i) => [i.sceneUrl, i.manifestUrl] },
  { name: 'get_scene_tree',
    description: 'The scene entity tree (id, name, kind, children).',
    schema: obj({}), method: 'getSceneTree', args: () => [] },
  { name: 'get_entity',
    description: 'One entity: name, kind, and its component list.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'getEntity', args: (i) => [i.id] },
  { name: 'get_inspector',
    description: "An entity's components and fields — the Details-panel data.",
    schema: obj({ entity: { type: 'number' } }, ['entity']), method: 'getInspector', args: (i) => [i.entity] },
  { name: 'serialize_scene',
    description: 'The full lossless scene JSON (the model truth).',
    schema: obj({}), method: 'serializeScene', args: () => [] },
  { name: 'add_entity',
    description: 'Create a new entity; returns its id.',
    schema: obj({}), method: 'addEntity', args: () => [] },
  { name: 'delete_entity',
    description: 'Delete an entity.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'deleteEntity', args: (i) => [i.id] },
  { name: 'rename_entity',
    description: 'Rename an entity.',
    schema: obj({ id: { type: 'number' }, name: { type: 'string' } }, ['id', 'name']),
    method: 'renameEntity', args: (i) => [i.id, i.name] },
  { name: 'set_field',
    description: 'Set a component field (undoable). `type` is the inspector field type (e.g. float, int, bool, string, vec2, vec3, color, enum).',
    schema: obj({
      entity: { type: 'number' }, component: { type: 'string' }, key: { type: 'string' },
      type: { type: 'string' }, value: {},
    }, ['entity', 'component', 'key', 'type', 'value']),
    method: 'setField', args: (i) => [i.entity, i.component, i.key, i.type, i.value] },
  { name: 'set_parent',
    description: 'Re-parent an entity in the transform hierarchy (parent=null → scene root).',
    schema: obj({ id: { type: 'number' }, parent: { type: ['number', 'null'] } }, ['id', 'parent']),
    method: 'setParent', args: (i) => [i.id, i.parent] },
  { name: 'select',
    description: 'Select an entity (id=null clears the selection).',
    schema: obj({ id: { type: ['number', 'null'] } }, ['id']), method: 'select', args: (i) => [i.id] },
  { name: 'get_selection',
    description: 'The primary selected entity id, or null.',
    schema: obj({}), method: 'getSelection', args: () => [] },
  { name: 'set_run_mode',
    description: 'Enter or leave play mode (playing=true runs gameplay; Stop rebuilds the edit World).',
    schema: obj({ playing: { type: 'boolean' }, paused: { type: 'boolean' } }, ['playing']),
    method: 'setRunMode', args: (i) => [i.playing, i.paused] },
  { name: 'step',
    description: 'Advance the engine by N fixed-dt frames deterministically (no rAF).',
    schema: obj({ frames: { type: 'number' }, dt: { type: 'number' } }),
    method: 'step', args: (i) => [i.frames, i.dt] },
  { name: 'get_stats',
    description: 'Live counts: entity count + last frame draw calls (cheap render evidence).',
    schema: obj({}), method: 'getStats', args: () => [] },
  { name: 'undo', description: 'Undo the last edit.', schema: obj({}), method: 'undo', args: () => [] },
  { name: 'redo', description: 'Redo the last undone edit.', schema: obj({}), method: 'redo', args: () => [] },
];

/** The MCP `tools/list` payload — name, description, JSON-Schema inputSchema. */
export function listTools() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
}

function typeMatches(spec, val) {
  return (Array.isArray(spec) ? spec : [spec]).some((t) =>
    t === 'null' ? val === null
      : t === 'number' ? typeof val === 'number'
      : t === 'string' ? typeof val === 'string'
      : t === 'boolean' ? typeof val === 'boolean'
      : t === 'object' ? (val !== null && typeof val === 'object')
      : true);
}

/** Light validation: required args present + declared scalar types match. */
function validate(schema, raw) {
  const input = raw ?? {};
  for (const req of schema.required ?? []) {
    if (input[req] === undefined) throw new Error(`missing required argument: ${req}`);
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (input[key] !== undefined && spec.type && !typeMatches(spec.type, input[key])) {
      throw new Error(`argument "${key}" must be ${[].concat(spec.type).join(' | ')}`);
    }
  }
  return input;
}

/**
 * Validate `rawInput`, invoke the surface via `driver(method, args)`, and wrap the
 * result as an MCP CallToolResult. A validation failure or a driver throw becomes an
 * `isError` result rather than crashing the server.
 */
export async function runTool(tool, driver, rawInput) {
  try {
    const input = validate(tool.schema, rawInput);
    const result = await driver(tool.method, tool.args(input));
    return { content: [{ type: 'text', text: result === undefined ? 'ok' : JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
