// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** The nearest node that is not Auto decides: None lets the pointer through, Receive takes it back. */
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '../src/ecs/world';
import type { ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import { Parent } from '../src/ecs/component';
import { UINode, UIPointerEvents } from '../src/ui/core/ui-node';
import { isPointerBlockedInTree } from '../src/ui/util/helpers';
import type { Entity } from '../src/types';

function node(world: World, pointerEvents: number, parent?: Entity): Entity {
    const e = world.spawn();
    world.insert(e, UINode, { pointerEvents } as never);
    if (parent !== undefined) world.insert(e, Parent, { entity: parent });
    return e;
}

describe.skipIf(!HAS_WASM)('isPointerBlockedInTree', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('follows the nearest decided node', () => {
        const world = new World();
        const registry = new module.Registry();
        world.connectCpp(registry as never, module);
        const overlay = node(world, UIPointerEvents.None);
        const label = node(world, UIPointerEvents.Auto, overlay);
        const close = node(world, UIPointerEvents.Receive, overlay);
        const icon = node(world, UIPointerEvents.Auto, close);
        const inner = node(world, UIPointerEvents.None, close);
        expect(isPointerBlockedInTree(world, overlay)).toBe(true);
        expect(isPointerBlockedInTree(world, label)).toBe(true);
        expect(isPointerBlockedInTree(world, close)).toBe(false);
        expect(isPointerBlockedInTree(world, icon)).toBe(false);
        expect(isPointerBlockedInTree(world, inner)).toBe(true);
        expect(isPointerBlockedInTree(world, node(world, UIPointerEvents.Auto))).toBe(false);
        world.disconnectCpp(); registry.delete();
    });
});
