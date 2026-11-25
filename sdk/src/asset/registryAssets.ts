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
import { leaseBinding, leaseDependencies, leaseOwner, type BindingLease } from './leaseBindings';
import type { AssetLease, AssetScope } from './AssetLease';
import { AssetDependencyOwner, type AssetWithReceipts, type DependencyReceipt, type Preparation } from './dependencies';
import { disposeAll } from '../util/disposeAll';
import { reservePromise } from '../util/reservePromise';
import { log } from '../util/logger';
import { assetPairKey } from './assetPairKey';
import { sceneBindingBase, sceneImportBinding } from './manifestBinding';

const noNames: readonly string[] = Object.freeze([]);
const releaseEra = (era: Preparation | null): void => era?.dependencies.releaseAll();

/** What one preparation PRODUCED. What it took is recorded for it — see
 *  dependencies.ts — so an era cannot describe a dependency it does not have. */
export interface RegistryEra<T> {
    /** The runtime object a lookup returns while this era is the published one. */
    readonly published: unknown;
    /** The logical identity a holder keeps — the same across every era. */
    readonly value: T;
    /** Notify a derived index of the object replaced when this era wins publication. */
    didPublish?(previous?: unknown): void;
}

/** One era, with what its preparation took. */
export type PreparedEra<T> = RegistryEra<T> & Preparation;

/** How one kind of registry-backed asset is prepared. Publishing is the slot's:
 *  it holds the era and answers the lookup, so there is nowhere else to write. */
export interface RegistryAssetKind<T> {
    prepare(path: string, owner: AssetDependencyOwner): Promise<PreparedEra<T>>;
}

/** A holder's claim on a slot. Its `generation` names the SLOT, not an era —
 *  which era is current is the slot's business and changes under the holder. */
export interface RegistrySlotLease<T> extends BindingLease<T> {
    /** Every name that resolves to this slot: the load path and its aliases. */
    readonly names: readonly string[];
}

class Slot<T> extends AssetDependencyOwner {
    /** What a lookup asks for. Distinct from `key`, which is what an OWNER
     *  holds: a registry answers to a ref, not to an ownership identity. */
    readonly names: string[] = [];
    /** Spellings a scene will publish after it takes ownership of this sampler-specific slot. */
    sceneNames?: Set<string>;
    /** A scene alias or an owner-specific lookup made this slot observable to a runtime reader. */
    observed = false;
    /** An ordinary slot keeps this private address if another sampler takes its public name. */
    privateKey?: string;
    /** Live lookup used by invalidation, even when another slot takes the original name. */
    refreshName: string | undefined;
    /** Qualified keys currently routed here. Lease holders can observe the live names array. */
    readonly lookupKeys = new Set<string>();
    refs = 0;
    era: PreparedEra<T> | null = null;
    loading: Promise<void> | null = null;
    refreshWhileLoading: RegistryAssetKind<T> | null = null;
    waiters = 0;
    /** Which refresh is the current one. A preparation that started before the
     *  count moved is answering a question nobody is asking any more. */
    refresh = 0;
    constructor(type: string, key: string, readonly id: number) {
        super(type, key);
        this.refreshName = key;
    }

    get published(): unknown { return this.era?.published; }
}

/**
 * Every registry-backed asset this Assets has published, by every name that
 * resolves to it.
 */
export class RegistryAssetSlots {
    /** By (type, name) — see the note on lookup identity above. */
    private readonly byName_ = new Map<string, Slot<unknown>>();
    /** A held or loading slot can outlive the last name that still routes to it. */
    private readonly slots_ = new Set<Slot<unknown>>();
    /** Only documents with sampler-specific preparations need a source-to-versions index. */
    private readonly samplerVariants_ = new Map<string, Set<Slot<unknown>>>();
    private ownedNames_?: WeakMap<object, Map<string, { slot: Slot<unknown>; depth: number }>>;
    private readonly pathClaims_ = new Map<string, Map<Slot<unknown>, number>>();
    private nextId_ = 1;
    private versions_ = new Map<string, number>();

