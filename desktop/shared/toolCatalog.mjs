// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  toolCatalog.mjs
 *        The editor's tool registry — the ONE catalog every agent front serves:
 *        the MCP stdio front, the headless fixtures host, and the editor's own
 *        built-in agent. Each tool maps 1:1 to an EditorControlSurface method, so
 *        no front adds editor truth — each is a transport over the surface
 *        (exactly what EditorControlSurface.ts:7-9 anticipated).
 *
 *        Lives in shared/ rather than scripts/ because three processes import it,
 *        and stays plain .mjs because one of them is plain node: `node
 *        scripts/editor-mcp.mjs` is a documented dev entry, and the shipped
 *        integration point is the esbuild bundle of that same file. Kept
 *        dependency-free (JSON-Schema + light manual validation, no zod import)
 *        so the dispatch unit-tests without Electron and resolves under
 *        vite/vitest. See docs/REARCH_EDITOR_ARCH.md §11.
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
 * host.
 *
 * Every tool declares an `effect`, and the tiers are drawn where UNDO STOPS
 * WORKING — which is what makes them actionable rather than decorative:
 *
 *   read          observes only. Never gated, never confirmed.
 *   undoable      mutates the document through EditorHistory. A built-in agent
 *                 runs these freely: the turn is bracketed by a history
 *                 checkpoint, so one Undo is the whole approval mechanism.
 *   irreversible  escapes the undo stack — writes a file, rewrites a project,
 *                 builds an export, or dispatches an arbitrary command. A
 *                 built-in agent must get explicit confirmation; undo cannot
 *                 rescue the user afterwards.
 *
 * A remote MCP client has no one to confirm with, so it keeps the coarser door
 * it always had: anything past `read` is hidden AND refused unless the host sets
 * ESTELLA_MCP_ALLOW_WRITES=1. An agent can observe by default but cannot
 * silently rewrite a scene or a project.
 */

const obj = (properties, required = []) => ({ type: 'object', properties, required });

/** Whether `tool` mutates anything — the remote gate's question. Absent `effect`
 *  reads as 'read', so a tool that declares nothing is treated as harmless only
 *  when it genuinely is; every mutating entry below states its tier. */
export const mutates = (tool) => (tool.effect ?? 'read') !== 'read';

/** Whether `tool` is past what an undo can revert — the in-editor agent's
 *  confirmation gate. */
