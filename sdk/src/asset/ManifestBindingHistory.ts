// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetRefGeneration, AssetRefLedger } from './AssetRefLedger';
import { assetPairKey } from './assetPairKey';
import type { PreparedLoad } from './dependencies';
import type { AssetChange } from './hotUpdate';
import { boundValueIn } from './leaseBindings';
import { sceneBindingProfile } from './manifestBinding';

/** A manifest record can disappear while a field still owns the generation it received. */
export class ManifestBindingHistory {
    private readonly records_ = new WeakMap<AssetRefGeneration<unknown>, Set<string>>();

    remember(type: string, key: string, generations: readonly AssetRefGeneration<unknown>[]): void {
        const record = assetPairKey(type, key);
        for (const generation of generations) {
            if (generation.superseded) continue;
            const records = this.records_.get(generation);
            if (records) records.add(record);
            else this.records_.set(generation, new Set([record]));
        }
    }

    /** Consult the live ledgers. A released handle can already belong to another asset. */
    heldValues(changes: readonly AssetChange[], textures: AssetRefLedger<number>, prepared: AssetRefLedger<PreparedLoad<unknown>>) {
        const values = new Map<string, Map<number | string, { value: unknown; profile?: string }>>();
        if (!changes.length || (!textures.size && !prepared.size)) return values;
        const wanted = new Map(changes.map(c => [assetPairKey(c.type, c.key), c.key]));
        const collect = (generation: AssetRefGeneration<unknown>, value: unknown, binding: string): void => {
            const records = this.records_.get(generation);
            if (!records) return;
            const handle = boundValueIn(value);
            if (!handle || (typeof handle !== 'number' && typeof handle !== 'string')) return;
            for (const record of records) {
                const key = wanted.get(record);
                if (key === undefined) continue;
                const held = values.get(key);
                const entry = { value, profile: sceneBindingProfile(binding) };
                if (held) held.set(handle, entry);
                else values.set(key, new Map([[handle, entry]]));
            }
        };
        for (const [key, rows] of textures.entries()) {
            for (const row of rows) collect(row, row.value, key.slice(0, -2));
        }
        for (const rows of prepared.entries().values()) {
            for (const row of rows) {
                if (row.value.loader.fieldBinding !== 'source') collect(row, row.value.value, row.value.owner.key);
            }
        }
        return values;
    }
}
