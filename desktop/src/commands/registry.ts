/**
 * @file    registry.ts
 * @brief   The editor command registry — one map of id → Command, plus the
 *          dispatch helpers every consumer shares: run by id, query enablement /
 *          checked state, resolve the command bound to a key event. Holds no
 *          reactive state of its own; enablement is derived on demand from the
 *          domain stores the UI already subscribes to.
 */
import type { Command } from './types';
import { chordMatches } from './keybinding';

class CommandRegistry {
  private readonly map = new Map<string, Command>();

  register(cmd: Command): void {
    this.map.set(cmd.id, cmd);
  }

  get(id: string): Command | undefined {
    return this.map.get(id);
  }

  all(): Command[] {
    return [...this.map.values()];
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

  /** The enabled command bound to a key event, if any. */
  forEvent(e: KeyboardEvent): Command | undefined {
    for (const c of this.map.values()) {
      if (c.keybinding && chordMatches(e, c.keybinding) && (c.isEnabled?.() ?? true)) return c;
    }
    return undefined;
  }
}

export const commands = new CommandRegistry();
