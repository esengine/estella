// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  capabilities.test.ts — a capability is a program over declared tools,
 *        dispatched by the same runTool every front already uses.
 *
 * The property under test is the one that keeps UI, Agent and MCP on one path:
 * a capability reaches the editor ONLY through tools, so it inherits their
 * validation and their write gate and cannot behave differently from the UI.
 */
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — plain-.mjs registries shared with the Electron MCP entry.
import { TOOLS, ATOMS, runTool, listTools } from '../shared/toolCatalog.mjs';
// @ts-expect-error — same.
import { CAPABILITIES, capabilityStepNames } from '../shared/capabilityCatalog.mjs';

interface Tool { name: string; effect?: string; run?: unknown; schema?: unknown; description?: string }

const capability = (name: string): Tool => (TOOLS as Tool[]).find((t) => t.name === name)!;
const text = (res: { content: Array<{ text: string }> }) => res.content[0].text;

/** A driver that records every surface call and answers each method a script needs. */
function fakeDriver(answers: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const driver = vi.fn(async (method: string, args: unknown[]) => {
    calls.push({ method, args });
    return answers[method];
  }) as unknown as ((m: string, a: unknown[], r?: string) => Promise<unknown>) & {
    js: ReturnType<typeof vi.fn>;
    op: ReturnType<typeof vi.fn>;
  };
  driver.js = vi.fn(async (code: string) => {
    calls.push({ method: 'js', args: [code] });
    return answers.js;
  });
  driver.op = vi.fn(async (op: string, input: unknown) => {
    calls.push({ method: op, args: [input] });
    return answers[op];
  });
  return { driver, calls };
}

describe('the capability catalog', () => {
  it('serves capabilities from the same list every front already reads', () => {
    for (const cap of CAPABILITIES as Tool[]) {
      expect((TOOLS as Tool[]).some((t) => t.name === cap.name)).toBe(true);
    }
    expect((TOOLS as Tool[]).length).toBe((ATOMS as Tool[]).length + (CAPABILITIES as Tool[]).length);
  });

  it('never shadows an atomic tool', () => {
    const atoms = new Set((ATOMS as Tool[]).map((t) => t.name));
    for (const cap of CAPABILITIES as Tool[]) expect(atoms.has(cap.name)).toBe(false);
  });

  it('hides mutating capabilities from a read-only client, as it does tools', () => {
    const readOnly = new Set(listTools(false).map((t: { name: string }) => t.name));
    for (const cap of CAPABILITIES as Tool[]) {
      if ((cap.effect ?? 'read') !== 'read') expect(readOnly.has(cap.name)).toBe(false);
    }
  });

  it('declares an effect no gentler than the steps it runs', () => {
    const severity: Record<string, number> = { read: 0, undoable: 1, irreversible: 2 };
    const byName = new Map((ATOMS as Tool[]).map((t) => [t.name, t]));
    for (const { name, effect, steps } of capabilityStepNames() as Array<{ name: string; effect: string; steps: string[] }>) {
      for (const step of steps) {
        const tool = byName.get(step);
        expect(tool, `${name} calls unknown tool ${step}`).toBeTruthy();
        expect(severity[tool!.effect ?? 'read']).toBeLessThanOrEqual(severity[effect]);
      }
    }
  });
});

describe('capability dispatch', () => {
  it('reaches the editor only through tools, so the surface sees ordinary calls', async () => {
    const { driver, calls } = fakeDriver({ applyOps: { refs: { root: 7 }, created: [7], applied: 1 } });
    const res = await runTool(capability('configure_physics_body'), driver, { entity: 7, body: 'dynamic' });

    expect(res.isError).toBeFalsy();
    // get_entity then apply_scene_ops — both atoms, nothing else touched.
    expect(calls.map((c) => c.method)).toEqual(['getEntity', 'applyOps']);
  });

  it('validates its own input the way any tool does', async () => {
    const { driver } = fakeDriver();
    const res = await runTool(capability('configure_physics_body'), driver, { entity: 1, shape: 'triangle' });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/shape must be/);
  });

  it('refuses an argument nobody declared rather than dropping it', async () => {
    const { driver } = fakeDriver();
    const res = await runTool(capability('wire_ui_event'), driver, {
      entity: 1, event: 'click', action: 'ui.setVisible', bogus: 1,
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/unknown argument/);
  });

  it('is not a way past the write gate a client was refused', async () => {
    const { driver, calls } = fakeDriver();
    const res = await runTool(capability('wire_ui_event'), driver, { entity: 1, event: 'click', action: 'x' }, false);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/mutates the scene/);
    expect(calls).toEqual([]);
  });

  it('names the step that failed, not just the failure', async () => {
    const driver = vi.fn(async (method: string) => {
      if (method === 'applyOps') throw new Error('component X is not on entity 12');
      return undefined;
    }) as never;
    const res = await runTool(capability('configure_physics_body'), driver, { entity: 12 });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/step apply_scene_ops: component X is not on entity 12/);
  });
});

