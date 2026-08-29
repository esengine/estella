// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-runtime-binding.test.ts
 * @brief   Binding an entity to a spine runtime is a transaction with one
 *          authority, exactly as preparing the asset it plays is.
 *
 * @details Two rules, and both are about what happens when a binding is
 *          REPLACED: at any observable point one entity is posed by at most one
 *          runtime, and a replacement that fails leaves the entity playing what
 *          it was playing. A destroy-first reload with no owner above the
 *          version backends can honour neither.
 */
import { describe, it, expect, vi } from 'vitest';
import { SpineManager, type SpineVersion } from '../src/spine/SpineManager';
import type { SpineModuleFactory } from '../src/spine/SpineModuleLoader';
import type { Entity } from '../src/types';
import { fakeSpineModule, fakeSpineEra, type FakeSpineModule } from './helpers/fakeSpineModule';

/** A skeleton document that reports `version`, in the shape detection reads. */
function skeletonOf(version: string): string {
    return JSON.stringify({ skeleton: { spine: version } });
}

/** A manager over two faked runtimes, and the state each of them holds. */
function managerWithVersions() {
    const runtimes: Record<'4.1' | '4.2', FakeSpineModule> = {
        '4.1': fakeSpineModule(),
        '4.2': fakeSpineModule(),
    };
    const factories = new Map<SpineVersion, SpineModuleFactory>([
        ['4.1', (async () => runtimes['4.1'].module) as never],
        ['4.2', (async () => runtimes['4.2'].module) as never],
    ]);
    return { manager: new SpineManager({} as never, factories), runtimes };
}

const REGISTRY = {} as never;

async function bind(
    manager: SpineManager, entity: Entity, version: string, era: string,
): Promise<SpineVersion | null> {
    return manager.loadEntity(entity, fakeSpineEra(era, skeletonOf(version)), REGISTRY);
}

describe('one entity is posed by at most one runtime', () => {
    it('moving to another spine version leaves nothing behind in the old one', async () => {
        // The runtime it moves TO can only remove its own entities, and the one
        // it came from is never told: what stays there is posed and submitted
        // every frame, and no despawn ever reaches it.
        const { manager, runtimes } = managerWithVersions();
        const entity = 7 as Entity;

        expect(await bind(manager, entity, '4.1', 'hero#1')).toBe('4.1');
        expect(runtimes['4.1'].instances).toHaveLength(1);

        expect(await bind(manager, entity, '4.2', 'hero#2')).toBe('4.2');

        expect(runtimes['4.1'].instances, 'the instance the old runtime kept posing').toEqual([]);
        expect(runtimes['4.1'].skeletons, 'the skeleton nobody could unload').toEqual([]);
        expect(runtimes['4.2'].instances).toHaveLength(1);
    });

    it('a despawn after a version change reaches every runtime that had it', async () => {
        const { manager, runtimes } = managerWithVersions();
        const entity = 7 as Entity;
        await bind(manager, entity, '4.1', 'hero#1');
        await bind(manager, entity, '4.2', 'hero#2');

        manager.removeEntity(entity);

        expect(runtimes['4.1'].instances).toEqual([]);
        expect(runtimes['4.2'].instances).toEqual([]);
        expect([...manager.boundEntities()]).toEqual([]);
    });
});

describe('replacing a binding is commit-after-success', () => {
    it('a reload whose skeleton will not parse leaves the entity playing', async () => {
        // Preparing an asset already works this way: a failed preparation leaves
        // the era that is published alone. A runtime binding that destroys first
        // has already thrown away what it was going to fall back to.
        const { manager, runtimes } = managerWithVersions();
        const entity = 7 as Entity;
        await bind(manager, entity, '4.2', 'hero#1');
        const posing = [...runtimes['4.2'].instances];

        runtimes['4.2'].parses = false;
        expect(await bind(manager, entity, '4.2', 'hero#2')).toBeNull();

        expect(runtimes['4.2'].instances, 'the entity stopped playing').toEqual(posing);
        expect(runtimes['4.2'].skeletons, 'the era it was posing was retired').toHaveLength(1);
        expect(manager.getEntityVersion(entity)).toBe('4.2');
    });

    it('a failed move to another version stays on the one that works', async () => {
        const { manager, runtimes } = managerWithVersions();
        const entity = 7 as Entity;
        await bind(manager, entity, '4.1', 'hero#1');
        const posing = [...runtimes['4.1'].instances];

        runtimes['4.2'].parses = false;
        expect(await bind(manager, entity, '4.2', 'hero#2')).toBeNull();

        expect(runtimes['4.1'].instances, 'the entity was left with no runtime at all').toEqual(posing);
        expect(runtimes['4.2'].instances, 'half a binding in the runtime that failed').toEqual([]);
        expect(runtimes['4.2'].skeletons).toEqual([]);
        expect(manager.getEntityVersion(entity)).toBe('4.1');
    });

    it('the frame pass poses it once, from one runtime', async () => {
        const { manager, runtimes } = managerWithVersions();
        const entity = 7 as Entity;
        await bind(manager, entity, '4.1', 'hero#1');
        await bind(manager, entity, '4.2', 'hero#2');

        manager.updateAnimations(1 / 60);

        expect(runtimes['4.1'].instances.length + runtimes['4.2'].instances.length,
               'two runtimes each posing their own copy of one entity').toBe(1);
    });
});