    /** Publication counter; failed preparations and additional holders do not change it. */
    version(type: string): number { return this.versions_.get(type) ?? 0; }

    private changed_(type: string): void {
        this.versions_.set(type, this.version(type) + 1);
    }

    /**
     * A claim on the slot `key` identifies, publishing its first era if there is
     * none. `names` are what the registry answers to — the load path and every
     * ref a component may spell it as, all resolving to the SAME slot rather
     * than to a copy of the object.
     */
    async acquire<T>(
        kind: RegistryAssetKind<T>, type: string, key: string, names: readonly string[], owner?: AssetDependencyOwner, sceneNames?: readonly string[],
    ): Promise<RegistrySlotLease<T>> {
        const slot = this.slotFor_(type, key) as Slot<T>;
        const unclaim = owner?.claim(slot);
        for (const name of names) this.name_(slot, name);
        if (sceneNames) {
            const declared = slot.sceneNames ??= new Set();
            for (const name of sceneNames) {
                if (!declared.has(name)) this.ownedNames_ = undefined;
                declared.add(name);
                if (!slot.names.includes(name)) slot.names.push(name);
            }
        }

        if (slot.era) return this.lease_(slot, unclaim);
        // Each caller reserves the slot until it has received its own lease or
        // rejected. Preparation and publication belong to the slot once.
        slot.waiters++;
        try {
            if (!slot.loading) {
                const pending = reservePromise<void>();
                slot.loading = pending.promise;
                pending.resolve(this.publishInitial_(kind, slot));
            }
            await slot.loading;
            if (!this.ownsPreparation_(slot, key)) {
                throw new Error(`"${key}" was released while it was loading; it has no owner. Load it again.`);
            }
            return this.lease_(slot, unclaim);
        } catch (error) {
            unclaim?.();
            throw error;
        } finally {
            if (--slot.waiters === 0) {
                slot.loading = null;
                slot.refreshWhileLoading = null;
                if (slot.refs === 0) this.retire_(slot);
            }
        }
    }

    private async publishInitial_<T>(kind: RegistryAssetKind<T>, slot: Slot<T>): Promise<void> {
        while (this.ownsPreparation_(slot)) {
            const ticket = slot.refresh;
            let era: PreparedEra<T>;
            try { era = await (slot.refreshWhileLoading ?? kind).prepare(slot.privateKey ?? slot.key, slot); }
            catch (error) {
                if (ticket === slot.refresh || !this.ownsPreparation_(slot)) throw error;
                continue;
            }
            if (ticket === slot.refresh && this.ownsPreparation_(slot)) {
                this.publish_(slot, era);
                return;
            }
            releaseEra(era);
        }
        throw new Error(`"${slot.key}" was released while it was loading; it has no owner. Load it again.`);
    }

    /**
     * Replace the current era with a freshly prepared one, atomically.
     *
     * A failed prepare leaves the slot exactly as it was — holders keep working
     * with the era they have rather than losing it to a bad download. Answers
     * false when nothing holds this name, and when what came back is no longer
     * the answer to any live question.
     */
    async republish<T>(kind: RegistryAssetKind<T>, type: string, name: string): Promise<boolean> {
        const key = assetPairKey(type, name);
        const slot = this.byName_.get(key) as Slot<T> | undefined;
        if (!slot) return false;
        const ticket = ++slot.refresh;
        if (!slot.era) {
            if (!slot.loading) return false;
            // All cold waiters share the first publication. A change before
            // it lands must re-read the file before any waiter sees a value.
            slot.refreshWhileLoading = kind;
            await slot.loading;
            return ticket === slot.refresh && this.byName_.get(key) === slot;
        }
        const era = await kind.prepare(slot.privateKey ?? slot.key, slot);
        if (era.failedDependencies?.length) {
            era.dependencies.releaseAll();
            throw new Error(`Cannot refresh "${name}": dependencies did not load: ${era.failedDependencies.join(', ')}`);
        }
        // A newer refresh, a last release or a reassigned alias can supersede this request.
        if (ticket !== slot.refresh || !slot.era || this.byName_.get(key) !== slot) {
            era.dependencies.releaseAll();
            return false;
        }
        this.publish_(slot, era);
        return true;
    }

