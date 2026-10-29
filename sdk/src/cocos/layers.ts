// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/layers.ts
 * @brief   `Layers`: the layer bitmask names (`Layers.Enum.UI_2D`), with Cocos's numbers.
 *
 * A node's `layer` is carried as the number a script set; the engine does not cull by it. The numbers matter because scripts
 * compare and combine them (`node.layer & Layers.Enum.UI_2D`).
 */
const Enum = {
    NONE: 0,
    IGNORE_RAYCAST: 1 << 20,
    GIZMOS: 1 << 21,
    EDITOR: 1 << 22,
    UI_3D: 1 << 23,
    SCENE_GIZMO: 1 << 24,
    UI_2D: 1 << 25,
    PROFILER: 1 << 28,
    DEFAULT: 1 << 30,
    ALL: 0xffffffff,
} as Record<string, number>;

const names = new Map<string, number>(Object.entries(Enum));
const bits = new Map<number, string>(Object.entries(Enum).map(([k, v]) => [v, k]));

export const Layers = {
    Enum,
    BitMask: Enum,
    /** The mask of a layer's name, or undefined when there is none. */
    nameToLayer(name: string): number | undefined { return names.get(name); },
    layerToName(layer: number): string | undefined { return bits.get(layer); },
    /** Name a user layer (bit 0..19). */
    addLayer(name: string, bitNum: number): void {
        if (bitNum < 0 || bitNum > 19 || names.has(name)) return;
        const value = 1 << bitNum;
        Enum[name] = value;
        names.set(name, value);
        bits.set(value, name);
    },
    deleteLayer(bitNum: number): void {
        const value = 1 << bitNum;
        const name = bits.get(value);
        if (name === undefined) return;
        delete Enum[name];
        names.delete(name);
        bits.delete(value);
    },
    /** A mask with the given layer names set. */
    makeMaskInclude(includes: number[]): number { return includes.reduce((a, b) => a | b, 0); },
    /** A mask with everything but the given layers set. */
    makeMaskExclude(excludes: number[]): number { return ~excludes.reduce((a, b) => a | b, 0); },
    check(layer: number, mask: number): boolean { return (layer & mask) !== 0; },
};
