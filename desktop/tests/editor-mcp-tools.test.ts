// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — plain-.mjs tool registry shared with the Electron MCP entry.
import { TOOLS, RESOURCES, runTool, listTools } from '../scripts/editor-mcp-tools.mjs';

// The editor MCP server is a transport over EditorControlSurface: each tool maps to one
// surface method. These cover the pure dispatch layer (no Electron) — the Electron entry
// only supplies the executeJavaScript driver.
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
    expect(apply.write).toBe(true);
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

  it('write_project_file targets the project fs door with an escaped payload', async () => {
    const driver = vi.fn() as unknown as { js: ReturnType<typeof vi.fn> } & ((...a: unknown[]) => unknown);
    driver.js = vi.fn(async () => undefined);
    const write = TOOLS.find((t: { name: string }) => t.name === 'write_project_file');
    await runTool(write, driver, { path: 'src/main.ts', content: 'const s = "hi";\n' });
    const code = driver.js.mock.calls[0][0];
    expect(code).toContain('window.estella.fs.write');
    // The content is JSON-encoded into the snippet — quotes/newlines must not break it.
    expect(code).toContain(JSON.stringify('const s = "hi";\n'));
  });

  it('every resource maps to a surface method with a JSON mime', () => {
    for (const r of RESOURCES as Array<{ uri: string; method: string; mimeType: string }>) {
      expect(r.uri.startsWith('editor://')).toBe(true);
      expect(typeof r.method).toBe('string');
      expect(r.mimeType).toBe('application/json');
    }
  });
});
