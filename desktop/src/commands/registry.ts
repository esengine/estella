// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registry.ts
 * @brief   The editor command registry — the dispatch helpers every consumer
 *          shares: run by id, query enablement / checked state, resolve the command
 *          bound to a key event. Enablement is derived on demand from the domain
 *          stores the UI already subscribes to, so the registry holds no reactive
 *          state beyond the contribution set itself.
 *
 * The set lives in a ContributionRegistry, so a command carries an owner and a
 * plugin's commands are retractable as a group. `register(cmd)` keeps its
 * one-argument shape (implicitly `'core'`) — a built-in registration reads exactly
 * as before, and there is no separate door for plugins to drift from.
 */
import type { Command, Keybinding } from './types';
import { chordMatches, normalizeChord } from './keybinding';
import { PerfMonitor } from '@/engine/PerfMonitor';
import { note } from '@/diagnostics/timeline';
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

const OVERRIDE_KEY = 'estella.keybindings';

const primaryChord = (kb: Keybinding | undefined): string =>
  (Array.isArray(kb) ? kb[0] : kb) ?? '';

class CommandRegistry {
  private readonly contrib = new ContributionRegistry<Command>('command');
  // User keybinding overrides (commandId → chord), persisted per-user. The
  // effective binding is `override ?? command.keybinding`, resolved on demand.
  private readonly overrides = new Map<string, string>();

  constructor() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? '{}') as Record<string, string>;
        for (const [id, chord] of Object.entries(saved)) this.overrides.set(id, chord);
      } catch {
        /* corrupt / absent — start with no overrides */
      }
    }
  }

  /** Register a command. `owner` defaults to the editor itself; a plugin passes
   *  its own owner so the returned Disposable (and disposeOwner) can retract it. */
  register(cmd: Command, owner: Owner = 'core'): Disposable {
    return this.contrib.register(owner, cmd);
  }

  get(id: string): Command | undefined {
    return this.contrib.get(id);
  }

  all(): Command[] {
    return [...this.contrib.all()];
  }

  ownerOf(id: string): Owner | undefined {
    return this.contrib.ownerOf(id);
  }

  /** Retract every command of one owner (plugin unload / disable / reload). */
  disposeOwner(owner: Owner): void {
    this.contrib.disposeOwner(owner);
  }

  /** Subscribe to the command SET changing (registrations, not enablement) —
   *  menus and the palette re-derive from it. Returns an unsubscribe. */
  subscribe(fn: () => void): () => void {
    return this.contrib.subscribe(fn);
  }

  /** Snapshot of the command set's identity, for useSyncExternalStore. */
  getRevision(): number {
    return this.contrib.getRevision();
  }

  /** Effective keybinding: the user override if set, else the command default. */
  keybindingFor(id: string): Keybinding | undefined {
    return this.overrides.has(id) ? this.overrides.get(id) : this.contrib.get(id)?.keybinding;
  }

  hasOverride(id: string): boolean {
    return this.overrides.has(id);
  }

  /** Other commands whose effective binding matches `chord` (canonical compare),
   *  excluding `exceptId` — for rebind conflict warnings. Note some overlaps are
   *  intentional (context-gated keys like Escape = Stop / Deselect), so callers
   *  warn rather than block. */
  conflictsFor(chord: string, exceptId?: string): string[] {
    const target = normalizeChord(chord);
    const out: string[] = [];
    for (const c of this.contrib.all()) {
      if (c.id === exceptId) continue;
      const kb = this.keybindingFor(c.id);
      if (!kb) continue;
      const list = Array.isArray(kb) ? kb : [kb];
      if (list.some((k) => normalizeChord(k) === target)) out.push(c.id);
    }
    return out;
  }

  /** Rebind a command. Setting it back to the default clears the override. */
  setKeybinding(id: string, chord: string): void {
    if (chord === primaryChord(this.contrib.get(id)?.keybinding)) this.overrides.delete(id);
    else this.overrides.set(id, chord);
    this.persistOverrides();
  }

  resetKeybinding(id: string): void {
    this.overrides.delete(id);
    this.persistOverrides();
  }

  private persistOverrides(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(Object.fromEntries(this.overrides)));
    } catch {
      /* quota / private mode */
    }
  }

  isEnabled(id: string): boolean {
    const c = this.contrib.get(id);
    return c ? c.isEnabled?.() ?? true : false;
  }

  isChecked(id: string): boolean | undefined {
    return this.contrib.get(id)?.isChecked?.();
  }

  /** Run a command by id (no-op if missing or currently disabled). */
  run(id: string): void {
    const c = this.contrib.get(id);
    if (!c) return;
    // A command that was asked for and REFUSED is worth as much in a report as
    // one that ran: "undo, nothing happened, undo again" is a bug report.
    if (!(c.isEnabled?.() ?? true)) {
      note('command', id, 'disabled');
      return;
    }
    note('command', id);
    PerfMonitor.measure(`cmd.${id}`, () => c.run());
  }

  /** The enabled command bound to a key event, if any (honors overrides). */
  forEvent(e: KeyboardEvent): Command | undefined {
    for (const c of this.contrib.all()) {
      const kb = this.keybindingFor(c.id);
      if (kb && chordMatches(e, kb) && (c.isEnabled?.() ?? true)) return c;
    }
    return undefined;
  }
}

export const commands = new CommandRegistry();
