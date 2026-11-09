// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plants.ts
 * @brief   The kinds of plant a world's recipes name, made into the kinds a `PlacedFoliage` grows: one kind a plant in each colouring it has.
 *
 * @details A plant with `tints` is as many kinds as it has tints (its parts' colour multiplied by each), and a place takes one of them by a slow
 *          noise, so a wood has warm and cool stands and never a speckle. A plant without is one kind.
 */
import type { PlacedKind, PlantKind } from '../foliage/plantKind';
import { fbm, hashString } from './fields';

/** A rules' plants as kinds, and which kind a plant at a place is. */
export interface PlantSet {
    kinds: PlacedKind[];
    /** The index of the kind that the plant `name` is at world (x, z); -1 for a name the set does not have. */
    kindAt(name: string, x: number, z: number): number;
    /** How far the plant `name` is sunk into the ground. */
    sinkOf(name: string): number;
    /** World units to a unit of the plant `name`'s mesh. */
    unitOf(name: string): number;
    /** The furthest any kind is wanted: where the far versions end. */
    reach: number;
    /** The least distance a far version is shown over (from what its kind draws to how far it goes): a far cell is as wide as that allows. 0 where none has one. */
    span: number;
}

export function expandPlants(plants: Readonly<Record<string, PlantKind>>): PlantSet {
    const kinds: PlacedKind[] = [];
    const slots = new Map<string, { first: number; count: number; scale: number; seed: number; sink: number; unit: number }>();
    let reach = 0, span = 0;
    for (const [name, p] of Object.entries(plants)) {
        const tints = p.tints && p.tints.length > 0 ? p.tints : [[1, 1, 1] as [number, number, number]];
        const first = kinds.length;
        for (const t of tints) {
            const tint = (part: PlacedKind['parts'][number]): PlacedKind['parts'][number] => ({ ...part, tint: [part.tint[0] * t[0], part.tint[1] * t[1], part.tint[2] * t[2], part.tint[3]] });
            kinds.push({ parts: p.parts.map(tint), lodDistance: p.lodDistance, ...(p.lod2Distance === undefined ? {} : { lod2Distance: p.lod2Distance }), drawDistance: p.drawDistance, far: p.far.map(tint), farDistance: p.farDistance, ...(p.farKeep === undefined ? {} : { farKeep: p.farKeep }), ...(p.interaction ? { interaction: p.interaction } : {}) });
        }
        slots.set(name, { first, count: tints.length, scale: p.tintScale ?? 1300, seed: hashString(name), sink: p.sink ?? 0, unit: p.unit ?? 1 });
        reach = Math.max(reach, p.drawDistance, p.far.length > 0 ? p.farDistance : 0);
        if (p.far.length > 0 && p.farDistance > p.drawDistance) span = span > 0 ? Math.min(span, p.farDistance - p.drawDistance) : p.farDistance - p.drawDistance;
    }
    // A kind a plant turns into is named in the rules, and is a place in the list only now it has been made.
    const indexOf = (kind: number | string | undefined): number | string | undefined => (typeof kind === 'string' ? slots.get(kind)?.first : kind);
    for (const k of kinds) {
        if (k.interaction) k.interaction = { ...k.interaction, felledKind: indexOf(k.interaction.felledKind), harvestedKind: indexOf(k.interaction.harvestedKind) };
    }
    return {
        kinds, reach, span,
        kindAt(name, x, z) {
            const s = slots.get(name);
            if (!s) return -1;
            return s.count === 1 ? s.first : s.first + Math.min(s.count - 1, Math.floor(fbm(x / s.scale, z / s.scale, s.seed, 1) * s.count));
        },
        sinkOf: (name) => slots.get(name)?.sink ?? 0,
        unitOf: (name) => slots.get(name)?.unit ?? 1,
    };
}
