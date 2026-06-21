/**
 * @file    registry.ts
 * @brief   The editor command registry — one map of id → Command, plus the
 *          dispatch helpers every consumer shares: run by id, query enablement /
 *          checked state, resolve the command bound to a key event. Holds no
 *          reactive state of its own; enablement is derived on demand from the
 *          domain stores the UI already subscribes to.
 */
import type { Command, Keybinding } from './types';
import { chordMatches } from './keybinding';

const OVERRIDE_KEY = 'estella.keybindings';

const primaryChord = (kb: Keybinding | undefined): string =>
  (Array.isArray(kb) ? kb[0] : kb) ?? '';

class CommandRegistry {
  private readonly map = new Map<string, Command>();
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

  register(cmd: Command): void {
    this.map.set(cmd.id, cmd);
  }

  get(id: string): Command | undefined {
    return this.map.get(id);
  }

  all(): Command[] {
    return [...this.map.values()];
  }

  /** Effective keybinding: the user override if set, else the command default. */
  keybindingFor(id: string): Keybinding | undefined {
    return this.overrides.has(id) ? this.overrides.get(id) : this.map.get(id)?.keybinding;
  }

  hasOverride(id: string): boolean {
    return this.overrides.has(id);
  }

  /** Rebind a command. Setting it back to the default clears the override. */
  setKeybinding(id: string, chord: string): void {
    if (chord === primaryChord(this.map.get(id)?.keybinding)) this.overrides.delete(id);
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
    const c = this.map.get(id);
    return c ? c.isEnabled?.() ?? true : false;
  }

  isChecked(id: string): boolean | undefined {
    return this.map.get(id)?.isChecked?.();
  }

  /** Run a command by id (no-op if missing or currently disabled). */
  run(id: string): void {
    const c = this.map.get(id);
    if (c && (c.isEnabled?.() ?? true)) c.run();
  }

  /** The enabled command bound to a key event, if any (honors overrides). */
  forEvent(e: KeyboardEvent): Command | undefined {
    for (const c of this.map.values()) {
      const kb = this.keybindingFor(c.id);
      if (kb && chordMatches(e, kb) && (c.isEnabled?.() ?? true)) return c;
    }
    return undefined;
  }
}

export const commands = new CommandRegistry();
