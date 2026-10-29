// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every easing curve gives the same answer in C++ (the tween the engine runs itself) and in TypeScript (the value tween).
 *
 * The two implementations are ports of each other and share one enum; a curve added to one and not the other is a tween that
 * eases differently depending on which kind of field it animates. This runs the same tween both ways at several times and compares.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform } from '../src/ecs/component';
import { TweenAPI, TweenTarget } from '../src/animation/Tween';
import { EasingType, applyEasing } from '../src/animation/Easing';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

const CURVES: EasingType[] = Object.values(EasingType)
    .filter((v): v is EasingType => typeof v === 'number' && v !== EasingType.CubicBezier);

describe.skipIf(!HAS_WASM)('easing parity between C++ and TypeScript', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    it.each(CURVES.map((c) => [EasingType[c], c] as const))('%s', (_name, type) => {
        for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
            const api = new TweenAPI(engine, registry);
            const entity = world.spawn();
            world.insert(entity, Transform);
            api.to(entity, TweenTarget.PositionX, 0, 100, 1, { easing: type });
            api.update(t);
            const native = world.get(entity, Transform).position.x;
            expect(native, `${EasingType[type]} at ${t}`).toBeCloseTo(100 * applyEasing(type, t), 2);
        }
    });
});
