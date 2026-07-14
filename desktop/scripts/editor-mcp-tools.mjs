// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-tools.mjs
 *        The editor MCP tool registry — the ONE catalog every MCP entry serves.
 *        Each tool maps 1:1 to an EditorControlSurface method, so the MCP server
 *        adds NO new editor truth — it is a transport over the surface (exactly
 *        what EditorControlSurface.ts:7-9 anticipated). Kept dependency-free
 *        (JSON-Schema + light manual validation, no zod import) so the dispatch
 *        unit-tests without Electron and resolves under vite/vitest; the Electron
 *        entry (editor-mcp.mjs) supplies the executeJavaScript driver and the
 *        MCP SDK wiring. See docs/REARCH_EDITOR_ARCH.md §11.
 *
 * Two tool shapes:
 *   - method tools: `{ method, args(input) }` → driver(method, args) — a surface call.
 *   - renderer-code tools: `{ js(input) }` → driver.js(code) — for routines that
 *     need the renderer's DOM (canvas PNG encode); still surface-only underneath.
 *
 * Mutating tools carry `write: true` and are hidden + refused unless the host
 * enables writes (ESTELLA_MCP_ALLOW_WRITES=1) — an agent can observe by default
 * but cannot silently rewrite a scene.
 */

const obj = (properties, required = []) => ({ type: 'object', properties, required });

// Render the viewport to a base64 PNG. Runs in the renderer (needs document):
// captureViewport returns bottom-up GL rows, so flip Y into a 2D canvas first.
const CAPTURE_PNG_JS = `(() => {
  const c = window.__estellaHeadless.api.captureViewport();
  const { rgba, width, height } = c;
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    img.data.set(rgba.subarray(src, src + width * 4), y * width * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png').split(',')[1];
})()`;

