// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Assets } from '../asset/Assets';
import type { AssetLease } from '../asset/AssetLease';
import type { GISidecars } from './giInstances';
import type { MeshGIRefs } from './meshGIAssets';
import type { MeshSdf } from './meshSdfFormat';
import type { MeshCards } from './cardFormat';

type Bake = { refs: MeshGIRefs; sources: string[]; leases: AssetLease[]; failed: boolean; value: GISidecars | null };

/** Holds each complete bake for as long as a placed mesh uses it, including across identical instances. */
export class MeshGIBakes {
    private readonly rows = new Map<string, Bake>();
    private readonly handles = new Map<number, string | null>();
    private readonly used = new Set<string>();
    private assets: Assets | null = null;
    private unsubscribe?: () => void;
    revision = 0;

    begin(assets: Assets): void {
        if (this.assets !== assets) {
            this.clear();
            this.assets = assets;
            this.unsubscribe = assets.onSourceChanged(path => {
                for (const [key, row] of this.rows) {
                    if (row.sources.includes(path) || path === assets.sourceIdentity(row.refs.sdf) || path === assets.sourceIdentity(row.refs.cards))
                        this.drop(key, row);
                }
            });
        }
        this.used.clear();
        this.handles.clear();
    }

    use(handle: number): string | null {
        if (this.handles.has(handle)) return this.handles.get(handle)!;
        const assets = this.assets!;
        const refs = assets.meshGIForHandle(handle);
        const key = refs ? JSON.stringify([refs.sdf, refs.cards]) : null;
        this.handles.set(handle, key);
        if (key && refs) {
            this.used.add(key);
            if (!this.rows.has(key)) {
                const row: Bake = { refs, sources: [assets.sourceIdentity(refs.sdf), assets.sourceIdentity(refs.cards)], leases: [], failed: false, value: null };
                this.rows.set(key, row);
                void this.load(assets, key, row);
            }
        }
        return key;
    }

    private async load(assets: Assets, key: string, row: Bake): Promise<void> {
        const hold = async <T>(type: string, ref: string): Promise<AssetLease<T> | null> => {
            const lease = await assets.acquireTyped<T>(type, ref);
            if (row.failed || this.rows.get(key) !== row) { lease.release(); return null; }
            row.leases.push(lease);
            return lease;
        };
        try {
            const [sdf, cards] = await Promise.all([
                hold<MeshSdf>('meshSdf', row.refs.sdf), hold<MeshCards>('meshCards', row.refs.cards),
            ]);
            if (sdf && cards && this.rows.get(key) === row) {
                row.value = { sdf: sdf.value, cards: cards.value };
                this.revision++;
            }
        } catch {
            // Keep the miss until an input changes. Return any half that has arrived, even if the other is still pending.
            row.failed = true;
            for (const lease of row.leases.splice(0)) lease.release();
        }
    }

    get(key: string): GISidecars | null { return this.rows.get(key)?.value ?? null; }

    end(): void {
        for (const [key, row] of this.rows) if (!this.used.has(key)) this.drop(key, row);
    }

    clear(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.assets = null;
        this.used.clear();
        this.handles.clear();
        for (const [key, row] of this.rows) this.drop(key, row);
    }

    private drop(key: string, row: Bake): void {
        this.rows.delete(key);
        if (row.value) this.revision++;
        for (const lease of row.leases.splice(0)) lease.release();
    }
}
