// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ContributionRegistry.ts
 * @brief   ONE ownership + disposal mechanism behind every editor extension point
 *          (commands, settings, panels, menus, modes, entity templates, …). The
 *          editor was already registry-driven; this adds the single missing
 *          concept — who registered what.
 *
 * Ownership is what makes a plugin system possible at all: disposing an owner
 * retracts its whole contribution set, so enable/disable, unload, and hot reload
 * are one operation instead of per-kind teardown code. Built-ins register under
 * `'core'` and never dispose, so they cost nothing but read through the same door
 * a plugin does — there is no separate "plugin API" to drift from.
 *
 * Conflicts resolve FIRST-REGISTRATION-WINS rather than by throwing: core
 * registers at module load, so a plugin can never hijack `edit.undo`, and one bad
 * id in a plugin's activate() must not abort the registrations after it. Losers
 * are recorded in {@link ContributionRegistry.conflicts} for the Plugins panel.
 */

/**
 * Who owns a contribution. `'core'` is the editor itself.
 *
 * `'user'` is a set the person edits in Settings and the editor projects into a
 * registry (agent providers). It disposes and re-registers as a group on every
 * edit — the same operation a plugin reload performs.
 */
export type Owner = 'core' | 'user' | `plugin:${string}`;

export interface Disposable {
  dispose(): void;
}

/** A rejected registration — its id was already taken by another owner. */
export interface Conflict {
  id: string;
  /** The owner that holds the id. */
  heldBy: Owner;
  /** The owner whose registration was rejected. */
  rejected: Owner;
}

interface Entry<T> {
  item: T;
  owner: Owner;
  /** Monotonic registration sequence — the tiebreaker that keeps `all()` stable. */
  seq: number;
}

const ownerRank = (owner: Owner): number => (owner === 'core' ? 0 : 1);

export class ContributionRegistry<T extends { id: string }> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly listeners = new Set<() => void>();
  private readonly conflictList: Conflict[] = [];
  private seq = 0;
  private revision = 0;
  // `all()` is read from render paths and the viewport pointer path, so the
  // ordered projection is cached and rebuilt only when the set changes.
  private ordered: readonly T[] | null = null;

  /** @param kind Human name used in conflict warnings (e.g. 'command', 'panel'). */
  constructor(private readonly kind: string) {}

  /**
   * Register `item` under `owner`. Re-registering the same id from the SAME owner
   * replaces it (idempotent module re-eval, plugin hot reload); a different owner
   * is rejected and recorded. The returned Disposable retracts only this entry.
   */
  register(owner: Owner, item: T): Disposable {
    const held = this.entries.get(item.id);
    if (held && held.owner !== owner) {
      this.conflictList.push({ id: item.id, heldBy: held.owner, rejected: owner });
      console.warn(`[contrib] ${this.kind} id "${item.id}" is already provided by ${held.owner}; ignoring ${owner}`);
      return { dispose: () => {} };
    }
    // A same-owner replacement keeps its original seq so re-registration doesn't
    // reshuffle menus/palettes under the user.
    this.entries.set(item.id, { item, owner, seq: held?.seq ?? this.seq++ });
    this.changed();
    return { dispose: () => this.remove(item.id, owner) };
  }

  /** Register every item of one owner at once (the core tables' entry point). */
  registerAll(owner: Owner, items: readonly T[]): Disposable {
    const disposables = items.map((item) => this.register(owner, item));
    return { dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  /** Every contribution: core first, then plugins in registration order. */
  all(): readonly T[] {
    if (!this.ordered) {
      this.ordered = [...this.entries.values()]
        .sort((a, b) => ownerRank(a.owner) - ownerRank(b.owner) || a.seq - b.seq)
        .map((e) => e.item);
    }
    return this.ordered;
  }

  ownerOf(id: string): Owner | undefined {
    return this.entries.get(id)?.owner;
  }

  /** Contributions of one owner (the Plugins panel's "what does this add?" view). */
  byOwner(owner: Owner): readonly T[] {
    return this.all().filter((item) => this.entries.get(item.id)?.owner === owner);
  }

  /** Retract every contribution of `owner` — the whole point of this class. */
  disposeOwner(owner: Owner): void {
    let removed = false;
    for (const [id, entry] of [...this.entries]) {
      if (entry.owner === owner) {
        this.entries.delete(id);
        removed = true;
      }
    }
    // Conflicts naming this owner are stale once it's gone, either way round: it
    // no longer holds an id, and its rejected attempts are no longer pending.
    for (let i = this.conflictList.length - 1; i >= 0; i--) {
      const c = this.conflictList[i];
      if (c.heldBy === owner || c.rejected === owner) this.conflictList.splice(i, 1);
    }
    if (removed) this.changed();
  }

  /** Registrations rejected because their id was taken (newest last). */
  conflicts(): readonly Conflict[] {
    return this.conflictList;
  }

  /** Bumps on every set change — the useSyncExternalStore snapshot. */
  getRevision(): number {
    return this.revision;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private remove(id: string, owner: Owner): void {
    const entry = this.entries.get(id);
    // Guard against a stale Disposable retracting a LATER registration of the
    // same id (dispose after the owner re-registered, or after a reload).
    if (entry?.owner !== owner) return;
    this.entries.delete(id);
    this.changed();
  }

  private changed(): void {
    this.ordered = null;
    this.revision++;
    for (const fn of this.listeners) fn();
  }
}
