// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetRefLedger.ts
 * @brief   Who still holds an asset, per generation, with a receipt per acquire.
 *
 * @details A cache key is not an identity. `invalidate()` mints a new
 *          generation of the same key while the previous one still has holders,
 *          so a key-addressed release cannot know which one the caller was
 *          handed — it can only guess, and guessing frees somebody else's
 *          asset while leaving the caller's with nobody able to free it.
 *
 *          So an acquire hands back a LEASE: the receipt for that one
 *          acquisition. Releasing means giving the receipt back, not naming a
 *          path and hoping. The generation id is minted here rather than taken
 *          from the value, because a loader may hand out an `===` equal value
 *          for a later generation and two eras must never merge.
 *
 *          One implementation, because there were two: textures kept handles
 *          and generic assets kept loader entries, and only the texture one had
 *          been taught about generations. The kind of resource is the caller's
 *          business; the accounting is not.
 */

/** The receipt for one acquisition. Give it back to release exactly that one. */
export interface AssetRefLease<T> {
    readonly key: string;
    /** Ledger-minted. Distinguishes eras even when their values compare equal. */
    readonly generation: number;
    readonly value: T;
}

interface LeaseImpl<T> extends AssetRefLease<T> {
    /** A receipt spends once; giving it back twice must not drop a stranger's reference. */
    spent: boolean;
}

/** One generation: the value its holders were given, and how many hold it. */
export interface AssetRefGeneration<T> {
    readonly id: number;
    readonly value: T;
    count: number;
    /** Superseded by invalidate(): still held, but no new holder joins it. */
    superseded: boolean;
}

export class AssetRefLedger<T> {
    private byKey_ = new Map<string, Array<AssetRefGeneration<T>>>();
    private nextId_ = 1;

    /**
     * Record one more holder of `value` under `key` and hand back its receipt.
     *
     * Joins the key's current generation when it is holding the same value —
     * that is a cache hit, and both holders really do share one asset. A
     * superseded generation is never joined: its era is over.
     */
    acquire(key: string, value: T): AssetRefLease<T> {
        let generations = this.byKey_.get(key);
        if (!generations) {
            generations = [];
            this.byKey_.set(key, generations);
        }
        const current = generations[generations.length - 1];
        let generation: AssetRefGeneration<T>;
        if (current && !current.superseded && current.value === value) {
            current.count++;
            generation = current;
        } else {
            generation = { id: this.nextId_++, value, count: 1, superseded: false };
            generations.push(generation);
        }
        const lease: LeaseImpl<T> = { key, generation: generation.id, value, spent: false };
        return lease;
    }

    /**
     * The key's current generation is over: its holders keep what they have and
     * still owe a release, but the next acquire starts a new era rather than
     * joining theirs. Called when the cache entry is invalidated.
     */
    supersede(key: string): void {
        const generations = this.byKey_.get(key);
        const current = generations?.[generations.length - 1];
        if (current) current.superseded = true;
    }

    /**
     * Give back one receipt; `exhausted` says the caller now owns the disposal.
     *
     * A receipt the ledger no longer knows is a no-op rather than an error:
     * a wholesale {@link drain} already took that reference, and taking it
     * again is the double free.
     */
    release(lease: AssetRefLease<T>): { value: T; exhausted: boolean } | undefined {
        const impl = lease as LeaseImpl<T>;
        if (impl.spent) return undefined;
        const generations = this.byKey_.get(lease.key);
        const index = generations?.findIndex((g) => g.id === lease.generation) ?? -1;
        if (!generations || index < 0) return undefined;

        impl.spent = true;
        const generation = generations[index];
        if (--generation.count > 0) return { value: generation.value, exhausted: false };

        generations.splice(index, 1);
        if (generations.length === 0) this.byKey_.delete(lease.key);
        return { value: generation.value, exhausted: true };
    }

    /**
     * Drop one reference to `key` without a receipt, oldest generation first.
     *
     * The compatibility door for callers that only ever knew a path. It is
     * exact while a key has ONE generation, which is every key that was never
     * invalidated; `ambiguous` says it had to guess, so a caller that can carry
     * a lease is asked to. See {@link release}.
     */
    releaseOldest(key: string): { value: T; exhausted: boolean; ambiguous: boolean } | undefined {
        const generations = this.byKey_.get(key);
        if (!generations || generations.length === 0) return undefined;
        const ambiguous = generations.length > 1;

        const oldest = generations[0];
        oldest.count--;
        if (oldest.count > 0) return { value: oldest.value, exhausted: false, ambiguous };

        generations.shift();
        if (generations.length === 0) this.byKey_.delete(key);
        return { value: oldest.value, exhausted: true, ambiguous };
    }

    /** Every live value, and forget them all. For a wholesale teardown. */
    drain(): Array<{ key: string; value: T }> {
        const out: Array<{ key: string; value: T }> = [];
        for (const [key, generations] of this.byKey_) {
            for (const generation of generations) out.push({ key, value: generation.value });
        }
        this.byKey_.clear();
        return out;
    }

    /** Keys with at least one live reference. */
    get size(): number {
        return this.byKey_.size;
    }

    /**
     * Live references across every key and generation.
     *
     * The distinction from {@link size} is the whole point: a key whose count
     * climbs from one to a hundred is one key either way, so a census that
     * reported only `size` would show a runaway acquire as a flat line.
     */
    get rows(): number {
        let n = 0;
        for (const generations of this.byKey_.values()) {
            for (const generation of generations) n += generation.count;
        }
        return n;
    }

    /** @internal Live generations of one key, oldest first — diagnostics and tests. */
    generations(key: string): readonly AssetRefGeneration<T>[] {
        return this.byKey_.get(key) ?? [];
    }

    /** @internal The whole ledger, for the resource census. */
    entries(): ReadonlyMap<string, readonly AssetRefGeneration<T>[]> {
        return this.byKey_;
    }
}