    private publish_<T>(slot: Slot<T>, era: PreparedEra<T>): void {
        const previous = slot.era;
        // A publication callback belongs to this commit only. A held slot need
        // not keep the resource it notified alive after that resource is replaced.
        slot.era = era.didPublish ? { ...era, didPublish: undefined } : era;
        this.ownedNames_ = undefined;
        if (slot.observed || this.visible_(slot)) this.changed_(slot.type);
        try { era.didPublish?.(previous?.published); }
        catch (error) { log.warn('asset', `publication listener for "${slot.key}" failed`, error); }
        releaseEra(previous);
    }

    /** Whether this name is one a slot of this type answers to. */
    has(type: string, name: string): boolean {
        return this.byName_.has(assetPairKey(type, name));
    }

    /** What the current era of (type, name) took — the graph, as a projection
     *  of acquisitions rather than a table anyone maintains. */
    dependenciesOf(type: string, name: string): readonly DependencyReceipt[] {
        return this.byName_.get(assetPairKey(type, name))?.era?.edges ?? [];
    }

    /** Every live era, by the key its slot is filed under. What a reverse walk
     *  reads: who depends on what is computed from the eras themselves. */
    eras(): AssetWithReceipts[] {
        const eras: AssetWithReceipts[] = [];
        for (const slot of this.slots_) {
            const path = slot.refreshName;
            if (slot.era && path !== undefined) eras.push({ type: slot.type, path, edges: slot.era.edges });
        }
        return eras;
    }

    /**
     * What this realm publishes for (type, name) right now — the answer a
     * runtime lookup reads, and the only copy of it.
     */
    published(type: string, name: string): unknown {
        return this.slot(type, name)?.published;
    }

    /** The same slot an engine-issued receipt identifies, including after a refresh. */
    slot(type: string, name: string): { readonly type: string; readonly key: string; readonly published: unknown } | undefined {
        return this.byName_.get(assetPairKey(type, name));
    }

    /** Sampler-specific names remain valid for a holder when another scene takes the public alias. */
    ownedSlot(scope: AssetScope, type: string, name: string): Slot<unknown> | undefined {
        if (!scope.size) return;
        const cache = this.ownedNames_ ??= new WeakMap();
        let names = cache.get(scope.receiptSet);
        if (!names) {
            names = this.indexHeldNames_(scope);
            cache.set(scope.receiptSet, names);
        }
        const slot = names.get(assetPairKey(type, name))?.slot;
        if (slot) slot.observed = true;
        return slot;
    }

    private indexHeldNames_(scope: AssetScope) {
        const names = new Map<string, { slot: Slot<unknown>; depth: number }>();
        this.visitHeldSlots_(scope.leases(), (slot, depth) => {
            for (const ref of slot.sceneNames ?? []) {
                const key = assetPairKey(slot.type, ref);
                const held = names.get(key);
                // A direct binding wins over a dependency. At equal depth prefer the public
                // alias if held, then the oldest slot regardless of preparation completion order.
                if (held) {
                    if (held.depth < depth) continue;
                    const current = this.byName_.get(key);
                    if (held.slot === current || (slot !== current && held.slot.id <= slot.id)) continue;
                }
                names.set(key, { slot, depth });
            }
        });
        return names;
    }

    /** Direct receipts first, then what their committed preparations own. A pending refresh has no say here. */
    private visitHeldSlots_(roots: readonly AssetLease[], visit: (slot: Slot<unknown>, depth: number) => void): void {
        const batches = [{ receipts: roots, depth: 0 }], seen = new Set<AssetScope>();
        for (const { receipts, depth } of batches) {
            for (const receipt of receipts) {
                const lease = receipt as Partial<BindingLease>;
                const owner = lease[leaseOwner];
                const slot = owner instanceof Slot && this.slots_.has(owner) ? owner : undefined;
                if (slot?.era) visit(slot, depth);
                const children = slot?.era?.dependencies ?? lease[leaseDependencies];
                if (!children?.size || seen.has(children)) continue;
                seen.add(children);
                batches.push({ receipts: children.leases(), depth: depth + 1 });
            }
        }
    }

