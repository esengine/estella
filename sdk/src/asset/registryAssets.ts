// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    registryAssets.ts
 * @brief   The identity of an asset a component names by REF rather than by handle.
 *
 * @details Two asset models had one ownership vocabulary between them. A sprite
 *          holds `texture = 17`: the field names an exact instance, so its owner
 *          holds a receipt for that generation. A `SpriteAnimator` holds
 *          `clip = "walk.esanim"`: the field names an asset, and every lookup
 *          asks a registry which object that name means NOW. Such a holder never
 *          had a generation to own — give it one and the moment a hot update
 *          republishes, ownership says one era while the component uses another.
 *
 *          So what it owns is the SLOT: the stable name, however many eras pass
 *          under it. An era owns what it acquired for itself and nothing else —
 *          publication belongs to the slot, which is what makes it impossible
 *          for a retiring era to unpublish the newer one that replaced it.
 */
import type { AssetLease } from './AssetLease';
import { AssetScope } from './AssetLease';

/** One era of a registry-backed asset. */
export interface RegistryEra<T> {
    /** The runtime object a lookup returns while this era is the published one. */
    readonly published: unknown;
    /** The logical identity a holder keeps — the same across every era. */
    readonly value: T;
    /** What this era acquired for itself; released when it retires. */
    readonly dependencies: AssetScope;
}

/**
 * How one kind of registry-backed asset is prepared and published.
 *
 * `prepare` must NOT publish: an era that could write the registry could also
 * take a newer era's entry out of it.
 */
export interface RegistryAssetKind<T> {
    prepare(path: string): Promise<RegistryEra<T>>;
    publish(names: readonly string[], published: unknown): void;
    unpublish(names: readonly string[], published: unknown): void;
}

/** A holder's claim on a slot. Its `generation` names the SLOT, not an era —
 *  which era is current is the slot's business and changes under the holder. */
export interface RegistrySlotLease<T> extends AssetLease<T> {
    /** Every name that resolves to this slot: the load path and its aliases. */
    readonly names: readonly string[];
}

export function isRegistrySlotLease(lease: AssetLease): lease is RegistrySlotLease<unknown> {
    return Array.isArray((lease as { names?: unknown }).names);
}

class Slot<T> {
    /** What a lookup asks for. Distinct from `key`, which is what an OWNER
     *  holds: a registry answers to a ref, not to an ownership identity. */
    readonly names: string[] = [];
    refs = 0;
    era: RegistryEra<T> | null = null;
    loading: Promise<RegistryEra<T>> | null = null;

    constructor(readonly key: string, readonly id: number) {}
}

/**
 * Every registry-backed asset this Assets has published, by every name that
 * resolves to it.
 */
export class RegistryAssetSlots {
    private byName_ = new Map<string, Slot<unknown>>();
    private nextId_ = 1;

    /**
     * A claim on the slot `key` identifies, publishing its first era if there is
     * none. `names` are what the registry answers to — the load path and every
     * ref a component may spell it as, all resolving to the SAME slot rather
     * than to a copy of the object.
     */
    async acquire<T>(
        kind: RegistryAssetKind<T>, key: string, names: readonly string[],
    ): Promise<RegistrySlotLease<T>> {
        const slot = this.slotFor_(key) as Slot<T>;
        for (const name of names) this.name_(slot as Slot<unknown>, name);

        if (!slot.era) {
            slot.loading ??= kind.prepare(key);
            let era: RegistryEra<T>;
            try {
                era = await slot.loading;
            } catch (e) {
                slot.loading = null;
                if (slot.refs === 0) this.forget_(slot as Slot<unknown>);
                throw e;
            }
            slot.loading = null;
            // Another acquire may have published while this one awaited; joining
            // it is a cache hit, and publishing twice would retire what is live.
            if (!slot.era) {
                slot.era = era;
                kind.publish(slot.names, era.published);
            } else if (era !== slot.era) {
                era.dependencies.releaseAll();
            }
        }
        return this.lease_(kind, slot);
    }

    /**
     * Replace the current era with a freshly prepared one, atomically.
     *
     * A failed prepare leaves the slot exactly as it was — holders keep working
     * with the era they have rather than losing it to a bad download. Answers
     * false when nothing holds this name.
     */
    async republish<T>(kind: RegistryAssetKind<T>, name: string): Promise<boolean> {
        const slot = this.byName_.get(name) as Slot<T> | undefined;
        if (!slot?.era) return false;
        const era = await kind.prepare(slot.key);
        const previous = slot.era;
        slot.era = era;
        kind.publish(slot.names, era.published);
        // Its dependencies only. The registry entry it was under already names
        // the era published above, and is not this one's to take away.
        previous.dependencies.releaseAll();
        return true;
    }

    /** Whether this name is one a slot answers to. */
    has(name: string): boolean {
        return this.byName_.has(name);
    }

    /** The runtime object published for `name`, if any. Diagnostics and tests. */
    published(name: string): unknown {
        return this.byName_.get(name)?.era?.published;
    }

    /** Live slots — one per asset, however many names it answers to. */
    get size(): number {
        return new Set(this.byName_.values()).size;
    }

    /** Give up every slot. For a wholesale teardown. */
    releaseAll(kinds: (key: string) => RegistryAssetKind<unknown> | undefined): void {
        for (const slot of new Set(this.byName_.values())) {
            kinds(slot.key)?.unpublish(slot.names, slot.era?.published);
            slot.era?.dependencies.releaseAll();
            slot.era = null;
            slot.refs = 0;
        }
        this.byName_.clear();
    }

    /** Drop one claim on the slot `name` resolves to, without its receipt. The
     *  compatibility door for a caller that only ever had a path. */
    releaseByName(kind: RegistryAssetKind<unknown>, name: string): boolean {
        const slot = this.byName_.get(name);
        if (!slot || slot.refs === 0) return false;
        this.drop_(kind, slot);
        return true;
    }

    private lease_<T>(kind: RegistryAssetKind<T>, slot: Slot<T>): RegistrySlotLease<T> {
        slot.refs++;
        let spent = false;
        const lease: RegistrySlotLease<T> = {
            key: slot.key,
            generation: slot.id,
            value: slot.era!.value,
            names: slot.names,
            release: () => {
                if (spent) return;
                spent = true;
                this.drop_(kind as RegistryAssetKind<unknown>, slot as Slot<unknown>);
            },
            retain: () => (this.byName_.get(slot.key) === (slot as Slot<unknown>) && slot.era
                ? this.lease_(kind, slot)
                : null),
        };
        return lease;
    }

    private drop_(kind: RegistryAssetKind<unknown>, slot: Slot<unknown>): void {
        if (--slot.refs > 0) return;
        kind.unpublish(slot.names, slot.era?.published);
        slot.era?.dependencies.releaseAll();
        slot.era = null;
        this.forget_(slot);
    }

    private slotFor_(key: string): Slot<unknown> {
        let slot = this.byName_.get(key);
        if (!slot) {
            slot = new Slot<unknown>(key, this.nextId_++);
            this.byName_.set(key, slot);
        }
        return slot;
    }

    /** Index another lookup name onto this slot, and publish under it too. */
    private name_(slot: Slot<unknown>, name: string): void {
        if (this.byName_.get(name) === slot) return;
        slot.names.push(name);
        this.byName_.set(name, slot);
    }

    private forget_(slot: Slot<unknown>): void {
        for (const [name, held] of [...this.byName_]) {
            if (held === slot) this.byName_.delete(name);
        }
    }
}
