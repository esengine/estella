// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    skeletal-submit.test.ts
 * @brief   What reaches the engine when a skeletal runtime hands over a pose.
 *
 *          One door serves Spine and DragonBones alike, so a field dropped on
 *          the way through is dropped for both. The material is the one that has
 *          to be read per entity and per frame — a skeleton is not asked which
 *          material it was posed with, its entity is.
 */
import { describe, it, expect, vi } from 'vitest';
import { submitEntityMeshes, type SkeletalSubmitCore } from '../src/skeletal/submitMeshes';
import type { Entity } from '../src/types';

const PROPS = { skeletonScale: 1, flipX: false, flipY: false, layer: 0 };

/** A core that records every submit, with a heap big enough for the copies. */
function mockCore() {
    const submits: number[][] = [];
    let next = 64;
    const core: SkeletalSubmitCore = {
        renderer_submitSkeletalBatchByEntity: vi.fn((..._args: unknown[]) => {
            submits.push(_args.slice(1) as number[]);
        }) as unknown as SkeletalSubmitCore['renderer_submitSkeletalBatchByEntity'],
        _malloc: (size: number) => { const p = next; next += size; return p; },
        _free: () => {},
        HEAPU8: new Uint8Array(4096),
    };
    return { core, submits };
}

/** One batch of two vertices, in the 8-float layout the engine reads. */
const oneBatch = (cb: (v: Uint8Array, i: Uint8Array, vc: number, ic: number, tex: number, blend: number) => void) => {
    cb(new Uint8Array(new Float32Array(16).buffer), new Uint8Array(new Uint16Array([0, 1, 2]).buffer), 2, 3, 7, 1);
};

describe('handing a posed skeleton to the engine', () => {
    it('submits no material when the caller names none', () => {
        const { core, submits } = mockCore();
        expect(submitEntityMeshes(core, {}, 5 as Entity, PROPS, oneBatch)).toBe(true);
        expect(submits).toHaveLength(1);
        expect(submits[0]!.at(-1)).toBe(0);
    });

    it('carries the entity\'s material through to the batch', () => {
        const { core, submits } = mockCore();
        submitEntityMeshes(core, {}, 5 as Entity, PROPS, oneBatch, () => 42);
        expect(submits[0]!.at(-1)).toBe(42);
    });

    it('asks for the material of the entity being submitted', () => {
        const { core } = mockCore();
        const materialOf = vi.fn(() => 9);
        submitEntityMeshes(core, {}, 11 as Entity, PROPS, oneBatch, materialOf);
        expect(materialOf).toHaveBeenCalledWith(11);
    });

    it('reports a core that cannot take geometry, so the caller stops asking', () => {
        const { core } = mockCore();
        const noSubmit = { ...core, renderer_submitSkeletalBatchByEntity: undefined };
        expect(submitEntityMeshes(noSubmit, {}, 5 as Entity, PROPS, oneBatch)).toBe(false);
    });
});
