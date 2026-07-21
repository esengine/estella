// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dirtyDocs — the built-in DirtyRegistry registrations: an edited
 *        AssetDocument (here the BT editor) makes the aggregate dirty and
 *        quit-save (saveAll) writes it to disk + clears its dirty flag.
 *        Pure TS with a stubbed window.estella.fs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirtyRegistry } from '@/document/DirtyRegistry';
import { BtDocument } from '@/bt/BtDocument';
import { FsmGraphDocument } from '@/fsm/FsmGraphDocument';
import { AnimatorGraphDocument } from '@/animator/AnimatorGraphDocument';
import type { BtDefinition, AnimatorControllerDef } from 'esengine';
import '@/document/dirtyDocs';

const write = vi.fn(async (_path: string, _text: string) => {});

beforeEach(() => {
  write.mockClear();
  (globalThis as { window?: unknown }).window = { estella: { fs: { write } } };
});

afterEach(() => {
  BtDocument.close();
  FsmGraphDocument.close();
  AnimatorGraphDocument.close();
  delete (globalThis as { window?: unknown }).window;
});

const animDef = (): AnimatorControllerDef =>
  ({ parameters: [], initialState: 'a', states: [{ name: 'a', transitions: [] }] }) as AnimatorControllerDef;

const btDef = (): BtDefinition =>
  ({ root: { id: 'root', type: 'selector', children: [] } }) as unknown as BtDefinition;

describe('built-in dirty documents', () => {
  it('an edited asset document makes the aggregate dirty (scene history aside)', () => {
    BtDocument.open(btDef(), 'assets/ai/x.esbt');
    expect(DirtyRegistry.isDirty()).toBe(false);
    BtDocument.edit('Add node', (d) => {
      (d as { root: { children: unknown[] } }).root.children.push({ id: 'n1', type: 'action' });
    });
    expect(BtDocument.dirty).toBe(true);
    expect(DirtyRegistry.isDirty()).toBe(true);
  });

  it('saveAll writes every dirty document and clears its flag', async () => {
    BtDocument.open(btDef(), 'assets/ai/x.esbt');
    BtDocument.edit('Add node', (d) => {
      (d as { root: { children: unknown[] } }).root.children.push({ id: 'n1', type: 'action' });
    });
    FsmGraphDocument.open({ initial: 'idle', states: {} } as never, 'assets/ai/y.esfsm');
    FsmGraphDocument.edit('Rename', (d) => {
      (d as { initial: string }).initial = 'run';
    });

    await DirtyRegistry.saveAll();

    const paths = write.mock.calls.map((c) => c[0]);
    expect(paths).toContain('assets/ai/x.esbt');
    expect(paths).toContain('assets/ai/y.esfsm');
    expect(BtDocument.dirty).toBe(false);
    expect(FsmGraphDocument.dirty).toBe(false);
    expect(JSON.parse(write.mock.calls.find((c) => c[0] === 'assets/ai/y.esfsm')![1] as string)).toEqual({
      initial: 'run',
      states: {},
    });
  });

  it('an edited .esanimator makes the aggregate dirty and saveAll writes it (no silent loss)', async () => {
    AnimatorGraphDocument.open(animDef(), 'assets/anim/player.esanimator');
    expect(DirtyRegistry.isDirty()).toBe(false);
    AnimatorGraphDocument.edit('Rename state', (d) => {
      (d as AnimatorControllerDef).initialState = 'b';
    });
    // The whole point of the fix: the aggregate guard (discard/quit/autosave) sees it.
    expect(DirtyRegistry.isDirty()).toBe(true);
    await DirtyRegistry.saveAll();
    expect(write.mock.calls.map((c) => c[0])).toContain('assets/anim/player.esanimator');
    expect(AnimatorGraphDocument.dirty).toBe(false);
  });

  it('saveDoc saves ONLY the named document (context-aware Ctrl+S)', async () => {
    BtDocument.open(btDef(), 'assets/ai/x.esbt');
    BtDocument.edit('Add node', (d) => {
      (d as { root: { children: unknown[] } }).root.children.push({ id: 'n1', type: 'action' });
    });
    AnimatorGraphDocument.open(animDef(), 'assets/anim/player.esanimator');
    AnimatorGraphDocument.edit('Rename', (d) => {
      (d as AnimatorControllerDef).initialState = 'b';
    });

    const saved = await DirtyRegistry.saveDoc('animator');
    expect(saved).toBe(true);
    const paths = write.mock.calls.map((c) => c[0]);
    expect(paths).toContain('assets/anim/player.esanimator');
    expect(paths).not.toContain('assets/ai/x.esbt'); // the BT was NOT touched
    expect(AnimatorGraphDocument.dirty).toBe(false);
    expect(BtDocument.dirty).toBe(true); // still dirty — only the active doc saved
    // A clean doc is a no-op.
    expect(await DirtyRegistry.saveDoc('animator')).toBe(false);
  });

  it('a clean (or closed) document is not written', async () => {
    await DirtyRegistry.saveAll();
    expect(write).not.toHaveBeenCalled();
  });
});
