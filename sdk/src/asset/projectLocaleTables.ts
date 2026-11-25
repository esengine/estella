// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { localeCatalogsFor, type LocaleTableAsset, type LocalizationAPI } from '../i18n/Localization';
import { log } from '../util/logger';
import { AssetScope, type AssetLease } from './AssetLease';

interface TableSource {
    identity(ref: string): string;
    path(ref: string): string;
    acquire(ref: string): Promise<AssetLease>;
    table(id: string): LocaleTableAsset | undefined;
}

interface Pin { ready: Promise<void>; lease?: AssetLease }

function reportFailure(ref: string, error: unknown): void {
    log.error('i18n', `locale table ${ref} failed to load: ${error instanceof Error ? error.message : String(error)}`);
}

/** A scene's decoded tables stay with its preparation until entity and asset ownership transfers. @internal */
export interface PreparedProjectLocaleTables {
    publishAfter(handoff: () => void, service: () => LocalizationAPI, configured: () => readonly string[],
        assertPublishing: () => void): Promise<LocalizationAPI>;
}

/** The current project catalog and its app-owned receipts. Speculative scenes own their own reads. */
export class ProjectLocaleTables {
    private service?: LocalizationAPI;
    private discovered: readonly string[] = [];
    private readonly pins = new Map<string, Pin>();

    constructor(private readonly owner: object, private readonly scope: AssetScope, private readonly source: TableSource) {}

    clear(): void {
        this.pins.clear();
        this.discovered = [];
        if (this.service) localeCatalogsFor(this.service).clearProject(this.owner);
        this.service = undefined;
    }

    private ordered(configured: readonly string[], discovered: readonly string[]): Map<string, string> {
        const found = discovered.map(ref => ({ ref, path: this.source.path(ref) }));
        found.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const refs = new Map(found.map(({ ref }) => [this.source.identity(ref), ref]));
        for (const ref of configured) {
            const id = this.source.identity(ref);
            refs.delete(id);
            refs.set(id, ref);
        }
        return refs;
    }

    private select(service: LocalizationAPI, refs: ReadonlyMap<string, string>, discovered: readonly string[]): void {
        if (this.service && this.service !== service) localeCatalogsFor(this.service).clearProject(this.owner);
        this.service = service;
        this.discovered = discovered;
        localeCatalogsFor(service).setProject(this.owner, [...refs.keys()]);
        for (const [id, pin] of this.pins) {
            if (refs.has(id)) continue;
            this.pins.delete(id);
            if (pin.lease && this.scope.forget(pin.lease)) pin.lease.release();
        }
    }

    private expose(service: LocalizationAPI, id: string): void {
        const table = this.source.table(id);
        if (table) localeCatalogsFor(service).usePublished(this.owner, id, table);
    }

    private pin(id: string, ref: string): Promise<void> {
        const existing = this.pins.get(id);
        if (existing) return existing.ready;
        const pin: Pin = { ready: Promise.resolve().then(async () => {
            if (this.pins.get(id) !== pin) return;
            let lease: AssetLease;
            try { lease = await this.source.acquire(ref); }
            catch (error) {
                if (this.pins.get(id) === pin) {
                    this.pins.delete(id);
                    reportFailure(ref, error);
                }
                return;
            }
            if (this.pins.get(id) !== pin) { lease.release(); return; }
            pin.lease = this.scope.add(lease);
            if (this.service) this.expose(this.service, id);
        }) };
        this.pins.set(id, pin);
        return pin.ready;
    }

    async install(service: LocalizationAPI, configured: readonly string[], discovered = this.discovered): Promise<void> {
        const refs = this.ordered(configured, discovered);
        this.select(service, refs, [...discovered]);
        await Promise.all([...refs].map(([id, ref]) => {
            this.expose(service, id);
            return this.pin(id, ref);
        }));
    }

    async prepare(configured: readonly string[], discovered: readonly string[], scene: AssetScope,
        check: () => void): Promise<PreparedProjectLocaleTables> {
        const paths = [...discovered], refs = this.ordered(configured, paths);
        const leases = new Map<string, AssetLease>();
        const stage = async (id: string, ref: string, validate: () => void) => {
            let lease: AssetLease;
            try { lease = await this.source.acquire(ref); }
            catch (error) { validate(); reportFailure(ref, error); return; }
            try { validate(); }
            catch (error) { lease.release(); throw error; }
            leases.set(id, scene.add(lease));
        };
        await Promise.all([...refs].map(([id, ref]) => stage(id, ref, check)));
        check();
        return {
            publishAfter: async (handoff, getService, getConfigured, assertPublishing) => {
                const validate = () => { check(); assertPublishing(); };
                validate();
                // The game can install a plugin while a scene is waiting. Finish its extra reads
                // under scene ownership, before transferring any entities or changing the catalog.
                let active = this.ordered(getConfigured(), paths);
                for (;;) {
                    const added = [...active].filter(([id]) => !refs.has(id));
                    if (!added.length) break;
                    await Promise.all(added.map(([id, ref]) => {
                        refs.set(id, ref);
                        return stage(id, ref, validate);
                    }));
                    validate();
                    active = this.ordered(getConfigured(), paths);
                }
                // The handoff moves or releases the whole scene scope. Hold its table receipts
                // separately until it succeeds, including when a scene owner rejects the transfer.
                const held = new AssetScope();
                try {
                    for (const lease of leases.values()) {
                        if (!scene.forget(lease)) throw new Error('Prepared translations have already been released');
                        held.add(lease);
                    }
                    handoff();
                    validate();
                    const service = getService();
                    this.select(service, active, paths);
                    for (const id of active.keys()) {
                        const lease = leases.get(id);
                        if (lease && !this.pins.get(id)?.lease) {
                            held.forget(lease);
                            this.pins.set(id, { ready: Promise.resolve(), lease: this.scope.add(lease) });
                        }
                        this.expose(service, id);
                    }
                    return service;
                } finally { held.releaseAll(); }
            },
        };
    }
}
