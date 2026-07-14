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
 * Tool shapes:
 *   - method tools: `{ method, args(input) }` → driver(method, args, root) — a
 *     surface call; `root: 'editor'` targets `window.__estellaEditor` (project /
 *     asset / play doors of the LIVE editor host) instead of the scene surface.
 *   - renderer-code tools: `{ js(input) }` → driver.js(code) — for routines that
 *     need the renderer's DOM (canvas PNG encode, window.estella bridge calls).
 *   - main-process ops: `{ op }` → driver.op(op) — host-side routines like the
 *     composited-window screenshot (the only way to see the play realm's OOPIF).
 *
 * Editor-host tools fail with a pointer when called on the headless fixtures
 * host. Mutating tools carry `write: true` and are hidden + refused unless the
 * host enables writes (ESTELLA_MCP_ALLOW_WRITES=1) — an agent can observe by
 * default but cannot silently rewrite a scene or a project.
 */

const obj = (properties, required = []) => ({ type: 'object', properties, required });

// Render the viewport to a base64 PNG. Runs in the renderer (needs document):
// captureViewport returns bottom-up GL rows, so flip Y into a 2D canvas first.
// Resolves the surface on either host (headless fixtures / live editor).
const CAPTURE_PNG_JS = `(() => {
  const c = (window.__estellaHeadless?.api ?? window.__estellaEditor.surface).captureViewport();
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
  { name: 'add_component', write: true,
    description: 'Add a component to an entity by schema name (what the Details "Add Component" button does; see get_inspector for current components). Undoable.',
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' } }, ['entity', 'component']),
    method: 'addComponent', args: (i) => [i.entity, i.component] },
  { name: 'remove_component', write: true,
    description: 'Remove a component from an entity by schema name. Undoable.',
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' } }, ['entity', 'component']),
    method: 'removeComponent', args: (i) => [i.entity, i.component] },
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
  { name: 'get_diagnostics',
    description: "Scene-wide validation issues the editor flags in the Details panel: required fields left empty (error-grade — a Sprite with no texture draws as a white box) and component inert-state notices. CHECK THIS after building or editing a scene; an empty list is the done signal.",
    schema: obj({}), method: 'getDiagnostics', args: () => [] },
  { name: 'get_stats',
    description: 'Live counts: entity count + last frame draw calls (cheap render evidence).',
    schema: obj({}), method: 'getStats', args: () => [] },
  { name: 'get_subsystems',
    description: 'Lifecycle + liveness of every engine subsystem (physics, audio, …): phase and activity.',
    schema: obj({}), method: 'getSubsystems', args: () => [] },
  { name: 'undo', write: true, description: 'Undo the last edit.', schema: obj({}), method: 'undo', args: () => [] },
  { name: 'redo', write: true, description: 'Redo the last undone edit.', schema: obj({}), method: 'redo', args: () => [] },

  // — Editor-host tools (root: 'editor'): the project/asset/play doors of the LIVE
  //   editor app. On the headless fixtures host these fail with a pointer to
  //   `editor-mcp.mjs --editor`. —
  { name: 'list_project_templates',
    description: "New-project templates the editor ships. Each entry: { name, dir, kind: 'starter' | 'example', description?, tag? } — the blank starter has kind 'starter'. Use an entry's dir with create_project.",
    schema: obj({}), js: () => `window.estella.templates.list()` },
  { name: 'create_project', write: true,
    description: 'Create a new project from a template directory (see list_project_templates) at <location>/<name>; returns the new project root. Follow with open_project.',
    schema: obj({ templateDir: { type: 'string' }, location: { type: 'string' }, name: { type: 'string' } },
      ['templateDir', 'location', 'name']),
    js: (i) => `window.estella.project.createFromTemplate(${JSON.stringify(i.templateDir)}, ${JSON.stringify(i.location)}, ${JSON.stringify(i.name)})` },
  { name: 'open_project',
    description: 'Open a project by absolute root path and enter the editor. Resolves once the initial scene is loaded and readable — call before any scene/asset work on the editor host.',
    schema: obj({ root: { type: 'string' } }, ['root']),
    js: (i) => `window.__estellaEditor.open(${JSON.stringify(i.root)})
      .then((ok) => { window.__estellaEditor.enterEditor(); return window.__estellaEditor.sceneReady().then(() => ok); })` },
  { name: 'open_scene',
    description: 'Open a scene by project-relative path (e.g. assets/scenes/main.esscene) in the editor. Resolves once the scene is adopted — get_scene_tree is immediately valid.',
    schema: obj({ path: { type: 'string' } }, ['path']),
    method: 'openScene', args: (i) => [i.path], root: 'editor' },
  { name: 'save_scene', write: true,
    description: 'Save the open scene to disk (the toolbar Save).',
    schema: obj({}), method: 'save', args: () => [], root: 'editor' },
  { name: 'create_scene_file', write: true,
    description: 'Create a blank scene FILE under a project-relative directory (does not switch to it); returns its path.',
    schema: obj({ destDir: { type: 'string' } }, ['destDir']),
    method: 'createSceneFile', args: (i) => [i.destDir], root: 'editor' },
  { name: 'create_asset', write: true,
    description: 'Create a text asset file under a project-relative directory with the given content (types the editor knows: scene, inputmap, locale, fsm, bt, timeline, animclip, tileset, material, shader, prefab...). Returns its project-relative path.',
    schema: obj({
      destDir: { type: 'string' }, baseName: { type: 'string' },
      content: { type: 'string' }, type: { type: 'string' },
    }, ['destDir', 'baseName', 'content', 'type']),
    js: (i) => `window.estella.project.createAsset(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.baseName)}, ${JSON.stringify(i.content)}, ${JSON.stringify(i.type)})` },
  { name: 'import_assets', write: true,
    description: 'Import external files (absolute paths: textures, audio, fonts, spine, tilemaps...) into a project-relative directory. Returns { imported, skipped }.',
    schema: obj({ destDir: { type: 'string' }, sources: { type: 'object', description: 'array of absolute file paths' } },
      ['destDir', 'sources']),
    js: (i) => `window.estella.project.importFiles(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.sources)})` },
  { name: 'set_project_physics', write: true,
    description: 'Patch the project physics feature (Project Settings → Physics), e.g. { "enabled": true }. Persists to the manifest; Play and exports boot it.',
    schema: obj({ patch: { type: 'object' } }, ['patch']),
    method: 'setPhysics', args: (i) => [i.patch], root: 'editor' },
  { name: 'list_entity_templates',
    description: "The Create-popover catalog: every ready-made entity the editor can spawn (id, label, category). Use an id with create_entity.",
    schema: obj({}), method: 'listEntityTemplates', args: () => [], root: 'editor' },
  { name: 'create_entity', write: true,
    description: 'Spawn a ready-made entity from a template id (see list_entity_templates) through the same pipeline as the Create menu; returns the new entity id. Optional world position and parent.',
    schema: obj({
      template: { type: 'string' }, parent: { type: ['number', 'null'] },
      x: { type: 'number' }, y: { type: 'number' },
    }, ['template']),
    method: 'createEntity',
    args: (i) => [i.template, { parent: i.parent ?? null, x: i.x, y: i.y }], root: 'editor' },
  { name: 'toggle_play',
    description: 'Toggle play mode in the editor (check get_play_state first; play runs the game in an isolated realm and never dirties the edit scene).',
    schema: obj({}), method: 'play', args: () => [], root: 'editor' },
  { name: 'get_play_state',
    description: 'The play realm state: { playing, ready, error }.',
    schema: obj({}), method: 'playState', args: () => [], root: 'editor' },
  { name: 'screenshot',
    description: 'Capture the composited editor window as a PNG (includes the play realm iframe — use this to SEE gameplay; capture_viewport only sees the edit viewport).',
    schema: obj({}), op: 'screenshot', image: true },
  { name: 'play_probe', write: true,
    description: "Evaluate JS inside the RUNNING play realm and return the result — the gameplay probe. window.__estellaPlay = { app, getComponent } for state reads; to drive gameplay input, dispatch KeyboardEvents on DOCUMENT (the engine listens there, not on window): document.dispatchEvent(new KeyboardEvent('keydown', {code:'ArrowRight'})). frame picks the realm in multiplayer previews (0 = host).",
    schema: obj({ code: { type: 'string' }, frame: { type: 'number' } }, ['code']),
    op: 'play_probe' },
  { name: 'world_component',
    description: "A LIVE World component's data for a source entity, resolved by component name — verifies an edit actually reached the engine.",
    schema: obj({ id: { type: 'number' }, component: { type: 'string' } }, ['id', 'component']),
    method: 'worldComp', args: (i) => [i.id, i.component], root: 'editor' },
  { name: 'get_logs',
    description: "The editor Output Log's newest entries (editor + SDK + engine + play realm console) — check here when play looks wrong or a build fails.",
    schema: obj({ tail: { type: 'number' } }),
    method: 'logs', args: (i) => [i.tail], root: 'editor' },
  { name: 'reveal_panel',
    description: "Reveal a dock panel by id (viewport, log, sequencer, profiler, audiomixer...) — useful before a screenshot.",
    schema: obj({ id: { type: 'string' } }, ['id']),
    method: 'reveal', args: (i) => [i.id], root: 'editor' },
  { name: 'run_editor_command', write: true,
    description: 'Dispatch any registered editor command by id (the UI\'s own channel) — the escape hatch for operations without a dedicated tool.',
    schema: obj({ id: { type: 'string' } }, ['id']),
    method: 'runCommand', args: (i) => [i.id], root: 'editor' },
  { name: 'export_game', write: true,
    description: 'Build + export the open project. platform: web | desktop | wechat | playable. Returns the export result (outDir, files...).',
    schema: obj({
      platform: { type: 'string' }, outDir: { type: 'string' },
      minify: { type: 'boolean' }, compressTextures: { type: 'boolean' },
      compressAudio: { type: 'boolean' }, atlasTextures: { type: 'boolean' },
    }, ['platform']),
    js: (i) => `window.estella.project.exportGame(${JSON.stringify({
      platform: i.platform, outDir: i.outDir, minify: i.minify,
      compressTextures: i.compressTextures, compressAudio: i.compressAudio, atlasTextures: i.atlasTextures,
    })})` },
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
 * an MCP CallToolResult. Method tools call `driver(method, args, root)`;
 * renderer-code tools call `driver.js(code)`; main-process ops call
 * `driver.op(op)`. A gated write without permission, a validation failure, or a
 * driver throw becomes an `isError` result rather than a crash.
 */
export async function runTool(tool, driver, rawInput, allowWrites = true) {
  try {
    if (tool.write && !allowWrites) {
      throw new Error(`tool ${tool.name} mutates the scene — start the server with ESTELLA_MCP_ALLOW_WRITES=1`);
    }
    const input = validate(tool.schema, rawInput);
    if (tool.op) {
      const data = await driver.op(tool.op, input);
      if (tool.image) return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      return { content: [{ type: 'text', text: data === undefined ? 'ok' : JSON.stringify(data) }] };
    }
    if (tool.js) {
      const data = await driver.js(tool.js(input));
      if (tool.image) return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      return { content: [{ type: 'text', text: data === undefined ? 'ok' : JSON.stringify(data) }] };
    }
    const result = await driver(tool.method, tool.args(input), tool.root);
    return { content: [{ type: 'text', text: result === undefined ? 'ok' : JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
