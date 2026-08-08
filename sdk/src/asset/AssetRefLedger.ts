// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetRefLedger.ts
 * @brief   Who still holds an asset, per generation.
 *
 * @details A cache key is not an identity. `invalidate()` mints a new
 *          generation of the same key while the previous one still has holders,
 *          so a ledger with one slot per key attributes their release to the
 *          replacement — and the resource they were actually handed is left
 *          with nobody able to free it.
 *
 *          One implementation, because there were two: textures kept handles
 *          and generic assets kept loader entries, and only the texture one had
 *          been taught about generations. The kind of resource is the caller's
 *          business; the accounting is not.
 */

/** One generation: the value its holders were given, and how many hold it. */
export interface AssetRefGeneration<T> {
    readonly value: T;
    count: number;
}

export class AssetRefLedger<T> {
    private byKey_ = new Map<string, Array<AssetRefGeneration<T>>>();

    /** Record one more holder of `value` under `key`. */
    acquire(key: string, value: T): void {
        let generations = this.byKey_.get(key);
        if (!generations) {
            generations = [];
            this.byKey_.set(key, generations);
        }
        const existing = generations.find((g) => g.value === value);
        if (existing) existing.count++;
        else generations.push({ value, count: 1 });
    }

    /**
     * Drop one reference from the OLDEST generation of `key`; `exhausted` says
     * the caller now owns the disposal. Oldest first so a superseded generation
     * drains as its holders let go — they are indistinguishable through a
     * key-addressed API, and a release naming the old value never comes.
     */
    release(key: string): { value: T; exhausted: boolean } | undefined {
        const generations = this.byKey_.get(key);
        if (!generations || generations.length === 0) return undefined;

        const oldest = generations[0];
        oldest.count--;
        if (oldest.count > 0) return { value: oldest.value, exhausted: false };

        generations.shift();
        if (generations.length === 0) this.byKey_.delete(key);
        return { value: oldest.value, exhausted: true };
    }

    /**
     * Drop one reference to a SPECIFIC value, naming what it means rather than
     * taking the oldest. A no-op when the ledger no longer knows it — someone
     * else already took that reference, and taking it again is the double free.
     */
    releaseValue(key: string, value: T): boolean {
        const generations = this.byKey_.get(key);
        const index = generations?.findIndex((g) => g.value === value) ?? -1;
        if (!generations || index < 0) return false;

        const generation = generations[index];
        if (--generation.count > 0) return false;
        generations.splice(index, 1);
        if (generations.length === 0) this.byKey_.delete(key);
        return true;
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

    /** @internal Live generations of one key, oldest first — diagnostics and tests. */
    generations(key: string): readonly AssetRefGeneration<T>[] {
        return this.byKey_.get(key) ?? [];
    }

    /** @internal The whole ledger, for the resource census. */
    entries(): ReadonlyMap<string, readonly AssetRefGeneration<T>[]> {
        return this.byKey_;
    }
}
