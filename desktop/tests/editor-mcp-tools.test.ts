// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — plain-.mjs tool registry shared with the Electron MCP entry.
import { TOOLS, runTool, listTools } from '../scripts/editor-mcp-tools.mjs';

// The editor MCP server is a transport over EditorControlSurface: each tool maps to one
// surface method. These cover the pure dispatch layer (no Electron) — the Electron entry
// only supplies the executeJavaScript driver.
describe('editor MCP tool registry', () => {
  it('every tool has a unique name, a surface method, and an args builder', () => {
    const names = new Set<string>();
    for (const t of TOOLS as Array<{ name: string; method: string; args: unknown }>) {
      expect(typeof t.method).toBe('string');
      expect(typeof t.args).toBe('function');
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
    }
    expect(TOOLS.length).toBeGreaterThan(10);
  });

  it('runTool validates input and calls the driver with (method, args)', async () => {
    const driver = vi.fn(async () => 42);
    const setField = TOOLS.find((t: { name: string }) => t.name === 'set_field');
    const res = await runTool(setField, driver, {
      entity: 1, component: 'Transform', key: 'position.x', type: 'float', value: 5,
    });
    expect(driver).toHaveBeenCalledWith('setField', [1, 'Transform', 'position.x', 'float', 5]);
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
    const listed = listTools();
    expect(listed.map((t: { name: string }) => t.name)).toEqual((TOOLS as Array<{ name: string }>).map((t) => t.name));
    for (const t of listed as Array<{ description: string; inputSchema: { type: string } }>) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema.type).toBe('object');
    }
  });
});