describe('create_prefab', () => {
  it('builds the subtree, names it and extracts it — one call for what was three', async () => {
    const { driver, calls } = fakeDriver({
      applyOps: { refs: { root: 4 }, created: [4, 5], applied: 2 },
      js: '@uuid:abc',
    });
    const res = await runTool(capability('create_prefab'), driver, {
      name: 'Coin',
      ops: [{ op: 'create', ref: 'root', components: ['Transform', 'Sprite'] }],
    });

    expect(res.isError).toBeFalsy();
    expect(calls.map((c) => c.method)).toEqual(['applyOps', 'renameEntity', 'js']);
    expect(JSON.parse(text(res))).toMatchObject({
      entity: 4,
      template: 'prefab:assets/prefabs/Coin.esprefab',
    });
  });

  it('says which ref it wanted when the program never defined a root', async () => {
    const { driver } = fakeDriver({ applyOps: { refs: { body: 4 }, created: [4], applied: 1 } });
    const res = await runTool(capability('create_prefab'), driver, { name: 'Coin', ops: [] });

    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/defined no ref "root"/);
    expect(text(res)).toMatch(/it defined: body/);
  });
});

describe('wire_ui_event', () => {
  it('adds to the wires an entity already has', async () => {
    const { driver, calls } = fakeDriver({ getEventBindings: [{ event: 'click', action: 'old.action' }] });
    await runTool(capability('wire_ui_event'), driver, { entity: 3, event: 'click', action: 'ui.setVisible' });

    const set = calls.find((c) => c.method === 'setEventBindings')!;
    expect(set.args[1]).toEqual([
      { event: 'click', action: 'old.action' },
      { event: 'click', action: 'ui.setVisible' },
    ]);
  });

  it('drops them only when asked to, and does not even read them first', async () => {
    const { driver, calls } = fakeDriver({ getEventBindings: [{ event: 'click', action: 'old.action' }] });
    await runTool(capability('wire_ui_event'), driver, {
      entity: 3, event: 'click', action: 'ui.setVisible', replace: true,
    });

    expect(calls.map((c) => c.method)).toEqual(['setEventBindings']);
    expect(calls[0].args[1]).toEqual([{ event: 'click', action: 'ui.setVisible' }]);
  });
});

describe('create_behavior', () => {
  it('writes a defineBehavior script and attaches the component it defines', async () => {
    const { driver, calls } = fakeDriver({
      js: { ok: true, path: 'src/EnemyChase.ts', wiredInto: 'src/components.ts' },
      write_project_file: { ok: true, path: 'src/EnemyChase.ts', errors: [] },
    });
    const res = await runTool(capability('create_behavior'), driver, {
      name: 'EnemyChase',
      state: { speed: 120 },
      update: 'ctx.self.speed += dt;',
      attachTo: [4, 5],
    });

    expect(res.isError).toBeFalsy();
    const write = calls.find((c) => c.method === 'write_project_file')!;
    const source = String((write.args[0] as { content: string }).content);
    expect(source).toContain("defineBehavior('EnemyChase'");
    expect(source).toContain('"speed": 120');
    expect(source).toContain('ctx.self.speed += dt;');

    const ops = calls.find((c) => c.method === 'applyOps')!;
    expect(ops.args[0]).toEqual([
      { op: 'add_component', entity: 4, component: 'EnemyChase' },
      { op: 'add_component', entity: 5, component: 'EnemyChase' },
    ]);
    expect(JSON.parse(text(res))).toMatchObject({ name: 'EnemyChase', attached: 2 });
  });

  it('writes the script even with nothing to attach it to', async () => {
    const { driver, calls } = fakeDriver({
      js: { ok: true, path: 'src/Idle.ts' },
      write_project_file: { ok: true, errors: [] },
    });
    await runTool(capability('create_behavior'), driver, { name: 'Idle', update: '' });

    expect(calls.map((c) => c.method)).toEqual(['js', 'write_project_file']);
  });

  it('refuses to write logic into a script that was never wired in', async () => {
    const { driver, calls } = fakeDriver({ js: { ok: false, error: 'name already taken' } });
    const res = await runTool(capability('create_behavior'), driver, { name: 'Dup', update: '' });

    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/name already taken/);
    expect(calls.map((c) => c.method)).toEqual(['js']);
  });
});
