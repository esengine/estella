/**
 * @file    entity-generation.test.ts
 * @brief   Verify Entity packing helpers and World's stale-handle detection.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/world';
import {
    ENTITY_GEN_BITS,
    ENTITY_INDEX_BITS,
    ENTITY_INDEX_MASK,
    entityGeneration,
    entityIndex,
    isValidEntity,
    makeEntity,
    INVALID_ENTITY,
} from '../src/types';

describe('Entity packing', () => {
    it('round-trips index/generation through makeEntity', () => {
        const e = makeEntity(12345, 7);
        expect(entityIndex(e)).toBe(12345);
        expect(entityGeneration(e)).toBe(7);
    });

    it('uses the documented 20/12 bit layout', () => {
        expect(ENTITY_INDEX_BITS).toBe(20);
        expect(ENTITY_GEN_BITS).toBe(12);
        expect(ENTITY_INDEX_MASK).toBe(0xFFFFF);
    });

    it('masks out-of-range index/generation to their documented widths', () => {
        const e = makeEntity(0xFFFFFFFF, 0xFFFFFFFF);
        expect(entityIndex(e)).toBe(0xFFFFF);
        expect(entityGeneration(e)).toBe(0xFFF);
    });

    it('treats both sentinels as invalid', () => {
        expect(isValidEntity(INVALID_ENTITY)).toBe(false);
        expect(isValidEntity(0xFFFFFFFF)).toBe(false);
        expect(isValidEntity(makeEntity(1, 0))).toBe(true);
    });
});

describe('World stale-handle detection (pure-JS mode)', () => {
    it('valid() distinguishes live from despawned handles', () => {
        const world = new World();
        const a = world.spawn();
        expect(world.valid(a)).toBe(true);
        world.despawn(a);
        expect(world.valid(a)).toBe(false);
    });

    it('isStale() returns false for a live handle', () => {
        const world = new World();
        const a = world.spawn();
        expect(world.isStale(a)).toBe(false);
    });

    it('isStale() returns false for a never-existed handle (not same as stale)', () => {
        const world = new World();
        const neverSpawned = makeEntity(999_999, 0);
        expect(world.valid(neverSpawned)).toBe(false);
        expect(world.isStale(neverSpawned)).toBe(false);
    });

    it('pure-JS spawns pack generation=0 into the layout', () => {
        const world = new World();
        const a = world.spawn();
        // Pure-JS mode does not recycle indices yet, so every spawn is gen=0.
        expect(entityGeneration(a)).toBe(0);
        expect(entityIndex(a)).toBeGreaterThan(0);
    });
});