/** name → { description, schema (JSON Schema), method (surface), args(input)→[] }. */
export const TOOLS = [
  { name: 'load_scene',
    description: 'Load a scene (and optional asset manifest) into the headless World; returns the spawned entity count. Call first to set up a known scene.',
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
  { name: 'get_field_value',
    description: "One component field's current value (null if the field does not exist).",
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' }, key: { type: 'string' } },
      ['entity', 'component', 'key']),
    method: 'getFieldValue', args: (i) => [i.entity, i.component, i.key] },
  { name: 'serialize_scene',
    description: 'The full lossless scene JSON (the model truth).',
    schema: obj({}), method: 'serializeScene', args: () => [] },
  { name: 'add_entity', write: true,
    description: 'Create a new empty entity (with a Transform); returns its id.',
    schema: obj({}), method: 'addEntity', args: () => [] },
  { name: 'delete_entity', write: true,
    description: 'Delete an entity.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'deleteEntity', args: (i) => [i.id] },
  { name: 'duplicate_entity', write: true,
    description: 'Duplicate an entity (subtree); returns the new id.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'duplicateEntity', args: (i) => [i.id] },
  { name: 'rename_entity', write: true,
    description: 'Rename an entity.',
    schema: obj({ id: { type: 'number' }, name: { type: 'string' } }, ['id', 'name']),
    method: 'renameEntity', args: (i) => [i.id, i.name] },
  { name: 'set_field', write: true,
    description: 'Set a component field (undoable). `type` is the inspector field type (e.g. float, int, bool, string, vec2, vec3, color, enum).',
    schema: obj({
      entity: { type: 'number' }, component: { type: 'string' }, key: { type: 'string' },
      type: { type: 'string' }, value: {},
    }, ['entity', 'component', 'key', 'type', 'value']),
    method: 'setField', args: (i) => [i.entity, i.component, i.key, i.type, i.value] },
  { name: 'set_entity_xy', write: true,
    description: 'Move an entity to a world position (x, y) — converts to parent-local under the hood (undoable).',
    schema: obj({ id: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } }, ['id', 'x', 'y']),
    method: 'setEntityXY', args: (i) => [i.id, i.x, i.y] },
  { name: 'set_parent', write: true,
    description: 'Re-parent an entity in the transform hierarchy (parent=null → scene root).',
    schema: obj({ id: { type: 'number' }, parent: { type: ['number', 'null'] } }, ['id', 'parent']),
    method: 'setParent', args: (i) => [i.id, i.parent] },
  { name: 'select',
    description: 'Select an entity (id=null clears the selection).',
    schema: obj({ id: { type: ['number', 'null'] } }, ['id']), method: 'select', args: (i) => [i.id] },
  { name: 'get_selection',
    description: 'The primary selected entity id, or null.',
    schema: obj({}), method: 'getSelection', args: () => [] },
  { name: 'pick',
    description: 'Viewport pick: the entity a click at (clientX, clientY) would select, or null.',
    schema: obj({ clientX: { type: 'number' }, clientY: { type: 'number' } }, ['clientX', 'clientY']),
    method: 'pick', args: (i) => [i.clientX, i.clientY] },
  { name: 'set_run_mode',
    description: 'Enter or leave play mode (playing=true runs gameplay; Stop rebuilds the edit World).',
    schema: obj({ playing: { type: 'boolean' }, paused: { type: 'boolean' } }, ['playing']),
    method: 'setRunMode', args: (i) => [i.playing, i.paused] },
  { name: 'step',
    description: 'Advance the engine by N fixed-dt frames deterministically (no rAF). Step before capturing for a settled frame.',
    schema: obj({ frames: { type: 'number' }, dt: { type: 'number' } }),
    method: 'step', args: (i) => [i.frames, i.dt] },
  { name: 'resize_viewport',
    description: 'Resize the render canvas (the engine follows on the next stepped frame).',
    schema: obj({ width: { type: 'number' }, height: { type: 'number' } }, ['width', 'height']),
    method: 'resizeViewport', args: (i) => [i.width, i.height] },
  { name: 'capture_viewport',
    description: 'Render the current viewport and return it as a PNG image, so you can SEE what the editor drew. Step first for a settled frame.',
    schema: obj({}), js: () => CAPTURE_PNG_JS, image: true },
  { name: 'get_stats',
    description: 'Live counts: entity count + last frame draw calls (cheap render evidence).',
    schema: obj({}), method: 'getStats', args: () => [] },
  { name: 'get_subsystems',
    description: 'Lifecycle + liveness of every engine subsystem (physics, audio, …): phase and activity.',
    schema: obj({}), method: 'getSubsystems', args: () => [] },
  { name: 'undo', write: true, description: 'Undo the last edit.', schema: obj({}), method: 'undo', args: () => [] },
  { name: 'redo', write: true, description: 'Redo the last undone edit.', schema: obj({}), method: 'redo', args: () => [] },
];

/** MCP resources — read-only surface views an MCP client can subscribe to. */
export const RESOURCES = [
  { uri: 'editor://scene/tree', name: 'Scene tree', mimeType: 'application/json', method: 'getSceneTree' },
  { uri: 'editor://stats', name: 'Engine stats', mimeType: 'application/json', method: 'getStats' },
];

/** The MCP `tools/list` payload — name, description, JSON-Schema inputSchema.
 *  Without `allowWrites`, mutating tools are omitted entirely (not just refused). */
export function listTools(allowWrites = false) {
  return TOOLS.filter((t) => !t.write || allowWrites)
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
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
 * Validate `rawInput`, invoke the surface via the driver, and wrap the result as
 * an MCP CallToolResult. Method tools call `driver(method, args)`; renderer-code
 * tools call `driver.js(code)`. A gated write without permission, a validation
 * failure, or a driver throw becomes an `isError` result rather than a crash.
 */
export async function runTool(tool, driver, rawInput, allowWrites = true) {
  try {
    if (tool.write && !allowWrites) {
      throw new Error(`tool ${tool.name} mutates the scene — start the server with ESTELLA_MCP_ALLOW_WRITES=1`);
    }
    const input = validate(tool.schema, rawInput);
    if (tool.js) {
      const data = await driver.js(tool.js(input));
      return tool.image
        ? { content: [{ type: 'image', data, mimeType: 'image/png' }] }
        : { content: [{ type: 'text', text: String(data) }] };
    }
    const result = await driver(tool.method, tool.args(input));
    return { content: [{ type: 'text', text: result === undefined ? 'ok' : JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
