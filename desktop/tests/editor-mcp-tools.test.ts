// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — plain-.mjs tool registry shared with the Electron MCP entry.
import { TOOLS, RESOURCES, runTool, listTools, mutates, irreversible } from '../shared/toolCatalog.mjs';

// The editor MCP server is a transport over EditorControlSurface: each tool maps to one
// surface method. These cover the pure dispatch layer (no Electron) — the Electron entry
// only supplies the executeJavaScript driver.
const toolNamed = (name: string) => TOOLS.find((t: { name: string }) => t.name === name);

describe('editor MCP tool registry', () => {
  it('every tool has a unique name and a surface method, renderer code, or host op', () => {
    const names = new Set<string>();
    for (const t of TOOLS as Array<{ name: string; method?: string; args?: unknown; js?: unknown; op?: unknown }>) {
      if (t.js) expect(typeof t.js).toBe('function');
      else if (t.op) expect(typeof t.op).toBe('string');
      else {
        expect(typeof t.method).toBe('string');
        expect(typeof t.args).toBe('function');
      }
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
    }
    expect(TOOLS.length).toBeGreaterThan(10);
  });

  it('editor-root tools pass their root through to the driver', async () => {
    const driver = vi.fn(async () => 3);
    const createEntity = TOOLS.find((t: { name: string }) => t.name === 'create_entity');
    const res = await runTool(createEntity, driver, { template: 'anchor:Sprite', x: 10, y: 20 });
    expect(driver).toHaveBeenCalledWith(
      'createEntity',
      ['anchor:Sprite', { parent: null, x: 10, y: 20 }],
      'editor',
    );
    expect(res.content[0].text).toBe('3');
  });

  it('an op tool routes through driver.op and wraps as an image', async () => {
    const driver = vi.fn() as unknown as { op: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.op = vi.fn(async () => 'cGpn');
    const shot = TOOLS.find((t: { name: string }) => t.name === 'screenshot');
    const res = await runTool(shot, driver, {});
    expect(driver.op).toHaveBeenCalledWith('screenshot', {});
    expect(res.content[0]).toEqual({ type: 'image', data: 'cGpn', mimeType: 'image/png' });
  });

  it('runTool validates input and calls the driver with (method, args)', async () => {
    const driver = vi.fn(async () => 42);
    const setField = TOOLS.find((t: { name: string }) => t.name === 'set_field');
    const res = await runTool(setField, driver, {
      entity: 1, component: 'Transform', key: 'position.x', type: 'float', value: 5,
    });
    expect(driver).toHaveBeenCalledWith('setField', [1, 'Transform', 'position.x', 'float', 5], undefined);
    expect(res.content[0].text).toBe('42');
    expect(res.isError).toBeFalsy();
  });

  it('runTool returns an error result on invalid input (driver not called)', async () => {
    const driver = vi.fn();
    const getEntity = TOOLS.find((t: { name: string }) => t.name === 'get_entity');
    const res = await runTool(getEntity, driver, { id: 'not-a-number' });
    expect(res.isError).toBe(true);
    expect(driver).not.toHaveBeenCalled();
  });

  it('runTool wraps a driver throw as an error result', async () => {
    const driver = vi.fn(async () => { throw new Error('boom'); });
    const tree = TOOLS.find((t: { name: string }) => t.name === 'get_scene_tree');
    const res = await runTool(tree, driver, {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('boom');
  });

  it('runTool reports "ok" for a void surface call', async () => {
    const driver = vi.fn(async () => undefined);
    const undo = TOOLS.find((t: { name: string }) => t.name === 'undo');
    const res = await runTool(undo, driver, {});
    expect(res.content[0].text).toBe('ok');
  });

  it('listTools advertises every tool with a description + JSON-Schema inputSchema', () => {
    const listed = listTools(true);
    expect(listed.map((t: { name: string }) => t.name)).toEqual((TOOLS as Array<{ name: string }>).map((t) => t.name));
    for (const t of listed as Array<{ description: string; inputSchema: { type: string } }>) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema.type).toBe('object');
    }
  });

  // The tiers are only worth having if they are exhaustive and honest, so assert
  // both halves: nothing declares a tier the gates do not understand, and every
  // tool that reaches the FILESYSTEM is on the side undo cannot rescue.
  it('every tool declares a tier the gates understand', () => {
    for (const t of TOOLS as Array<{ name: string; effect?: string }>) {
      expect(['read', 'undoable', 'irreversible', undefined]).toContain(t.effect);
    }
  });

  it('anything that touches disk or an external target is irreversible', () => {
    const onDisk = ['save_scene', 'write_project_file', 'create_asset', 'create_scene_file',
      'import_assets', 'set_import_settings', 'set_project_physics', 'create_project',
      'create_prefab_from_entity', 'export_game'];
    for (const name of onDisk) expect(irreversible(toolNamed(name))).toBe(true);
    // The arbitrary-code doors belong here too: their effect is whatever the
    // caller wrote, which no undo step can be assumed to cover.
    expect(irreversible(toolNamed('run_editor_command'))).toBe(true);
    expect(irreversible(toolNamed('play_probe'))).toBe(true);
  });

  it('listTools without write permission omits mutating tools but keeps reads', () => {
    const readOnly = listTools(false).map((t: { name: string }) => t.name);
    expect(readOnly).toContain('get_scene_tree');
    expect(readOnly).toContain('capture_viewport');
    expect(readOnly).not.toContain('set_field');
    expect(readOnly).not.toContain('add_entity');
    expect(readOnly.length).toBeLessThan(listTools(true).length);
  });

  it('runTool refuses a write tool without permission (driver not called)', async () => {
    const driver = vi.fn();
    const setField = TOOLS.find((t: { name: string }) => t.name === 'set_field');
    const res = await runTool(setField, driver, {
      entity: 1, component: 'Transform', key: 'position.x', type: 'float', value: 5,
    }, false);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('ESTELLA_MCP_ALLOW_WRITES');
    expect(driver).not.toHaveBeenCalled();
  });

  it('a renderer-code tool runs via driver.js and wraps the result as an image', async () => {
    const driver = vi.fn() as unknown as { js: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.js = vi.fn(async () => 'aWFtYXBuZw==');
    const capture = TOOLS.find((t: { name: string }) => t.name === 'capture_viewport');
    const res = await runTool(capture, driver, {});
    expect(driver.js).toHaveBeenCalledWith(expect.stringContaining('captureViewport'));
    expect(res.content[0]).toEqual({ type: 'image', data: 'aWFtYXBuZw==', mimeType: 'image/png' });
  });

  it('apply_scene_ops forwards the op program to the editor door', async () => {
    const driver = vi.fn(async () => ({ refs: { root: 5 }, created: [5], applied: 1 }));
    const apply = TOOLS.find((t: { name: string }) => t.name === 'apply_scene_ops');
    const ops = [{ op: 'create', ref: 'root', name: 'Panel' }];
    const res = await runTool(apply, driver, { ops, label: 'Build' });
    expect(driver).toHaveBeenCalledWith('applyOps', [ops, 'Build'], 'editor');
    expect(JSON.parse(res.content[0].text).refs.root).toBe(5);
  });

  it('apply_scene_ops is a write tool and rejects a non-array program', async () => {
    const driver = vi.fn();
    const apply = TOOLS.find((t: { name: string }) => t.name === 'apply_scene_ops');
    expect(mutates(apply)).toBe(true);
    const res = await runTool(apply, driver, { ops: 'create everything' });
    expect(res.isError).toBe(true);
    expect(driver).not.toHaveBeenCalled();
  });

  it('list_assets packs its filters into one options argument', async () => {
    const driver = vi.fn(async () => ({ total: 0, assets: [] }));
    const list = TOOLS.find((t: { name: string }) => t.name === 'list_assets');
    await runTool(list, driver, { match: 'Icon/', type: 'texture', limit: 20 });
    expect(driver).toHaveBeenCalledWith('listAssets', [{ match: 'Icon/', type: 'texture', limit: 20 }], 'editor');
  });

  it('set_import_settings passes the dotted patch through untouched', async () => {
    const driver = vi.fn(async () => ({ sliceBorder: { left: 12 } }));
    const set = TOOLS.find((t: { name: string }) => t.name === 'set_import_settings');
    const patch = { 'sliceBorder.left': 12, 'sliceBorder.right': 12 };
    await runTool(set, driver, { path: 'assets/ui/frame.png', patch });
    expect(driver).toHaveBeenCalledWith('setImportSettings', ['assets/ui/frame.png', patch], 'editor');
  });

  it('write_project_file writes through main, which is what can answer with diagnostics', async () => {
    // A main-process op rather than a renderer snippet: the write and the
    // TypeScript verdict on it are one reply, and only main holds the language
    // service. The payload crosses whole — a dropped `content` would write an
    // empty file and report ok.
    const driver = vi.fn() as unknown as { op: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.op = vi.fn(async () => ({ ok: true, path: 'src/main.ts', errors: 0, diagnostics: [] }));
    const write = TOOLS.find((t: { name: string }) => t.name === 'write_project_file');
    await runTool(write, driver, { path: 'src/main.ts', content: 'const s = "hi";\n' });
    expect(driver.op).toHaveBeenCalledWith('write_project_file', {
      path: 'src/main.ts', content: 'const s = "hi";\n',
    });
  });

  it('a component declaration is extracted before the write returns', async () => {
    // The watcher debounces 250ms; a writer uses what it declared in the next
    // call. Racing it answered `has no field "currentPlayer" (fields: )` — an
    // empty schema worded as a typo, which sent the writer off rewriting a
    // component that was correct.
    const driver = vi.fn() as unknown as {
      op: ReturnType<typeof vi.fn>; js: ReturnType<typeof vi.fn>;
    } & ((...a: unknown[]) => unknown);
    driver.op = vi.fn(async () => ({ ok: true }));
    driver.js = vi.fn(async () => null);
    const write = TOOLS.find((t: { name: string }) => t.name === 'write_project_file');
    await runTool(write, driver, {
      path: 'src/components.ts',
      content: "import { defineComponent } from 'esengine';\nexport const S = defineComponent('S', { a: 1 });\n",
    });
    // The op carries the write; the extract is the op's own doing (surfaceDriver),
    // so what this pins is that the tool still hands main the whole payload.
    expect(driver.op).toHaveBeenCalledWith('write_project_file', expect.objectContaining({
      path: 'src/components.ts',
    }));
  });

  it('the compiler tools reach main, where the language service lives', async () => {
    const driver = vi.fn() as unknown as { op: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.op = vi.fn(async () => []);
    for (const [name, args] of [
      ['check_scripts', { path: 'src/main.ts' }],
      ['lookup_symbol', { name: 'Input' }],
      ['search_project_files', { query: 'Gomoku' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const tool = TOOLS.find((t: { name: string }) => t.name === name);
      expect([name, !!tool]).toEqual([name, true]);
      await runTool(tool, driver, args);
      expect(driver.op).toHaveBeenCalledWith(name, args);
    }
  });

  it('an asset editor has a save of its own — project.save is the ACTIVE panel', async () => {
    // run_editor_command('project.save') routes by whichever dock panel the user
    // last clicked: driven from outside, an edit to a material graph landed in
    // the scene file, or nowhere. This tool names the document instead.
    const driver = vi.fn() as unknown as { js: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.js = vi.fn(async () => ({ docId: 'materialgraph', path: 'fx/fire.esmatgraph', saved: true }));
    const save = toolNamed('save_asset_document');
    expect([!!save, irreversible(save)]).toEqual([true, true]); // it writes a file: stop and ask

    const res = await runTool(save, driver, { docId: 'materialgraph' });
    expect(driver.js).toHaveBeenCalledWith(expect.stringContaining('saveAssetDocument("materialgraph"'));
    expect(res.isError).toBeFalsy();

    await runTool(save, driver, {}); // no docId = the only one open
    expect(driver.js).toHaveBeenLastCalledWith(expect.stringContaining('saveAssetDocument(null ?? undefined)'));
  });

  it('every resource maps to a surface method with a JSON mime', () => {
    for (const r of RESOURCES as Array<{ uri: string; method: string; mimeType: string }>) {
      expect(r.uri.startsWith('editor://')).toBe(true);
      expect(typeof r.method).toBe('string');
      expect(r.mimeType).toBe('application/json');
    }
  });
});

describe('apply_scene_ops program sources', () => {
  const apply = () => TOOLS.find((t: { name: string }) => t.name === 'apply_scene_ops');

  it('reads the program from a file when one is named, so a big panel need not fit in a message', async () => {
    const js = vi.fn().mockResolvedValue({ refs: {}, created: [], applied: 3 });
    const driver = Object.assign(vi.fn(), { js });
    await runTool(apply(), driver, { opsPath: 'assets/scenes/panel.ops.json', label: 'Panel' });

    expect(driver).not.toHaveBeenCalled();          // not the inline door
    const src = js.mock.calls[0][0];
    expect(src).toContain('assets/scenes/panel.ops.json');
    expect(src).toContain('JSON.parse');
    expect(src).toContain('applyOps');
  });

  it('still takes the typed door for an inline program', async () => {
    const js = vi.fn();
    const driver = Object.assign(vi.fn().mockResolvedValue({ refs: {}, created: [], applied: 1 }), { js });
    const ops = [{ op: 'create', ref: 'a' }];
    await runTool(apply(), driver, { ops, label: 'Inline' });

    expect(js).not.toHaveBeenCalled();
    expect(driver).toHaveBeenCalledWith('applyOps', [ops, 'Inline'], 'editor');
  });
});

describe('open_scene guards unsaved work', () => {
  const openScene = () => TOOLS.find((t: { name: string }) => t.name === 'open_scene');

  it('passes the discard flag through, defaulting to refusing', async () => {
    const driver = vi.fn().mockResolvedValue(undefined);
    await runTool(openScene(), driver, { path: 'assets/scenes/a.esscene' });
    expect(driver).toHaveBeenCalledWith('openScene', ['assets/scenes/a.esscene', false], 'editor');

    driver.mockClear();
    await runTool(openScene(), driver, { path: 'assets/scenes/a.esscene', discardChanges: true });
    expect(driver).toHaveBeenCalledWith('openScene', ['assets/scenes/a.esscene', true], 'editor');
  });

  it('surfaces the refusal as an error the caller can act on', async () => {
    const driver = vi.fn().mockRejectedValue(new Error('the open scene has unsaved changes — save_scene first'));
    const res = await runTool(openScene(), driver, { path: 'assets/scenes/a.esscene' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unsaved changes/);
  });
});

describe('the prefab-mode doors', () => {
  const jsDriver = () => {
    const js = vi.fn().mockResolvedValue(undefined);
    return Object.assign(vi.fn(), { js });
  };

  it('open_asset carries the path and the discard flag, refusing by default', async () => {
    const driver = jsDriver();
    await runTool(toolNamed('open_asset'), driver, { path: 'assets/prefabs/Panel.esprefab' });
    expect(driver.js).toHaveBeenCalledWith(expect.stringContaining('openAsset("assets/prefabs/Panel.esprefab", false)'));

    driver.js.mockClear();
    await runTool(toolNamed('open_asset'), driver, { path: 'assets/prefabs/Panel.esprefab', discardChanges: true });
    expect(driver.js).toHaveBeenCalledWith(expect.stringContaining(', true)'));
  });

  it('apply_prefab cannot be called without saying confirm out loud', async () => {
    const driver = jsDriver();
    // `confirm` is required by the schema: an omission never reaches the editor.
    const res = await runTool(toolNamed('apply_prefab'), driver, { entity: 7 });
    expect(res.isError).toBe(true);
    expect(driver.js).not.toHaveBeenCalled();

    // Present but false still reaches the editor, which refuses there (one place
    // owns the rule) — what must not happen is a silent apply.
    await runTool(toolNamed('apply_prefab'), driver, { entity: 7, confirm: false });
    expect(driver.js).toHaveBeenCalledWith(expect.stringContaining('applyPrefab(7, false)'));
  });

  it('every prefab door that rewrites an asset or the scene is write-gated', () => {
    for (const name of ['apply_prefab', 'revert_prefab', 'unpack_prefab', 'create_prefab_variant']) {
      expect(mutates(toolNamed(name))).toBe(true);
    }
    // Reading the document and leaving Prefab Mode write nothing.
    expect(mutates(toolNamed('get_document'))).toBe(false);
    expect(mutates(toolNamed('exit_prefab_mode'))).toBe(false);
  });

  // The tier is what an in-editor agent gates on, so it has to survive the split
  // that matters: rewriting the PREFAB ASSET reaches every instance and outlives
  // undo, while re-syncing or detaching THIS instance is an ordinary scene edit.
  it('separates the prefab doors that outlive undo from the ones that do not', () => {
    expect(toolNamed('apply_prefab').effect).toBe('irreversible');
    expect(toolNamed('create_prefab_variant').effect).toBe('irreversible');
    expect(toolNamed('revert_prefab').effect).toBe('undoable');
    expect(toolNamed('unpack_prefab').effect).toBe('undoable');
  });

  it('surfaces the "not an instance" refusal instead of a silent no-op', async () => {
    const driver = Object.assign(vi.fn(), {
      js: vi.fn().mockRejectedValue(new Error('entity 3 is not part of a prefab instance')),
    });
    const res = await runTool(toolNamed('unpack_prefab'), driver, { entity: 3 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not part of a prefab instance/);
  });
});

describe('re-running an authoring step is not a new asset', () => {
  it('create_scene_file passes the overwrite decision down, defaulting to refusing', async () => {
    const driver = Object.assign(vi.fn(async () => '"assets/scenes/shop.esscene"'), {
      js: vi.fn(async (_code: string) => '"assets/scenes/shop.esscene"'),
    });
    const tool = TOOLS.find((t: { name: string }) => t.name === 'create_scene_file');

    await runTool(tool, driver, { destDir: 'assets/scenes', name: 'shop' });
    expect(driver.js.mock.calls[0][0]).toContain('{"overwrite":false}');

    await runTool(tool, driver, { destDir: 'assets/scenes', name: 'shop', overwrite: true });
    expect(driver.js.mock.calls[1][0]).toContain('{"overwrite":true}');
  });

  it('create_prefab_from_entity can replace the asset it already named', async () => {
    const driver = Object.assign(vi.fn(async () => '"@uuid:x"'), { js: vi.fn(async (_code: string) => '"@uuid:x"') });
    const tool = TOOLS.find((t: { name: string }) => t.name === 'create_prefab_from_entity');

    await runTool(tool, driver, { entity: 7, replace: true });
    expect(driver.js.mock.calls[0][0]).toContain('createPrefabFromEntity(7, {"replace":true})');
  });

  it('refresh_assets is a plain renderer call — the scan a batch import needs', async () => {
    const driver = Object.assign(vi.fn(async () => 'true'), { js: vi.fn(async (_code: string) => 'true') });
    const tool = TOOLS.find((t: { name: string }) => t.name === 'refresh_assets');
    expect(tool).toBeTruthy();

    await runTool(tool, driver, {});
    expect(driver.js.mock.calls[0][0]).toContain('refreshAssets()');
  });
});
