// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The ownership/disposal mechanism every extension point shares. The rules
 *        that matter: core always outranks a plugin (order AND id conflicts), an
 *        owner is retractable as a set, and a stale Disposable can never retract
 *        someone else's later registration of the same id.
 */
import { describe, it, expect, vi } from 'vitest';
import { ContributionRegistry } from '@/contrib/ContributionRegistry';

interface Item {
  id: string;
  label?: string;
}

const reg = () => new ContributionRegistry<Item>('thing');
const ids = (r: ContributionRegistry<Item>) => r.all().map((i) => i.id);

describe('ContributionRegistry', () => {
  it('orders core before plugins, registration order within each', () => {
    const r = reg();
    r.register('plugin:b', { id: 'b1' });
    r.register('core', { id: 'c1' });
    r.register('plugin:a', { id: 'a1' });
    r.register('core', { id: 'c2' });
    r.register('plugin:b', { id: 'b2' });
    expect(ids(r)).toEqual(['c1', 'c2', 'b1', 'a1', 'b2']);
  });

  it('first registration wins an id conflict, and the loser is recorded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = reg();
    r.register('core', { id: 'edit.undo', label: 'core' });
    const d = r.register('plugin:evil', { id: 'edit.undo', label: 'hijacked' });

    expect(r.get('edit.undo')?.label).toBe('core');
    expect(r.ownerOf('edit.undo')).toBe('core');
    expect(r.conflicts()).toEqual([{ id: 'edit.undo', heldBy: 'core', rejected: 'plugin:evil' }]);
    // The rejected registration's disposable must be inert — not a way to evict core.
    d.dispose();
    expect(r.get('edit.undo')?.label).toBe('core');
    warn.mockRestore();
  });

  it('same-owner re-registration replaces in place, keeping position', () => {
    const r = reg();
    r.register('core', { id: 'a', label: 'v1' });
    r.register('core', { id: 'b' });
    r.register('core', { id: 'a', label: 'v2' });
    expect(r.get('a')?.label).toBe('v2');
    expect(ids(r)).toEqual(['a', 'b']); // 'a' did not jump to the end
  });

  it('disposeOwner retracts the whole set and clears its conflicts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = reg();
    r.register('core', { id: 'c1' });
    r.registerAll('plugin:p', [{ id: 'p1' }, { id: 'p2' }]);
    r.register('plugin:p', { id: 'c1' }); // conflict, recorded
    expect(r.conflicts()).toHaveLength(1);

    r.disposeOwner('plugin:p');
    expect(ids(r)).toEqual(['c1']);
    expect(r.byOwner('plugin:p')).toEqual([]);
    expect(r.conflicts()).toEqual([]);
    warn.mockRestore();
  });

  it('a stale disposable cannot retract a later registration of the same id', () => {
    const r = reg();
    const stale = r.register('plugin:p', { id: 'x', label: 'old' });
    r.disposeOwner('plugin:p');
    r.register('plugin:q', { id: 'x', label: 'new' });

    stale.dispose();
    expect(r.get('x')?.label).toBe('new');
  });

  it('notifies subscribers and bumps the revision on every set change', () => {
    const r = reg();
    const seen: number[] = [];
    const unsub = r.subscribe(() => seen.push(r.getRevision()));

    const d = r.register('core', { id: 'a' });
    r.registerAll('plugin:p', [{ id: 'p1' }, { id: 'p2' }]);
    d.dispose();
    r.disposeOwner('plugin:p');
    expect(seen).toEqual([1, 2, 3, 4, 5]);

    unsub();
    r.register('core', { id: 'z' });
    expect(seen).toHaveLength(5);
  });

  it('disposeOwner on an owner with nothing registered is silent', () => {
    const r = reg();
    r.register('core', { id: 'a' });
    const seen: number[] = [];
    r.subscribe(() => seen.push(r.getRevision()));
    r.disposeOwner('plugin:absent');
    expect(seen).toEqual([]);
    expect(ids(r)).toEqual(['a']);
  });

  it('byOwner reports each owner`s own contributions', () => {
    const r = reg();
    r.register('core', { id: 'c1' });
    r.registerAll('plugin:p', [{ id: 'p1' }, { id: 'p2' }]);
    expect(r.byOwner('core').map((i) => i.id)).toEqual(['c1']);
    expect(r.byOwner('plugin:p').map((i) => i.id)).toEqual(['p1', 'p2']);
  });
});
