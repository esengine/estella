/**
 * @file    keybinding.ts
 * @brief   Keybinding chord parsing, normalization, event-matching, and display
 *          formatting — so a command's `keybinding` string is the single source
 *          for both global key dispatch and the shortcut hint shown in menus.
 *
 * Chord grammar: '+'-joined, case-insensitive tokens — modifiers `mod`/`alt`/
 * `shift` plus one key (`s`, `z`, `f5`, `delete`, `escape`, …). `mod` is the
 * platform command key: ⌘ on macOS, Ctrl elsewhere.
 */
import type { Keybinding } from './types';

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '');

const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

function normalizeKey(key: string): string {
  const k = key.toLowerCase();
  return SPECIAL_KEYS[k] ?? k;
}

/** Canonical chord for a key event: e.g. ⇧⌘S → 'mod+shift+s'. */
export function eventToChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

/** Canonical chord for a binding string: tokens reordered to mod+alt+shift+key. */
export function normalizeChord(kb: string): string {
  let mod = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const raw of kb.toLowerCase().split('+')) {
    const t = raw.trim();
    if (t === 'mod' || t === 'cmd' || t === 'command' || t === 'ctrl' || t === 'control' || t === 'meta')
      mod = true;
    else if (t === 'alt' || t === 'option') alt = true;
    else if (t === 'shift') shift = true;
    else if (t) key = normalizeKey(t);
  }
  const parts: string[] = [];
  if (mod) parts.push('mod');
  if (alt) parts.push('alt');
  if (shift) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** Does a key event match any chord of a binding? */
export function chordMatches(e: KeyboardEvent, kb: Keybinding): boolean {
  const chord = eventToChord(e);
  const list = Array.isArray(kb) ? kb : [kb];
  return list.some((k) => normalizeChord(k) === chord);
}

function displayKey(key: string): string {
  const map: Record<string, string> = {
    delete: IS_MAC ? '⌫' : 'Del',
    backspace: IS_MAC ? '⌫' : 'Backspace',
    escape: 'Esc',
    space: 'Space',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
  };
  return map[key] ?? key.toUpperCase();
}

/** Human-readable hint for a binding (first chord), e.g. 'mod+shift+s' → '⇧⌘S'. */
export function formatKeybinding(kb: Keybinding): string {
  const first = Array.isArray(kb) ? kb[0] : kb;
  const tokens = normalizeChord(first).split('+');
  const key = tokens.pop() ?? '';
  const mod = tokens.includes('mod');
  const alt = tokens.includes('alt');
  const shift = tokens.includes('shift');
  const k = displayKey(key);
  if (IS_MAC) return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}${mod ? '⌘' : ''}${k}`;
  const parts: string[] = [];
  if (mod) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}
