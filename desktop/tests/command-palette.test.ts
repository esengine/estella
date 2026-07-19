// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Command-palette logic: fuzzy filter/rank and the registry → item
 *        projection (keybinding + enablement snapshot). The React shell only
 *        renders these results, so the contract lives here.
 */
import { describe, it, expect } from 'vitest';
import { fuzzyScore, filterPalette, paletteItems, paletteText } from '@/commands/palette';
import type { Command } from '@/commands/types';

describe('fuzzyScore', () => {
  it('matches subsequences, rejects non-subsequences', () => {
    expect(fuzzyScore('sv', 'Save Scene')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Save Scene')).toBeNull();
  });

  it('is case-insensitive and matches everything on an empty query', () => {
    expect(fuzzyScore('SAVE', 'save scene')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('ranks consecutive and word-start matches above scattered ones', () => {
    const consecutive = fuzzyScore('save', 'Save Scene')!;
    const scattered = fuzzyScore('save', 'Set Anchor & Viewport Edge')!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('ignores spaces in the query (VS Code style multi-term typing)', () => {
    expect(fuzzyScore('open proj', 'File: Open Project…')).not.toBeNull();
  });
});

describe('filterPalette', () => {
  const items = [
    { label: 'Undo', category: 'Edit' },
    { label: 'Open Project…', category: 'File' },
    { label: 'Redo', category: 'Edit' },
    { label: 'Play', category: 'Play' },
  ];

  it('empty query keeps registration order', () => {
    expect(filterPalette(items, '  ').map((i) => i.label)).toEqual(['Undo', 'Open Project…', 'Redo', 'Play']);
  });

  it('filters by fuzzy match over "category: label"', () => {
    expect(filterPalette(items, 'file open').map((i) => i.label)).toEqual(['Open Project…']);
    // Both Edit commands tie on the category match → alphabetical by label.
    expect(filterPalette(items, 'edit').map((i) => i.label)).toEqual(['Redo', 'Undo']);
  });

  it('ties broken by label, so the order is deterministic', () => {
    // 'do' scores 'Edit: Undo' and 'Edit: Redo' identically → alphabetical.
    expect(filterPalette(items, 'do').map((i) => i.label)).toEqual(['Redo', 'Undo']);
  });
});

describe('paletteItems', () => {
  const cmds: Command[] = [
    { id: 'a.on', label: 'Enabled', category: 'Test', keybinding: 'mod+k', run: () => {} },
    { id: 'a.off', label: 'Disabled', category: 'Test', run: () => {}, isEnabled: () => false },
    { id: 'a.multi', label: 'Multi', keybinding: ['mod+shift+z', 'mod+y'], run: () => {} },
  ];

  it('snapshots enablement — disabled commands stay listed but flagged', () => {
    const items = paletteItems(cmds, (id) => cmds.find((c) => c.id === id)?.keybinding);
    expect(items.map((i) => [i.id, i.enabled])).toEqual([
      ['a.on', true],
      ['a.off', false],
      ['a.multi', true],
    ]);
  });

  it('resolves the effective keybinding (first chord of a multi-binding)', () => {
    const items = paletteItems(cmds, (id) => cmds.find((c) => c.id === id)?.keybinding);
    expect(items.find((i) => i.id === 'a.on')?.keybinding).toBe('mod+k');
    expect(items.find((i) => i.id === 'a.multi')?.keybinding).toBe('mod+shift+z');
    expect(items.find((i) => i.id === 'a.off')?.keybinding).toBeUndefined();
  });

  it('honors a user override passed through keybindingFor', () => {
    const items = paletteItems(cmds, (id) => (id === 'a.on' ? 'mod+alt+k' : undefined));
    expect(items.find((i) => i.id === 'a.on')?.keybinding).toBe('mod+alt+k');
  });
});

describe('paletteText', () => {
  it('is category-qualified like VS Code', () => {
    expect(paletteText({ label: 'Undo', category: 'Edit' })).toBe('Edit: Undo');
    expect(paletteText({ label: 'Undo' })).toBe('Undo');
  });
});
