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
    description: 'One entity: name, kind, and its component list. A member of a prefab INSTANCE also carries '
      + '`prefab: { ref, prefabId, instanceRoot, isRoot }` — how to tell an instance from an ordinary entity, and what edit_prefab / apply_prefab / revert_prefab / unpack_prefab act on (resolve `ref` to a path with list_assets).',
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
    description: 'Enter or leave play mode (playing=true runs gameplay; Stop rebuilds the edit World).',
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
  { name: 'set_panel_size', write: true,
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
    description: 'Open a project by absolute root path and enter the editor. Resolves TRUE once the initial scene is loaded and readable — call before any scene/asset work on the editor host. Throws, naming the step that failed, if the project cannot be opened or no scene loads; it never reports a failure as a plain false, because a caller that keeps going against a project that never opened just collects "no project open" from every later tool.',
    schema: obj({ root: { type: 'string' } }, ['root']),
    js: (i) => `window.__estellaEditor.open(${JSON.stringify(i.root)})` },
  { name: 'open_scene',
    description: 'Open a scene by project-relative path (e.g. assets/scenes/main.esscene) in the editor. Resolves once the scene is adopted — get_scene_tree is immediately valid. '
      + 'REFUSES while the open scene has unsaved changes (opening reloads from disk, so anything just authored would be gone): save_scene first, or pass discardChanges to throw the edits away on purpose.',
    schema: obj({ path: { type: 'string' }, discardChanges: { type: 'boolean' } }, ['path']),
    method: 'openScene', args: (i) => [i.path, i.discardChanges === true], root: 'editor' },
  { name: 'save_scene', write: true,
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
  { name: 'apply_prefab', write: true,
    description: 'Push an instance\'s overrides back into its prefab asset (the Outliner\'s "Apply to Prefab") — the base for EVERY instance is rewritten, and this instance\'s overrides clear. '
      + 'Property, name, visibility and component overrides plus structural add/remove. `confirm` must be true: a person is shown an itemized diff first, so a driver says it out loud instead (get_inspector marks the overridden fields).',
    schema: obj({ entity: { type: 'number' }, confirm: { type: 'boolean' } }, ['entity', 'confirm']),
    js: (i) => `window.__estellaEditor.applyPrefab(${Number(i.entity)}, ${i.confirm === true})` },
  { name: 'revert_prefab', write: true,
    description: 'Discard an instance\'s overrides and re-sync it to its prefab (the Outliner\'s "Revert to Prefab"), keeping its placement. Returns the fresh instance root\'s id — the old ids are gone (it is a delete + re-instantiate).',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.revertPrefab(${Number(i.entity)})` },
  { name: 'unpack_prefab', write: true,
    description: 'Detach an instance (the Outliner\'s "Unpack Prefab"): its entities become ordinary scene entities and lose every prefab link, so later prefab edits no longer reach them. Undoable.',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.unpackPrefab(${Number(i.entity)})` },
  { name: 'create_prefab_variant', write: true,
    description: 'Save a new `.esprefab` that INHERITS the instance\'s prefab and bakes in its current overrides (the Outliner\'s "Create Variant" — a prefab of a prefab), then re-link the instance to the variant. '
      + 'Written beside the base as "<base> Variant.esprefab"; returns the re-linked root\'s id. Deletions are not representable in a variant and are skipped.',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.createPrefabVariant(${Number(i.entity)})` },
  { name: 'create_scene_file', write: true,
    description: 'Create a blank scene FILE under a project-relative directory (does not switch to it); returns its path, immediately referenceable (the registry refresh happens before this resolves). '
      + '`name` names it (the `.esscene` extension is added if absent); without one it is `scene.esscene`, which collides the moment you make a second.',
    schema: obj({ destDir: { type: 'string' }, name: { type: 'string' } }, ['destDir']),
    js: (i) => `window.__estellaEditor.createSceneFile(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.name ?? null)})
      .then((p) => window.__estellaEditor.refreshAssets().then(() => p))` },
  { name: 'create_prefab_from_entity', write: true,
    description: 'Extract an entity and its subtree into a `.esprefab` asset under assets/prefabs/ (the Outliner\'s Create Prefab), named after the entity; returns its `@uuid:` ref. '
      + 'This is what makes a subtree REUSABLE: afterwards `list_entity_templates` offers it as `prefab:<path>`, and creating with that template makes a real INSTANCE — the scene stores a delta, not a copy, so editing the prefab updates every instance. '
      + 'Without it a driver can build the same panel chrome into twenty scenes but never share it. Refs pointing OUT of the subtree cannot live in a standalone prefab and are cleared.',
    schema: obj({ entity: { type: 'number' } }, ['entity']),
    js: (i) => `window.__estellaEditor.createPrefabFromEntity(${Number(i.entity)})
      .then((ref) => { if (!ref) throw new Error('could not create a prefab from entity ${Number(i.entity)} — it may not exist'); return ref; })` },
  { name: 'create_asset', write: true,
    description: 'Create a text asset file under a project-relative directory with the given content. `type` is the meta vocabulary: scene, prefab, shader, material, animclip (.esanim), animation (.estimeline), tileset, statemachine (.esfsm), behaviortree (.esbt), locale, inputmap, tilemap (.tmj). A bare baseName gets the type\'s canonical extension appended. Returns the project-relative path, immediately referenceable (the registry refresh happens before this resolves).',
    schema: obj({
      destDir: { type: 'string' }, baseName: { type: 'string' },
      content: { type: 'string' }, type: { type: 'string' },
    }, ['destDir', 'baseName', 'content', 'type']),
    js: (i) => `window.estella.project.createAsset(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.baseName)}, ${JSON.stringify(i.content)}, ${JSON.stringify(i.type)})
      .then((p) => window.__estellaEditor.refreshAssets().then(() => p))` },
  { name: 'import_assets', write: true,
    description: 'Import files into the asset registry (textures, audio, fonts, spine, tilemaps...). External absolute paths are copied into project-relative destDir; paths already INSIDE the project are registered in place (no copy, no rename). Returns { imported, skipped }; imported paths are immediately referenceable (the registry refresh happens before this resolves).',
    schema: obj({ destDir: { type: 'string' }, sources: { type: 'object', description: 'array of absolute file paths' } },
      ['destDir', 'sources']),
    js: (i) => `window.estella.project.importFiles(${JSON.stringify(i.destDir)}, ${JSON.stringify(i.sources)})
      .then((r) => window.__estellaEditor.refreshAssets().then(() => r))` },
  { name: 'apply_scene_ops', write: true,
    description: 'Author a whole subtree in ONE undoable batch — the tool to build scenes with (set_field one field per call does not scale past a few dozen nodes). '
      + '`ops` is an array executed in order, atomically: a throw anywhere rolls the WHOLE batch back. Op shapes: '
      + '{op:"create", ref?, name?, parent?, template?, components?, fields?, x?, y?} — `template` is an entity-template id (list_entity_templates, e.g. "ui-image"), '
      + 'or give `components` as ["Transform","UINode","UIVisual"] / [{type,data}]; '
      + '{op:"set", entity, fields}; {op:"add_component"|"remove_component", entity, component}; {op:"rename", entity, name}; {op:"parent", entity, parent}; {op:"delete", entity}. '
      + 'ENTITY ADDRESSING: an entity is a live numeric id, or "$name" naming an earlier create\'s `ref` — so a parent/child tree is one call with no round trip to learn ids. '
      + 'FIELDS is a flat map of "Component.key" → value, e.g. {"Transform.position.x": 10, "UIVisual.color": "#ff0000ff", "Text.content": "Hi"} — same coercion and validation as set_field, '
      + 'including one member of a structural field ("FlexContainer.gap.x", "UINode.marginLeft"). '
      + 'Give either `ops` inline or `opsPath` (a JSON file), never both. Returns { refs: {name: id}, created: [id], applied: n }. Check get_diagnostics afterwards.',
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
  { name: 'set_import_settings', write: true,
    description: 'Patch an asset\'s .meta import settings and persist. Keys are DOTTED paths into the importer block, matching the inspector field keys — a texture\'s 9-slice border is '
      + '{"sliceBorder.left":12,"sliceBorder.right":12,"sliceBorder.top":12,"sliceBorder.bottom":12}; filter/wrap are {"filterMode":"nearest","wrapMode":"clamp"}. '
      + 'These live in IMPORT, not on a component: a UIVisual set to NineSlice takes its border from texture metadata, so this is what makes frames and buttons stretch correctly. '
      + 'Re-registers the asset and updates the live texture. Returns the resulting importer block.',
    schema: obj({ path: { type: 'string' }, patch: { type: 'object' } }, ['path', 'patch']),
    method: 'setImportSettings', args: (i) => [i.path, i.patch], root: 'editor' },
  { name: 'read_project_file',
    description: 'Read a text file by project-relative path — game scripts (src/*.ts), project.esproject, .meta files, any project text. Complements get_inspector: scenes are model state, behaviour is code.',
    schema: obj({ path: { type: 'string' } }, ['path']),
    js: (i) => `window.estella.fs.read(${JSON.stringify(i.path)})` },
  { name: 'write_project_file', write: true,
    description: 'Write a text file by project-relative path, CREATING or OVERWRITING it. This is how game scripts (src/*.ts) are authored — create_asset only makes .meta-carrying asset types and refuses to overwrite (it uniquifies to "name 2"). '
      + 'Writing project sources does not itself rebuild them; the editor picks the change up through its file watcher.',
    schema: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    js: (i) => `window.estella.fs.write(${JSON.stringify(i.path)}, ${JSON.stringify(i.content)})` },
  { name: 'list_project_files',
    description: 'Project-relative paths of every file under a project-relative directory (recursive). Use for source trees (src/) where list_assets — which only knows registered assets — sees nothing.',
    schema: obj({ dir: { type: 'string' } }, ['dir']),
    js: (i) => `window.estella.fs.listFiles(${JSON.stringify(i.dir)})` },
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
      : t === 'array' ? Array.isArray(val)
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