    /** Everything published of one type. What a schedule analysis reads to learn
     *  what the loaded graphs of this realm reach for. */
    publishedOf(type: string): unknown[] {
        const out: unknown[] = [];
        for (const slot of new Set(this.byName_.values())) {
            if (slot.type === type && slot.era && this.visible_(slot)) out.push(slot.era.published);
        }
        return out;
    }

    /** Live slots — one per asset, however many names it answers to. */
    get size(): number {
        return this.slots_.size;
    }

    /** Stable addresses of the preparations to refresh when a logical document changes. */
    *refreshKeys(type: string, name: string, allSamplers: boolean): IterableIterator<string> {
        const source = assetPairKey(type, name);
        const current = this.byName_.get(source);
        if (current) yield current.refreshName ?? name;
        if (!allSamplers) return;
        for (const slot of this.samplerVariants_.get(source) ?? []) {
            if (slot !== current && slot.refreshName !== undefined) yield slot.refreshName;
        }
    }

    private indexVariant_(slot: Slot<unknown>, base: string): void {
        const source = assetPairKey(slot.type, base);
        let variants = this.samplerVariants_.get(source);
        if (!variants) this.samplerVariants_.set(source, variants = new Set());
        variants.add(slot);
    }

    /** Give up every slot. For a wholesale teardown. */
    releaseAll(): void {
        this.ownedNames_ = undefined;
        const eras: Array<Preparation | null> = [];
        for (const slot of this.slots_) {
            eras.push(slot.era);
            if (slot.era) this.changed_(slot.type);
            slot.era = null;
            slot.refs = 0;
            slot.lookupKeys.clear();
            slot.refreshName = undefined;
        }
        this.slots_.clear();
        this.samplerVariants_.clear();
        this.byName_.clear();
        this.pathClaims_.clear();
        disposeAll(eras, releaseEra);
    }

    /** A value-only load retains exactly the slot active when the caller asked for this logical name. */
    leaveByName(type: string, name: string, receipt: RegistrySlotLease<unknown>): void {
        const slot = receipt[leaseOwner];
        if (!(slot instanceof Slot) || !this.slots_.has(slot)) return;
        const key = assetPairKey(type, name);
        let claims = this.pathClaims_.get(key);
        if (!claims) this.pathClaims_.set(key, claims = new Map());
        claims.set(slot, (claims.get(slot) ?? 0) + 1);
    }

    private takePathSlot_(type: string, name: string): Slot<unknown> | undefined {
        const key = assetPairKey(type, name), claims = this.pathClaims_.get(key);
        const first = claims?.entries().next();
        if (!claims || !first || first.done) return;
        const [slot, count] = first.value;
        if (count === 1) claims.delete(slot);
        else claims.set(slot, count - 1);
        if (!claims.size) this.pathClaims_.delete(key);
        return slot;
    }

    private visible_(slot: Slot<unknown>): boolean {
        if (!slot.sceneNames) return true;
        for (const name of slot.sceneNames) if (slot.lookupKeys.has(assetPairKey(slot.type, name))) return true;
        return false;
    }

    private ownsPreparation_(slot: Slot<unknown>, requested = slot.key): boolean {
        return this.byName_.get(assetPairKey(slot.type, requested)) === slot
            || (requested === slot.key && !!slot.privateKey && this.slots_.has(slot));
    }

    /** Drop one claim on the slot `name` resolves to, without its receipt. The
     *  compatibility door for a caller that only ever had a path. */
    releaseByName(type: string, name: string): boolean {
        const slot = this.takePathSlot_(type, name) ?? this.byName_.get(assetPairKey(type, name));
        if (!slot || slot.refs === 0) return false;
        this.drop_(slot);
        return true;
    }

    /** Transfer one existing path-based claim to a receipt for the same published slot. */
    takeByName(type: string, name: string): RegistrySlotLease<unknown> | undefined {
        const slot = this.takePathSlot_(type, name) ?? this.byName_.get(assetPairKey(type, name));
        if (!slot?.era || !slot.refs) return undefined;
        const receipt = this.lease_(slot);
        this.drop_(slot);
        return receipt;
    }

