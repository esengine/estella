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
 *
 *          A lookup identity is (asset TYPE, logical name). Bare names would
 *          have two kinds of asset sharing one entry the moment a project's own
 *          registry-backed type answered to a name an engine one already used —
 *          today that is only prevented by the file extensions differing.
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

/** How one kind of registry-backed asset is prepared. Publishing is the slot's:
 *  it holds the era and answers the lookup, so there is nowhere else to write. */
export interface RegistryAssetKind<T> {
    prepare(path: string): Promise<RegistryEra<T>>;
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

    constructor(readonly type: string, readonly key: string, readonly id: number) {}
}

/**
 * Every registry-backed asset this Assets has published, by every name that
 * resolves to it.
 */
/** One lookup identity. `\0` cannot occur in a path or a ref. */
function lookupKey(type: string, name: string): string {
    return `${type}\0${name}`;
}

export class RegistryAssetSlots {
    /** By (type, name) — see the note on lookup identity above. */
    private byName_ = new Map<string, Slot<unknown>>();
    private nextId_ = 1;

    /**
     * A claim on the slot `key` identifies, publishing its first era if there is
     * none. `names` are what the registry answers to — the load path and every
     * ref a component may spell it as, all resolving to the SAME slot rather
     * than to a copy of the object.
     */
    async acquire<T>(
        kind: RegistryAssetKind<T>, type: string, key: string, names: readonly string[],
    ): Promise<RegistrySlotLease<T>> {
        const slot = this.slotFor_(type, key) as Slot<T>;
        for (const name of names) this.name_(slot as Slot<unknown>, type, name);

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
    async republish<T>(kind: RegistryAssetKind<T>, type: string, name: string): Promise<boolean> {
        const slot = this.byName_.get(lookupKey(type, name)) as Slot<T> | undefined;
        if (!slot?.era) return false;
        const era = await kind.prepare(slot.key);
        const previous = slot.era;
        slot.era = era;
        // Its dependencies only: what the name resolves to is the slot's, and
        // the era above already holds it.
        previous.dependencies.releaseAll();
        return true;
    }

    /** Whether this name is one a slot of this type answers to. */
    has(type: string, name: string): boolean {
        return this.byName_.has(lookupKey(type, name));
    }

    /**
     * What this realm publishes for (type, name) right now — the answer a
     * runtime lookup reads, and the only copy of it.
     */
    published(type: string, name: string): unknown {
        return this.byName_.get(lookupKey(type, name))?.era?.published;
    }

    /** Everything published of one type. What a schedule analysis reads to learn
     *  what the loaded graphs of this realm reach for. */
    publishedOf(type: string): unknown[] {
        const out: unknown[] = [];
        for (const slot of new Set(this.byName_.values())) {
            if (slot.type === type && slot.era) out.push(slot.era.published);
        }
        return out;
    }

    /** Live slots — one per asset, however many names it answers to. */
    get size(): number {
        return new Set(this.byName_.values()).size;
    }

    /** Give up every slot. For a wholesale teardown. */
    releaseAll(): void {
        for (const slot of new Set(this.byName_.values())) {
            slot.era?.dependencies.releaseAll();
            slot.era = null;
            slot.refs = 0;
        }
        this.byName_.clear();
    }

    /** Drop one claim on the slot `name` resolves to, without its receipt. The
     *  compatibility door for a caller that only ever had a path. */
    releaseByName(type: string, name: string): boolean {
        const slot = this.byName_.get(lookupKey(type, name));
        if (!slot || slot.refs === 0) return false;
        this.drop_(slot);
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
                this.drop_(slot as Slot<unknown>);
            },
            retain: () => (this.byName_.get(lookupKey(slot.type, slot.key)) === (slot as Slot<unknown>) && slot.era
                ? this.lease_(kind, slot)
                : null),
        };
        return lease;
    }

    private drop_(slot: Slot<unknown>): void {
        if (--slot.refs > 0) return;
        slot.era?.dependencies.releaseAll();
        slot.era = null;
        this.forget_(slot);
    }

    private slotFor_(type: string, key: string): Slot<unknown> {
        const id = lookupKey(type, key);
        let slot = this.byName_.get(id);
        if (!slot) {
            slot = new Slot<unknown>(type, key, this.nextId_++);
            this.byName_.set(id, slot);
        }
        return slot;
    }

    /**
     * Index another lookup name onto this slot, and publish under it too.
     *
     * The dedupe is on the NAME list, not on the index: the slot's own key is
     * already indexed when it is created, and reading that back as "already
     * known" left the list — which is what gets published — empty.
     */
    private name_(slot: Slot<unknown>, type: string, name: string): void {
        if (!slot.names.includes(name)) slot.names.push(name);
        this.byName_.set(lookupKey(type, name), slot);
    }

    private forget_(slot: Slot<unknown>): void {
        for (const [name, held] of [...this.byName_]) {
            if (held === slot) this.byName_.delete(name);
        }
    }
}
