// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    diffs.ts
 * @brief   What the players changed in a generated world, kept apart from it: what was taken away and what was moved.
 *
 * @details The world is made again from its rules every time a chunk comes near; what a player did is laid over it before anything is
 *          shown, so a felled tree stays felled after its chunk is let go and made again, and after a save is read back. Changes are
 *          kept by placement id, which does not change with the order things are made in or with rules added later. What a player
 *          builds is not a change to the generated world: it is the game's own, and the zone it reserves keeps generation out of it.
 */

/** Where and how a placement was moved: any of its position, its turn and its scale. */
export interface PlacementChange { x?: number; y?: number; z?: number; yaw?: number; scale?: number }

/** A world's changes, as a save stores them. */
export interface PlacementDiffsData { version: 1; removed: string[]; changed: Record<string, PlacementChange> }

export class PlacementDiffs {
    private readonly removed_ = new Set<string>();
    private readonly changed_ = new Map<string, PlacementChange>();
    private readonly listeners_ = new Set<NonNullable<PlacementDiffs['onChange']>>();
    revision = 0;
    /** Told the id of every placement that changed, so only its chunk is made again. */
    onChange: ((id: string) => void) | null = null;

    /** Listens alongside other consumers; the returned function stops listening. */
    subscribe(listener: NonNullable<PlacementDiffs['onChange']>): () => void {
        this.listeners_.add(listener);
        return () => { this.listeners_.delete(listener); };
    }

    private notify(id: string): void {
        this.onChange?.(id);
        for (const listener of this.listeners_) listener(id);
    }

    /** Takes a placement out of the world for good (felled, mined, picked up). */
    remove(id: string): void {
        if (this.removed_.has(id)) return;
        this.removed_.add(id);
        this.changed();
        this.notify(id);
    }

    /** Puts a removed placement back (it grew again). */
    restore(id: string): void {
        if (!this.removed_.delete(id)) return;
        this.changed();
        this.notify(id);
    }

    /** Moves, turns or scales a placement. */
    change(id: string, change: PlacementChange): void {
        this.changed_.set(id, { ...this.changed_.get(id), ...change });
        this.changed();
        this.notify(id);
    }

    isRemoved(id: string): boolean {
        return this.removed_.has(id);
    }

    changeOf(id: string): PlacementChange | undefined {
        return this.changed_.get(id);
    }

    toJSON(): PlacementDiffsData {
        return { version: 1, removed: [...this.removed_].sort(), changed: Object.fromEntries([...this.changed_].sort(([a], [b]) => (a < b ? -1 : 1))) };
    }

    /** Replaces every change with a save's. */
    load(data: PlacementDiffsData): void {
        const touched = new Set([...this.removed_, ...this.changed_.keys(), ...data.removed, ...Object.keys(data.changed)]);
        this.removed_.clear();
        this.changed_.clear();
        for (const id of data.removed) this.removed_.add(id);
        for (const [id, c] of Object.entries(data.changed)) this.changed_.set(id, { ...c });
        this.changed();
        for (const id of touched) this.notify(id);
    }

    private changed(): void {
        this.revision++;
    }
}