export const irreversible = (tool) => tool.effect === 'irreversible';

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
    description: 'FIXTURES ONLY: fetch a scene by URL into the headless World; returns the spawned entity count. '
      + 'With a project open this is the wrong door — a project path is not a URL and the fetch 404s: use open_scene, '
      + 'which the project already knows how to resolve.',
    schema: obj({ sceneUrl: { type: 'string' }, manifestUrl: { type: 'string' } }, ['sceneUrl']),
    method: 'loadScene', args: (i) => [i.sceneUrl, i.manifestUrl] },
  { name: 'get_scene_tree',
    description: 'The scene entity tree (id, name, kind, children).',
    schema: obj({}), method: 'getSceneTree', args: () => [] },
  { name: 'get_entity',
    description: 'One entity: name, kind, and its component list. A member of a prefab INSTANCE also carries '
      + '`prefab: { ref, prefabId, instanceRoot, isRoot }` — how to tell an instance from an ordinary entity, and what edit_prefab / apply_prefab / revert_prefab / unpack_prefab act on (resolve `ref` to a path with list_assets).',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'getEntity', args: (i) => [i.id] },
  { name: 'get_inspector',
    description: "An entity's components and fields — the Details-panel data.",
    schema: obj({ entity: { type: 'number' } }, ['entity']), method: 'getInspector', args: (i) => [i.entity] },
  { name: 'describe_component',
    description: "A component TYPE's fields before you write any: key, label, inspector type, enum options and the default. "
      + 'Ask this instead of guessing a field name — the registry knows that ShapeRenderer takes `shapeType` (0 Circle / 1 Capsule / 2 RoundedRect), not `shape` or `fill`. '
      + 'get_inspector answers the same question about a LIVE entity; this one needs no entity to exist. '
      + 'WITHOUT `component` it lists every component that can be added (name, label, category), including the '
      + "project's own — which is the answer to \"what can I put on an entity\", and beats guessing at names.",
    schema: obj({ component: { type: 'string' } }),
    method: 'describeComponent', args: (i) => [i.component ?? null] },
  { name: 'get_field_value',
    description: "One component field's current value (null if the field does not exist).",
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' }, key: { type: 'string' } },
      ['entity', 'component', 'key']),
    method: 'getFieldValue', args: (i) => [i.entity, i.component, i.key] },
  { name: 'serialize_scene',
    description: 'The full lossless scene JSON (the model truth).',
    schema: obj({}), method: 'serializeScene', args: () => [] },
  { name: 'add_entity', effect: 'undoable',
    description: 'Create a new empty entity (with a Transform); returns its id.',
    schema: obj({}), method: 'addEntity', args: () => [] },
  { name: 'delete_entity', effect: 'undoable',
    description: 'Delete an entity.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'deleteEntity', args: (i) => [i.id] },
  { name: 'duplicate_entity', effect: 'undoable',
    description: 'Duplicate an entity (subtree); returns the new id.',
    schema: obj({ id: { type: 'number' } }, ['id']), method: 'duplicateEntity', args: (i) => [i.id] },
  { name: 'rename_entity', effect: 'undoable',
    description: 'Rename an entity.',
    schema: obj({ id: { type: 'number' }, name: { type: 'string' } }, ['id', 'name']),
    method: 'renameEntity', args: (i) => [i.id, i.name] },
  { name: 'set_field', effect: 'undoable',
    description: 'Set a component field (undoable). The field\'s DECLARED inspector type wins (see get_inspector: number, bool, string, vec2, vec3, angle, color, enum, select, flags, gradient, curve, dimension, asset) — `type` is advisory. Vecs take [x, y(, z)] number arrays, colors "#rrggbbaa" hex or {r,g,b,a} 0..1, assets a project-relative path or @uuid ref. '
      + '`key` may name one MEMBER of a structural field — "position.x" / "position.z" (vec2/vec3), "gap.y", "padding.left" (sides), "width.value" / "width.unit" (dimension) — which reads and writes back the rest, so one number does not cost a read-modify-write. '
      + 'Unknown components/fields and malformed values are errors, never silent writes.',
    schema: obj({
      entity: { type: 'number' }, component: { type: 'string' }, key: { type: 'string' },
      type: { type: 'string' },
      // A real type union — with a bare {} here, MCP clients treat the param as
      // schema-less and serialize the value to raw JSON TEXT ("[16, 16]"), which
      // then has to be parsed back editor-side (coerceFieldValue does, but a
      // typed schema lets well-behaved clients send real JSON in the first place).
      value: { type: ['number', 'string', 'boolean', 'array', 'object', 'null'] },
    }, ['entity', 'component', 'key', 'type', 'value']),
    method: 'setField', args: (i) => [i.entity, i.component, i.key, i.type, i.value] },
  { name: 'add_component', effect: 'undoable',
    description: 'Add a component to an entity by schema name (what the Details "Add Component" button does; see get_inspector for current components). Undoable.',
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' } }, ['entity', 'component']),
    method: 'addComponent', args: (i) => [i.entity, i.component] },
  { name: 'remove_component', effect: 'undoable',
    description: 'Remove a component from an entity by schema name. Undoable.',
    schema: obj({ entity: { type: 'number' }, component: { type: 'string' } }, ['entity', 'component']),
    method: 'removeComponent', args: (i) => [i.entity, i.component] },
  { name: 'get_event_bindings',
    description: "An entity's authored event wires: rows of { event, action, arg?, params?, target?, guard?, once?, enabled? } — the data form of \"when this button is clicked, run that action\".",
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    method: 'getEventBindings', args: (i) => [i.entity] },
  { name: 'set_event_bindings', effect: 'undoable',
    description: 'Replace an entity\'s authored event wires in ONE undo step (an empty list unwires it). This is how a button gets behaviour without code: `[{"event":"click","action":"panel.open","params":{"prefab":"assets/prefabs/Shop.esprefab"}}]`. '
      + '`action` is any name in the action registry — the engine\'s built-ins (property.set, ui.setVisible, fsm.fire…) or one the project registered — and `target` names another entity to run it on (nearest-first from this one). '
      + 'EventBinding has no Add Component entry; this is its door.',
    schema: obj({ entity: { type: 'number' }, rows: { type: 'object', description: 'array of wire rows' } }, ['entity', 'rows']),
    method: 'setEventBindings', args: (i) => [i.entity, i.rows] },
  { name: 'set_entity_xy', effect: 'undoable',
    description: 'Move an entity to a world position (x, y) — converts to parent-local under the hood (undoable).',
    schema: obj({ id: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } }, ['id', 'x', 'y']),
    method: 'setEntityXY', args: (i) => [i.id, i.x, i.y] },
  { name: 'set_parent', effect: 'undoable',
    description: 'Re-parent an entity in the transform hierarchy (parent=null → scene root).',
    schema: obj({ id: { type: 'number' }, parent: { type: ['number', 'null'] } }, ['id', 'parent']),
    method: 'setParent', args: (i) => [i.id, i.parent] },
  { name: 'select',
    description: 'Select an entity (id=null clears the selection).',
    schema: obj({ id: { type: ['number', 'null'] } }, ['id']), method: 'select', args: (i) => [i.id] },
  { name: 'select_asset',
    description: "Select an asset by project-relative path — what clicking it in the Content Browser does. The Details panel then shows that asset's inspector (import settings, previews, the 9-slice border editor for textures). Pass null to clear.",
    schema: obj({ path: { type: ['string', 'null'] } }, ['path']),
    method: 'selectAsset', args: (i) => [i.path], root: 'editor' },
  { name: 'get_selection',
    description: 'The primary selected entity id, or null.',
    schema: obj({}), method: 'getSelection', args: () => [] },
  { name: 'pick',
    description: 'Viewport pick: the entity a click at (clientX, clientY) would select, or null.',
    schema: obj({ clientX: { type: 'number' }, clientY: { type: 'number' } }, ['clientX', 'clientY']),
    method: 'pick', args: (i) => [i.clientX, i.clientY] },
  { name: 'set_run_mode',
    description: 'Run gameplay against the EDIT World (Stop rebuilds it from the model). This is the headless host\'s play; '
      + "in the editor app the project's scripts live in the play realm and not in this World, so there it refuses and names toggle_play — "
      + 'which is the one to reach for when the question is "does the game work".',
    schema: obj({ playing: { type: 'boolean' }, paused: { type: 'boolean' } }, ['playing']),
    method: 'setRunMode', args: (i) => [i.playing, i.paused] },
  { name: 'step',
    description: 'Advance the engine by N fixed-dt frames deterministically (no rAF). Step before capturing for a settled frame.',
    schema: obj({ frames: { type: 'number' }, dt: { type: 'number' } }),
    method: 'step', args: (i) => [i.frames, i.dt] },
  { name: 'resize_viewport',
    description: "Resize the render canvas's DRAWING BUFFER — the resolution the engine renders and capture_viewport reads. The engine follows on the next stepped frame. "
      + 'In the LIVE editor the canvas is laid out by its panel, so the next layout pass re-derives this from the panel size; to size the live viewport, use set_panel_size instead.',
    schema: obj({ width: { type: 'number' }, height: { type: 'number' } }, ['width', 'height']),
    method: 'resizeViewport', args: (i) => [i.width, i.height] },
  { name: 'set_panel_size',
    description: "Resize a docked panel (id: viewport, log, outliner, details, content...) — the live editor's real sizing door. The viewport canvas follows layout, so this is how you give the LIVE viewport a chosen size before a screenshot.",
    schema: obj({
      id: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' },
    }, ['id']),
    method: 'setPanelSize', args: (i) => [i.id, { width: i.width, height: i.height }], root: 'editor' },
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
  { name: 'undo', effect: 'undoable', description: 'Undo the last edit.', schema: obj({}), method: 'undo', args: () => [] },
  { name: 'redo', effect: 'undoable', description: 'Redo the last undone edit.', schema: obj({}), method: 'redo', args: () => [] },

  // — Editor-host tools (root: 'editor'): the project/asset/play doors of the LIVE
  //   editor app. On the headless fixtures host these fail with a pointer to
  //   `editor-mcp.mjs --editor`. —
  { name: 'list_project_templates',
    description: "New-project templates the editor ships. Each entry: { name, dir, kind: 'starter' | 'example', description?, tag? } — the blank starter has kind 'starter'. Use an entry's dir with create_project.",
    // Without the thumbnails. Each is a data-URL PNG for the launcher's cards and
    // they came to 1.4 MB of base64 in one reply — past any caller's truncation
    // limit, and worth nothing to a caller that cannot look at a picture. The
    // fields documented above are the whole answer.
    schema: obj({}),
    js: () => `window.estella.templates.list().then((all) => all.map(({ thumbnail, ...rest }) => rest))` },
  { name: 'create_project', effect: 'irreversible',
    description: 'Create a new project from a template directory (see list_project_templates) at <location>/<name>; returns the new project root. Follow with open_project.',
    schema: obj({ templateDir: { type: 'string' }, location: { type: 'string' }, name: { type: 'string' } },
      ['templateDir', 'location', 'name']),
    js: (i) => `window.estella.project.createFromTemplate(${JSON.stringify(i.templateDir)}, ${JSON.stringify(i.location)}, ${JSON.stringify(i.name)})` },
  { name: 'open_project',
    description: 'Open a project by absolute root path and enter the editor. Resolves TRUE once the initial scene is loaded and readable — call before any scene/asset work on the editor host. Throws, naming the step that failed, if the project cannot be opened or no scene loads; it never reports a failure as a plain false, because a caller that keeps going against a project that never opened just collects "no project open" from every later tool.',
    schema: obj({ root: { type: 'string' } }, ['root']),
    js: (i) => `window.__estellaEditor.open(${JSON.stringify(i.root)})` },
  { name: 'open_scene',
    description: 'Open a scene by project-relative path (e.g. assets/scenes/main.esscene) in the editor. Resolves once the scene is adopted — get_scene_tree is immediately valid. '
      + 'REFUSES while the open scene has unsaved changes (opening reloads from disk, so anything just authored would be gone): save_scene first, or pass discardChanges to throw the edits away on purpose.',
    schema: obj({ path: { type: 'string' }, discardChanges: { type: 'boolean' } }, ['path']),
    method: 'openScene', args: (i) => [i.path, i.discardChanges === true], root: 'editor' },
  { name: 'save_scene', effect: 'irreversible',
    description: 'Save the open DOCUMENT to disk (the toolbar Save) — the scene, or, in Prefab Mode, the prefab being edited (see get_document).',
    schema: obj({}), method: 'save', args: () => [], root: 'editor' },
  { name: 'open_asset',
    description: 'Open an asset in the editor that owns its type, awaited (the Content Browser double-click): a PREFAB enters Prefab Mode — the prefab as its own editable entity tree, where every scene tool then acts on the prefab, and save_scene writes the asset for every instance; '
      + 'a scene becomes the document; anything else (statemachine, behaviortree, tileset, animclip, animation, material, materialgraph) opens its own editor panel. Returns the document afterwards, same shape as get_document. '
      + 'REFUSES, rather than prompting, when opening a scene/prefab would discard unsaved changes (pass discardChanges to throw them away), and refuses a type the editor has no editor for instead of handing the file to an external program.',
    schema: obj({ path: { type: 'string' }, discardChanges: { type: 'boolean' } }, ['path']),
    js: (i) => `window.__estellaEditor.openAsset(${JSON.stringify(i.path)}, ${i.discardChanges === true})` },
  { name: 'get_document',
    description: 'What the editor is editing right now: { kind: "scene" | "prefab", path, name, dirty } (+ isVariant / returnScene in Prefab Mode). '
      + 'CHECK THIS after open_asset — in Prefab Mode every scene read/write tool acts on the PREFAB, not on a scene, and `dirty` says whether anything is unsaved.',
    schema: obj({}), js: () => `window.__estellaEditor.documentState()` },
  { name: 'exit_prefab_mode',
    description: 'Leave Prefab Mode and go back to the scene you came from (the banner\'s "Back to Scene"). REFUSES on unsaved prefab changes unless discardChanges.',
    schema: obj({ discardChanges: { type: 'boolean' } }),
    js: (i) => `window.__estellaEditor.exitPrefabMode(${i.discardChanges === true})` },
  { name: 'edit_prefab',
    description: 'Open the prefab an INSTANCE came from, in Prefab Mode (the Outliner\'s "Edit Prefab") — no ref→path lookup needed. Same refusals as open_asset.',
    schema: obj({ entity: { type: 'number' }, discardChanges: { type: 'boolean' } }, ['entity']),
    js: (i) => `window.__estellaEditor.editPrefab(${Number(i.entity)}, ${i.discardChanges === true})` },
  { name: 'apply_prefab', effect: 'irreversible',
    description: 'Push an instance\'s overrides back into its prefab asset (the Outliner\'s "Apply to Prefab") — the base for EVERY instance is rewritten, and this instance\'s overrides clear. '
      + 'Property, name, visibility and component overrides plus structural add/remove. `confirm` must be true: a person is shown an itemized diff first, so a driver says it out loud instead (get_inspector marks the overridden fields).',
    schema: obj({ entity: { type: 'number' }, confirm: { type: 'boolean' } }, ['entity', 'confirm']),
    js: (i) => `window.__estellaEditor.applyPrefab(${Number(i.entity)}, ${i.confirm === true})` },
  { name: 'revert_prefab', effect: 'undoable',
    description: 'Discard an instance\'s overrides and re-sync it to its prefab (the Outliner\'s "Revert to Prefab"), keeping its placement. Returns the fresh instance root\'s id — the old ids are gone (it is a delete + re-instantiate).',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.revertPrefab(${Number(i.entity)})` },
  { name: 'unpack_prefab', effect: 'undoable',
    description: 'Detach an instance (the Outliner\'s "Unpack Prefab"): its entities become ordinary scene entities and lose every prefab link, so later prefab edits no longer reach them. Undoable.',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.unpackPrefab(${Number(i.entity)})` },
  { name: 'create_prefab_variant', effect: 'irreversible',
    description: 'Save a new `.esprefab` that INHERITS the instance\'s prefab and bakes in its current overrides (the Outliner\'s "Create Variant" — a prefab of a prefab), then re-link the instance to the variant. '
      + 'Written beside the base as "<base> Variant.esprefab"; returns the re-linked root\'s id. Deletions are not representable in a variant and are skipped.',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.createPrefabVariant(${Number(i.entity)})` },
  { name: 'create_scene_file', effect: 'irreversible',
    description: 'Create a blank scene FILE under a project-relative directory (does not switch to it); returns its path, immediately referenceable (the registry refresh happens before this resolves). '
      + '`name` names it (the `.esscene` extension is added if absent); without one it is `scene.esscene`, which collides the moment you make a second.',
    schema: obj({
      destDir: { type: 'string' }, name: { type: 'string' },
      overwrite: { type: 'boolean', description: 'a NAMED scene that already exists is emptied and reused (its uuid is kept, so refs survive) instead of the call being refused' },
    }, ['destDir']),
    js: (i) => `window.__estellaEditor.createSceneFile(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.name ?? null)}, ${JSON.stringify({ overwrite: i.overwrite === true })})
      .then((p) => window.__estellaEditor.refreshAssets().then(() => p))` },
  { name: 'create_prefab_from_entity', effect: 'irreversible',
    description: 'Extract an entity and its subtree into a `.esprefab` asset under assets/prefabs/ (the Outliner\'s Create Prefab), named after the entity; returns its `@uuid:` ref. '
      + 'This is what makes a subtree REUSABLE: afterwards `list_entity_templates` offers it as `prefab:<path>`, and creating with that template makes a real INSTANCE — the scene stores a delta, not a copy, so editing the prefab updates every instance. '
      + 'Without it a driver can build the same panel chrome into twenty scenes but never share it. Refs pointing OUT of the subtree cannot live in a standalone prefab and are cleared.',
    schema: obj({
      entity: { type: 'number' },
      replace: { type: 'boolean', description: 'overwrite the asset this name already maps to, KEEPING its uuid — what re-extracting a prefab means. Without it the name is deduped to "<name>-1.esprefab" and every existing instance keeps pointing at the stale asset.' },
    }, ['entity']),
    js: (i) => `window.__estellaEditor.createPrefabFromEntity(${Number(i.entity)}, ${JSON.stringify({ replace: i.replace === true })})
      .then((ref) => { if (!ref) throw new Error('could not create a prefab from entity ${Number(i.entity)} — it may not exist'); return ref; })` },
  { name: 'create_script', effect: 'irreversible',
    description: "Create a project script the editor will actually LOAD. `kind`: 'component' — a declaration the editor "
      + "reads without running the game, which is what makes a component ADDABLE (add_component / apply_scene_ops) — or "
      + "'system', behaviour the play realm bundles and runs. It writes the module AND wires it into the project's "
      + 'declaration / startup entry, which is the step write_project_file does not do: a .ts file nothing imports is a '
      + 'file the editor never sees. `name` is the identifier and the file stem; `dir` is optional (defaults to the '
      + "project's source root). Returns { ok, path, wiredInto, wiredLine } or { ok: false, error }.",
    schema: obj({
      kind: { type: 'string' }, name: { type: 'string' }, dir: { type: 'string' },
    }, ['kind', 'name']),
    js: (i) => `window.estella.project.createScript(${JSON.stringify(i.kind)}, ${JSON.stringify(i.name)}, ${JSON.stringify(i.dir ?? undefined)})` },
  { name: 'create_asset', effect: 'irreversible',
    description: 'Create a text asset file under a project-relative directory with the given content. `type` is the meta vocabulary: scene, prefab, shader, material, animclip (.esanim), animation (.estimeline), tileset, statemachine (.esfsm), behaviortree (.esbt), locale, inputmap, tilemap (.tmj). A bare baseName gets the type\'s canonical extension appended. Returns the project-relative path, immediately referenceable (the registry refresh happens before this resolves).',
    schema: obj({
      destDir: { type: 'string' }, baseName: { type: 'string' },
      content: { type: 'string' }, type: { type: 'string' },
    }, ['destDir', 'baseName', 'content', 'type']),
    js: (i) => `window.estella.project.createAsset(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.baseName)}, ${JSON.stringify(i.content)}, ${JSON.stringify(i.type)})
      .then((p) => window.__estellaEditor.refreshAssets().then(() => p))` },
  { name: 'import_assets', effect: 'irreversible',
    description: 'Import files into the asset registry (textures, audio, fonts, spine, tilemaps...). External absolute paths are copied into project-relative destDir; paths already INSIDE the project are registered in place (no copy, no rename). Returns { imported, skipped }; imported paths are immediately referenceable (the registry refresh happens before this resolves).',
    schema: obj({ destDir: { type: 'string' }, sources: { type: 'object', description: 'array of absolute file paths' } },
      ['destDir', 'sources']),
    js: (i) => `window.estella.project.importFiles(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.sources)})
      .then((r) => window.__estellaEditor.refreshAssets().then(() => r))` },
  { name: 'apply_scene_ops', effect: 'undoable',
    description: 'Author a whole subtree in ONE undoable batch — the tool to build scenes with (set_field one field per call does not scale past a few dozen nodes). '
      + '`ops` is an array executed in order, atomically: a throw anywhere rolls the WHOLE batch back. Op shapes: '
      + '{op:"create", ref?, name?, parent?, template?, components?, fields?, x?, y?} — `template` is an entity-template id (list_entity_templates, e.g. "ui-image"), '
      + 'or give `components` as ["Transform","UINode","UIVisual"] / [{type,data}]; '
      + '{op:"set", entity, fields}; {op:"add_component"|"remove_component", entity, component}; {op:"rename", entity, name}; {op:"parent", entity, parent}; {op:"delete", entity}. '
      + 'ENTITY ADDRESSING: an entity is a live numeric id, or "$name" naming an earlier create\'s `ref` — so a parent/child tree is one call with no round trip to learn ids. '
      + 'A `$ref` lives for THIS call only; the returned `refs` map is how its ids reach the next one. '
      + 'FIELDS is a flat map of "Component.key" → value, e.g. {"Transform.position.x": 10, "UIVisual.color": "#ff0000ff", "Text.content": "Hi"} — same coercion and validation as set_field, '
      + 'including one member of a structural field ("FlexContainer.gap.x", "UINode.marginLeft"). '
      + 'Give either `ops` inline or `opsPath` (a JSON file), never both. Returns { refs: {name: id}, created: [id], applied: n, warnings? } — `warnings` names writes that were accepted and will NOT survive (a field the layout owns), so read it. Check get_diagnostics afterwards.',
    schema: obj({
      ops: { type: 'array', description: 'the op program, executed in order as one undo step' },
      opsPath: { type: 'string', description: 'project-relative path to a JSON file holding the op array, INSTEAD of `ops` — a panel of a few hundred entities is a few hundred KB of program, which does not belong in a message. Write it with write_project_file, then name it here.' },
      label: { type: 'string', description: 'undo-stack label (default "Apply scene ops")' },
    }),
    // Only the file form needs the escape hatch; an inline program goes through
    // the typed door like everything else.
    js: (i) => (i.opsPath
      ? `window.estella.fs.read(${JSON.stringify(i.opsPath)})
          .then((text) => window.__estellaEditor.applyOps(JSON.parse(text), ${JSON.stringify(i.label ?? null)}))`
      : null),
    method: 'applyOps', args: (i) => [i.ops, i.label], root: 'editor' },
  // — The open asset editors. One set of doors for all eight kinds, because they
  //   share AssetDocument: `open_asset` puts one on screen, these read and write
  //   it. A clip, a timeline, a tileset and a material graph differ in what they
  //   HOLD, not in how they are edited, so a tool set per kind would be the same
  //   three verbs written eight times and drifting apart. —
  { name: 'list_asset_documents', effect: 'read',
    description: 'Which asset editors are open right now (animation clip, timeline, tileset, material, material graph, animator/state/behaviour graph), with their file path and whether they have unsaved edits. Use it to learn the `docId` the other two tools take when more than one is open.',
    schema: obj({}),
    js: () => 'window.__estellaEditor.assetDocuments()', root: 'editor' },
  { name: 'get_asset_document', effect: 'read',
    description: "An open asset editor's document, in full, exactly as the editor holds it — the frames of a clip, the tracks of a timeline, the tiles of a tileset, the nodes of a graph. THIS is how you read those files: read_project_file gives you bytes on disk, which are stale the moment the editor has unsaved edits. Omit `docId` when only one is open.",
    schema: obj({ docId: { type: 'string' } }),
    js: (i) => `window.__estellaEditor.getAssetDocument(${JSON.stringify(i.docId ?? null)} ?? undefined)`,
    root: 'editor' },
  { name: 'edit_asset_document', effect: 'undoable',
    description: 'Write fields of an open asset editor\'s document as ONE undo step. `changes` is [{path, value}], where `path` is dotted and addresses the typed asset the same way set_field addresses a component: "frames.0.duration", "tracks.2.keys.5.value", "nodes.3.position.x". '
      + 'A numeric segment indexes an array. Paths that do not already exist are REFUSED rather than created — these are typed documents whose editors rely on their shape, and inventing a field produces a file that loads as something else. Read it with get_asset_document first. '
      + 'It goes through the same door the editor\'s own UI writes through, so the panel updates and one Undo takes the whole call back.',
    schema: obj({
      changes: { type: 'array', description: '[{ path, value }], applied in order as one undo step' },
      docId: { type: 'string', description: 'which open document, when more than one is' },
      label: { type: 'string', description: 'undo-stack label (default "Edit asset")' },
    }, ['changes']),
    js: (i) => `window.__estellaEditor.editAssetDocument(${JSON.stringify(i.changes)}, ${JSON.stringify(i.docId ?? null)} ?? undefined, ${JSON.stringify(i.label ?? null)} ?? undefined)`,
    root: 'editor' },

  // — Tilemaps. Painting is not a field write: a cell is addressed by grid
  //   coordinate, and a stroke is hundreds of them in one undo step. —
  { name: 'create_tilemap', effect: 'undoable',
    description: 'Create a tilemap entity from a tileset asset (project-relative .estileset path). `grid` optionally overrides the tileset\'s own cell size/shape: { tileWidth, tileHeight, orientation }. Returns the new entity id.',
    schema: obj({
      tilesetPath: { type: 'string' },
      grid: { type: 'object', description: 'optional { tileWidth, tileHeight, orientation }' },
    }, ['tilesetPath']),
    js: (i) => `window.__estellaEditor.createTilemap(${JSON.stringify(i.tilesetPath)}, ${JSON.stringify(i.grid ?? null)} ?? undefined)`,
    root: 'editor' },
  { name: 'paint_tiles', effect: 'undoable',
    description: 'Paint cells of a tilemap layer in ONE undo step. `edits` is [{x, y, tileId}] in GRID coordinates (not pixels); tileId 0 clears a cell. `source` is the tilemap entity id. This is the tool for laying out a level — set_field cannot reach a cell.',
    schema: obj({
      source: { type: 'number', description: 'the tilemap entity' },
      edits: { type: 'array', description: '[{ x, y, tileId }] in grid coordinates' },
    }, ['source', 'edits']),
    js: (i) => `window.__estellaEditor.paintTiles(${i.source}, ${JSON.stringify(i.edits)})`,
    root: 'editor' },
  { name: 'get_tile_collision', effect: 'read',
    description: 'The collision shapes a tilemap currently generates, for checking that a painted level is walkable before running it.',
    schema: obj({ source: { type: 'number' } }, ['source']),
    js: (i) => `window.__estellaEditor.probeTileCollision(${i.source})`, root: 'editor' },

  { name: 'refresh_assets',
    description: 'Re-scan the project into the asset registry. The editor watches the filesystem, but a batch written from outside (a converter copying twenty sprites in) can outrun the watcher — and until the scan lands those files have no `.meta`, so `set_import_settings` and any @uuid ref to them fail. Cheap and idempotent; call it after writing assets by hand.',
    schema: obj({}),
    js: () => 'window.__estellaEditor.refreshAssets().then(() => true)' },
  { name: 'list_assets',
    description: 'Search the open project\'s asset registry. `match` is a case-insensitive SUBSTRING of the project-relative path (not a glob); `type` filters by asset type (texture, scene, prefab, audio, font, material, shader...). '
      + 'Returns { total, assets: [{ ref, path, name, type }] } — `total` is the full match count, `assets` is capped by `limit` (default 200). The `ref` is the stable @uuid: form to write into asset fields.',
    schema: obj({
      match: { type: 'string' }, type: { type: 'string' }, limit: { type: 'number' },
    }),
    method: 'listAssets', args: (i) => [{ match: i.match, type: i.type, limit: i.limit }], root: 'editor' },
  { name: 'get_import_settings',
    description: "An asset's .meta import settings, layered over its type's defaults — the Import Settings panel's data. Returns { type, settings }.",
    schema: obj({ path: { type: 'string' } }, ['path']),
    method: 'getImportSettings', args: (i) => [i.path], root: 'editor' },
  { name: 'set_import_settings', effect: 'irreversible',
    description: 'Patch an asset\'s .meta import settings and persist. Keys are DOTTED paths into the importer block, matching the inspector field keys — a texture\'s 9-slice border is '
      + '{"sliceBorder.left":12,"sliceBorder.right":12,"sliceBorder.top":12,"sliceBorder.bottom":12}; filter/wrap are {"filterMode":"nearest","wrapMode":"clamp"}. '
      + 'These live in IMPORT, not on a component: a UIVisual set to NineSlice takes its border from texture metadata, so this is what makes frames and buttons stretch correctly. '
      + 'Re-registers the asset and updates the live texture. Returns the resulting importer block.',
    schema: obj({ path: { type: 'string' }, patch: { type: 'object' } }, ['path', 'patch']),
    method: 'setImportSettings', args: (i) => [i.path, i.patch], root: 'editor' },
  { name: 'read_project_file',
    description: 'Read a text file by project-relative path — game scripts (src/*.ts), project.esproject, .meta files, any project text. Complements get_inspector: scenes are model state, behaviour is code. '
      + 'A big file comes back TRUNCATED; page through it with `offset` (1-based LINE number) and `limit` (how many lines), which is the "narrow the request" the truncation notice asks for. '
      + 'An offset past the end is refused, naming the line count — so an empty reply always means those lines are empty, never that you have run off the end.',
    schema: obj({ path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, ['path']),
    js: (i) => `window.estella.fs.read(${JSON.stringify(i.path)}, ${i.offset ?? 'undefined'}, ${i.limit ?? 'undefined'})` },
  { name: 'write_project_file', effect: 'irreversible',
    description: 'Write a text file by project-relative path, CREATING or OVERWRITING it. This is how game scripts (src/*.ts) are authored — create_asset only makes .meta-carrying asset types and refuses to overwrite (it uniquifies to "name 2"). '
      + 'Writing project sources does not itself rebuild them; the editor picks the change up through its file watcher. '
      + 'Writing a .ts file returns the TypeScript errors in it — `{ ok, path, errors, diagnostics }` — so a script that does not compile says so HERE, not three steps later when the game plays black.',
    schema: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    op: 'write_project_file' },
  { name: 'check_scripts',
    description: "TypeScript errors in the project's scripts — the whole of src/ by default, or one file with `path`. "
      + 'Each entry is { file, line, column, code, category, message }. This is the same compiler the IDE runs, so an empty list means the code really does build.',
    schema: obj({ path: { type: 'string' } }), op: 'check_scripts' },
  { name: 'lookup_symbol',
    description: "What an API actually IS, asked of the TypeScript compiler: `name` is a symbol (`Input`, `screenToWorld`, `MouseButton`) and the reply carries its rendered signature, its doc comment and where it is declared. "
      + 'Use this INSTEAD of paging the SDK .d.ts — that file is tens of thousands of lines and reading it a hundred at a time costs a context window to learn one method name.',
    schema: obj({ name: { type: 'string' }, limit: { type: 'number' } }, ['name']), op: 'lookup_symbol' },
  { name: 'search_project_files',
    description: 'Lines matching `query` across the project (case-insensitive substring, or a regular expression with `regex: true`); `glob` filters paths — `*.ts`, `src/**`, `src/*.ts`, or a plain substring like ".ts". '
      + 'Each hit is { file, line, text }. The door between list_project_files and reading a file whole.',
    schema: obj({
      query: { type: 'string' }, regex: { type: 'boolean' },
      glob: { type: 'string' }, maxResults: { type: 'number' },
    }, ['query']),
    op: 'search_project_files' },
  { name: 'list_project_files',
    description: 'Project-relative paths of every file under a project-relative directory (recursive). Use for source trees (src/) where list_assets — which only knows registered assets — sees nothing.',
    schema: obj({ dir: { type: 'string' } }, ['dir']),
    js: (i) => `window.estella.fs.listFiles(${JSON.stringify(i.dir)})` },
  { name: 'set_project_physics', effect: 'irreversible',
    description: 'Patch the project physics feature (Project Settings → Physics), e.g. { "enabled": true }. Persists to the manifest; Play and exports boot it.',
    schema: obj({ patch: { type: 'object' } }, ['patch']),
    method: 'setPhysics', args: (i) => [i.patch], root: 'editor' },
  { name: 'list_entity_templates',
    description: "The Create-popover catalog: every ready-made entity the editor can spawn (id, label, category). Use an id with create_entity.",
    schema: obj({}), method: 'listEntityTemplates', args: () => [], root: 'editor' },
  { name: 'create_entity', effect: 'undoable',
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
    description: 'The play realm state: { playing, ready, error, fps, frameCount }. '
      + 'CHECK `fps` BEFORE CONCLUDING ANYTHING FROM A PROBE: the realm runs in an out-of-process iframe whose rAF Chromium throttles to ~1/s while the editor window is unfocused, '
      + 'so a game that looks frozen (an animation that never advances, a tween stuck at its start) is usually a background window, not a bug. `fps` is null until the first heartbeat (~0.5s after Play).',
    schema: obj({}), method: 'playState', args: () => [], root: 'editor' },
  { name: 'screenshot',
    description: 'Capture the composited editor window as a PNG (includes the play realm iframe — use this to SEE gameplay; capture_viewport only sees the edit viewport).',
    schema: obj({}), op: 'screenshot', image: true },
  // — The editor's OWN agent, for a driver that wants to run it: an eval harness,
  //   a dogfood session, a regression over its behaviour. `driverOnly` keeps these
  //   out of the built-in agent's own tool list — an agent messaging itself is a
  //   loop with a bill attached, and nothing it could learn that way is true.
  { name: 'agent_send', effect: 'irreversible', driverOnly: true,
    description: "Send a message to the editor's BUILT-IN agent (Settings › AI Agents supplies its key and model) and return its status. It works asynchronously: poll agent_status until phase is 'idle', or 'awaiting_confirm' when it is waiting on a batch preview.",
    schema: obj({ text: { type: 'string' } }, ['text']),
    js: (i) => `window.estella.agent.send(${JSON.stringify(i.text)})` },
  { name: 'agent_status', driverOnly: true,
    description: "The built-in agent's phase (idle / thinking / awaiting_confirm / error), its model, and how full its context is.",
    schema: obj({}), js: () => `window.estella.agent.status().then(async (s) => {
      if (s.phase !== 'awaiting_confirm') return s;
      // What it is waiting ON, not just that it waits: a driver cannot answer a
      // question it has to go digging through the transcript to read.
      const t = await window.estella.agent.transcript();
      const last = [...t].reverse().find((e) => e.type === 'awaiting_confirm');
      return { ...s, pending: last?.request ?? null };
    })` },
  { name: 'agent_confirm', effect: 'irreversible', driverOnly: true,
    description: "Answer the built-in agent's pending confirmation (agent_status reports it as `pending` while phase is 'awaiting_confirm'). `answer`: 'once' this call, 'turn' every call of that tool for the rest of the run, 'no' declined. `declined` strikes out lines of a previewed batch by index; the rest still runs.",
    schema: obj({
      answer: { type: 'string' }, callId: { type: 'string' },
      declined: { type: 'array', items: { type: 'number' } },
    }, ['answer']),
    js: (i) => `(async () => {
      let callId = ${JSON.stringify(i.callId ?? null)};
      if (!callId) {
        const t = await window.estella.agent.transcript();
        callId = [...t].reverse().find((e) => e.type === 'awaiting_confirm')?.request?.callId ?? null;
      }
      if (!callId) return { ok: false, error: 'the agent is not waiting on a confirmation' };
      await window.estella.agent.confirm(callId, ${JSON.stringify(i.answer)}, ${JSON.stringify(i.declined ?? undefined)});
      return { ok: true, callId };
    })()` },
  { name: 'agent_transcript', driverOnly: true,
    description: "The built-in agent's conversation as events (text deltas, tool calls, results, errors) — what it did and what came back. Returns `{ total, from, events }`: `tail` (default 40) is how many of the most recent to send, and `total` is how many exist, so a POLLING driver can tell what it missed rather than counting a rolling window and silently going blind.",
    schema: obj({ tail: { type: 'number' } }),
    js: (i) => `window.estella.agent.transcript().then((t) => {
      const tail = ${Number(i.tail) > 0 ? Number(i.tail) : 40};
      const from = Math.max(0, t.length - tail);
      return { total: t.length, from, events: t.slice(from) };
    })` },
  { name: 'play_probe', effect: 'irreversible',
    description: "Evaluate JS inside the RUNNING play realm and return the result — the gameplay probe. One expression gives its value; several statements need an explicit `return`. window.__estellaPlay = { app, getComponent, find, componentNames, resource, input }: **`find(NAME)` and `resource(NAME)` are the ones to reach for** — `find` returns every entity carrying that component with its live data, `resource` the live value of a resource (a score, a phase — state that belongs to no entity); together they are how you ask what the game currently thinks is going on. `componentNames()` lists what `find` accepts, and `resource` on an unknown name answers with the available ones. `getComponent(NAME)` gives the DEFINITION and `app.world.tryGet(entity, def)` one entity's data (`get` returns a ZEROED object for an entity that lacks the component, so it cannot be used to test for one); a write only lands through `app.world.insert(entity, def, data)` — assigning to a copy changes nothing. Use play_input, not synthetic DOM events, to drive input. frame picks the realm in multiplayer previews (0 = host).",
    schema: obj({ code: { type: 'string' }, frame: { type: 'number' } }, ['code']),
    op: 'play_probe' },
  { name: 'play_input', effect: 'irreversible',
    description: 'Deliver a pointer or key event to the RUNNING game — the only way to exercise the input a game actually ships with. '
      + "`kind`: 'click' (down+up at x,y), 'move', 'down', 'up', 'wheel', 'key_down', 'key_up', 'tap' (touch down+up). "
      + 'x/y are SCREEN pixels, canvas-relative, y DOWN — the same numbers a real pointer event carries and what `Input.mouseX/mouseY` then read; '
      + 'ask the camera (CameraView.screenToWorld / UICameraInfo.worldMouseX) for where that is in the world rather than converting by hand. '
      + '`code` is a KeyboardEvent code for the key kinds. It goes through the platform binding\'s own callbacks, so UI gets first refusal exactly as it would for a real event. '
      + 'A pressed EDGE (isMouseButtonPressed / isKeyPressed) lasts one frame: call step() right after, then read the result. '
      + 'Calling the game\'s own handler instead proves only that the handler works — not that a click reaches it.',
    schema: obj({
      kind: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      button: { type: 'number' }, code: { type: 'string' }, frame: { type: 'number' },
    }, ['kind']),
    op: 'play_input' },
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
  { name: 'run_editor_command', effect: 'irreversible',
    description: 'Dispatch any registered editor command by id (the UI\'s own channel) — the escape hatch for operations without a dedicated tool.',
    schema: obj({ id: { type: 'string' } }, ['id']),
    method: 'runCommand', args: (i) => [i.id], root: 'editor' },
  { name: 'export_game', effect: 'irreversible',
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
  return TOOLS.filter((t) => !mutates(t) || allowWrites)
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema }));
}

function typeMatches(spec, val) {
  return (Array.isArray(spec) ? spec : [spec]).some((t) =>
    t === 'null' ? val === null
      : t === 'number' ? typeof val === 'number'
      : t === 'string' ? typeof val === 'string'
      : t === 'boolean' ? typeof val === 'boolean'
      : t === 'array' ? Array.isArray(val)
      : t === 'object' ? (val !== null && typeof val === 'object')
      : true);
}

/** Light validation: required args present + declared scalar types match. */
function validate(schema, raw) {
  const input = raw ?? {};
  for (const req of schema.required ?? []) {
    if (input[req] === undefined) {
      // Name what DID arrive. A caller that wrote `file` for `path` reads "missing
      // required argument: path", looks at a call that plainly has a path in it,
      // and spends a round trip resending the same mistake.
      const got = Object.keys(input);
      throw new Error(
        `missing required argument: ${req}`
        + (got.length ? ` — received ${got.map((k) => `\`${k}\``).join(', ')}` : ' — received no arguments'),
      );
    }
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
    if (mutates(tool) && !allowWrites) {
      throw new Error(`tool ${tool.name} mutates the scene — start the server with ESTELLA_MCP_ALLOW_WRITES=1`);
    }
    const input = validate(tool.schema, rawInput);
    if (tool.op) {
      const data = await driver.op(tool.op, input);
      if (tool.image) return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      return { content: [{ type: 'text', text: data === undefined ? 'ok' : JSON.stringify(data) }] };
    }
    // A js template may DECLINE (return null) for inputs it has nothing special
    // to do with, leaving the tool's typed `method` door to handle them — which
    // is how a tool grows one alternate path without every call losing the door.
    const js = tool.js ? tool.js(input) : null;
    if (js) {
      const data = await driver.js(js);
      if (tool.image) return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
      return { content: [{ type: 'text', text: data === undefined ? 'ok' : JSON.stringify(data) }] };
    }
    const result = await driver(tool.method, tool.args(input), tool.root);
    return { content: [{ type: 'text', text: result === undefined ? 'ok' : JSON.stringify(result) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `error: ${err?.message ?? String(err)}` }], isError: true };
  }
}