    /** A scene makes only the named documents reachable from its own receipts visible. */
    publishSceneNames(receipts: readonly AssetLease[]): void {
        this.visitHeldSlots_(receipts, slot => {
            if (slot.sceneNames) this.publishNames_(slot, slot.sceneNames);
        });
    }

    private publishNames_(owner: Slot<unknown>, names: ReadonlySet<string>): void {
        owner.observed = true;
        for (const name of names) {
            const previous = this.byName_.get(assetPairKey(owner.type, name));
            if (previous === owner) continue;
            // A file first loaded with ordinary defaults can still be pending or owned.
            // Keep that slot addressable when the first scene-specific sampler takes its public name.
            if (previous && !previous.sceneNames && previous.key === name) {
                previous.sceneNames = new Set(previous.names);
                previous.observed = true;
                previous.privateKey = sceneImportBinding(previous.key, '[]');
                this.indexVariant_(previous, previous.key);
                this.name_(previous, previous.privateKey);
            }
            this.name_(owner, name);
            this.changed_(owner.type);
        }
    }

    private lease_<T>(slot: Slot<T>, unclaim?: () => void): RegistrySlotLease<T> {
        slot.refs++;
        let spent = false;
        const lease: RegistrySlotLease<T> = {
            [leaseBinding]: slot,
            [leaseOwner]: slot,
            key: slot.key,
            generation: slot.id,
            value: slot.era!.value,
            get failedDependencies() { return slot.era?.failedDependencies; },
            get names() { return slot.lookupKeys.size ? slot.names : noNames; },
            release: () => {
                if (spent) return;
                spent = true;
                unclaim?.();
                this.drop_(slot);
            },
            retain: () => slot.lookupKeys.size && slot.era ? this.lease_(slot) : null,
        };
        return lease;
    }

    private drop_(slot: Slot<unknown>): void {
        if (slot.refs === 0) return; // A wholesale release already retired it.
        if (--slot.refs === 0 && slot.waiters === 0) this.retire_(slot);
    }

    private retire_(slot: Slot<unknown>): void {
        if (!this.slots_.delete(slot)) return;
        const source = assetPairKey(slot.type, sceneBindingBase(slot.key));
        const variants = this.samplerVariants_.get(source);
        if (variants?.delete(slot) && !variants.size) this.samplerVariants_.delete(source);
        this.ownedNames_ = undefined;
        const visible = slot.observed || this.visible_(slot);
        for (const key of slot.lookupKeys) this.byName_.delete(key);
        slot.lookupKeys.clear();
        slot.refreshName = undefined;
        const era = slot.era;
        slot.era = null;
        if (era && visible) this.changed_(slot.type);
        releaseEra(era);
    }

    private slotFor_(type: string, key: string): Slot<unknown> {
        const id = assetPairKey(type, key);
        let slot = this.byName_.get(id);
        if (!slot) {
            slot = new Slot<unknown>(type, key, this.nextId_++);
            slot.lookupKeys.add(id);
            this.slots_.add(slot);
            this.byName_.set(id, slot);
            const base = sceneBindingBase(key);
            if (base !== key) this.indexVariant_(slot, base);
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
    private name_(slot: Slot<unknown>, name: string): void {
        const key = assetPairKey(slot.type, name);
        const previous = this.byName_.get(key);
        if (!slot.names.includes(name)) slot.names.push(name);
        if (slot.refreshName === undefined || name === (slot.privateKey ?? slot.key)) slot.refreshName = name;
        if (previous === slot) return;
        this.ownedNames_ = undefined;
        if (previous) {
            previous.lookupKeys.delete(key);
            const at = previous.names.indexOf(name);
            if (at >= 0) previous.names.splice(at, 1);
            if (previous.refreshName === name) {
                previous.refreshName = previous.names.find(ref => previous.lookupKeys.has(assetPairKey(previous.type, ref)));
            }
        }
        this.byName_.set(key, slot);
        slot.lookupKeys.add(key);
    }
}
