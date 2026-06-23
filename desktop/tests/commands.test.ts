// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor command system — keybinding parsing/matching/formatting and the
 *        registry's event resolution + enablement gating. Pure logic (no WASM):
 *        importing '@/commands' registers every editor command as a side effect.
 */
import { describe, it, expect } from 'vitest';
import { eventToChord, normalizeChord, chordMatches, formatKeybinding } from '@/commands/keybinding';
import { commands } from '@/commands';

const ev = (
  key: string,
  mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent =>
  ({
    key,
    metaKey: !!mods.mod,
    ctrlKey: false,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  }) as KeyboardEvent;

describe('keybinding', () => {
  it('eventToChord canonicalizes modifiers + key', () => {
    expect(eventToChord(ev('s', { mod: true }))).toBe('mod+s');
    expect(eventToChord(ev('S', { mod: true, shift: true }))).toBe('mod+shift+s');
    expect(eventToChord(ev('Delete'))).toBe('delete');
    expect(eventToChord(ev('Escape'))).toBe('escape');
    expect(eventToChord(ev('F5'))).toBe('f5');
  });

  it('normalizeChord reorders + aliases modifiers', () => {
    expect(normalizeChord('shift+mod+s')).toBe('mod+shift+s');
    expect(normalizeChord('cmd+z')).toBe('mod+z');
    expect(normalizeChord('ctrl+y')).toBe('mod+y');
    expect(normalizeChord('Delete')).toBe('delete');
  });

  it('chordMatches handles single + multi bindings', () => {
    expect(chordMatches(ev('z', { mod: true, shift: true }), ['mod+shift+z', 'mod+y'])).toBe(true);
    expect(chordMatches(ev('y', { mod: true }), ['mod+shift+z', 'mod+y'])).toBe(true);
    expect(chordMatches(ev('z', { mod: true }), 'mod+z')).toBe(true);
    expect(chordMatches(ev('z', { mod: true, shift: true }), 'mod+z')).toBe(false); // shift differs
  });

  it('formatKeybinding renders a hint from the first chord', () => {
    expect(formatKeybinding('mod+s')).toMatch(/S$/);
    expect(formatKeybinding(['mod+shift+z', 'mod+y'])).toMatch(/Z$/);
  });
});

describe('command registry', () => {
  it('forEvent resolves an enabled command by chord', () => {
    // tool.move ('w') has no isEnabled → always enabled.
    expect(commands.forEvent(ev('w'))?.id).toBe('tool.move');
    expect(commands.forEvent(ev('q'))?.id).toBe('tool.select');
  });

  it('forEvent skips a disabled command', () => {
    // edit.undo ('mod+z') is disabled with an empty history → no match.
    expect(commands.forEvent(ev('z', { mod: true }))).toBeUndefined();
  });

  it('registers the editor commands with ids + labels', () => {
    const ids = commands.all().map((c) => c.id);
    expect(ids).toContain('entity.delete');
    expect(ids).toContain('play.toggle');
    expect(ids).toContain('view.toggleGrid');
    expect(commands.get('entity.delete')?.label).toBe('Delete');
    expect(commands.get('entity.delete')?.keybinding).toEqual(['delete', 'backspace']);
  });
});
