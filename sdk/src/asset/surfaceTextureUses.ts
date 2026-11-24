// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLease } from './AssetLease';
import { Material, isTextureRef } from '../render/material';

export type SurfaceUse = 'mesh' | 'full';
export type SurfaceAsset = 'texture' | 'material';
const surfaceClaim = Symbol('surface use');
type SurfaceReceipt = AssetLease & { [surfaceClaim]?: SurfaceClaim };

/** A declaration stays with its owner when its scalar field moves to a new generation. */
export function inheritSurfaceUse(previous: AssetLease | undefined, next: AssetLease): AssetLease {
    return (previous as SurfaceReceipt | undefined)?.[surfaceClaim]?.keep(next) ?? next;
}

/** Flattened uniforms include textures inherited from a material instance's parent. */
export function collectMaterialTextures(material: number, into: Set<number>): void {
    for (const uniform of Material.getUniforms(material).values()) {
        if (isTextureRef(uniform) && uniform.textureId > 0) into.add(uniform.textureId);
    }
}

/** A scene may begin loading before its rows exist. Keep its use through preparation and every retained receipt. */
export class SurfaceClaim {
    private holds_ = 1;
    constructor(private readonly end_: () => void) {}

    keep<T>(receipt: AssetLease<T>): AssetLease<T> {
        this.holds_++;
        let spent = false;
        // Preserve the provider's binding symbols and live getters, including registry aliases.
        return Object.create(receipt, {
            ...Object.getOwnPropertyDescriptors(receipt),
            [surfaceClaim]: { value: this },
            release: { enumerable: true, value: () => {
                if (spent) return;
                spent = true;
                try { receipt.release(); } finally { this.release(); }
            } },
            retain: { enumerable: true, value: () => {
                const next = !spent && receipt.retain();
                return next ? this.keep(next) : null;
            } },
        });
    }

    release(): void { if (--this.holds_ === 0) this.end_(); }
}

/** Size policy by logical asset, shared across aliases, remote roots and generations. */
export class SurfaceTextureUses {
    private readonly uses_ = new Map<string, { mesh: number; full: number }>();
    private readonly runtimeMeshes_ = new Set<string>();

    noteMesh(key: string): void { this.runtimeMeshes_.add(key); }

    use(key: string): SurfaceUse | undefined {
        const row = this.uses_.get(key);
        if (row?.full) return 'full';
        if (row?.mesh || this.runtimeMeshes_.has(key)) return 'mesh';
        return undefined;
    }

    claim(key: string, use: SurfaceUse): SurfaceClaim {
        let row = this.uses_.get(key);
        if (!row) this.uses_.set(key, row = { mesh: 0, full: 0 });
        const held = row;
        held[use]++;
        return new SurfaceClaim(() => {
            held[use]--;
            if (!held.mesh && !held.full && this.uses_.get(key) === held) this.uses_.delete(key);
        });
    }

    clear(): void { this.uses_.clear(); this.runtimeMeshes_.clear(); }
}
