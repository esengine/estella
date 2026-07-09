// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';
import { defineResource } from '../resource';

/**
 * Per-app motion-trail API. Wraps the C++ registry-scoped trail system so two App
 * instances (e.g. editor tabs) drive independent trails without cross-talk.
 *
 * Consumed as a resource: declare `Res(Trail)` as a system param, or grab it with
 * `app.getResource(Trail)` outside ECS code.
 */
export class TrailAPI {
    private readonly module_: ESEngineModule;
    private readonly registry_: CppRegistry;

    constructor(module: ESEngineModule, registry: CppRegistry) {
        this.module_ = module;
        this.registry_ = registry;
    }

    /** Advance every trail: record points for moving emitters, age out old ones. */
    update(dt: number): void {
        this.module_.trail_update?.(this.registry_, dt);
    }

    /** Drop an entity's recorded history (the streak vanishes instantly). */
    clear(entity: Entity): void {
        this.module_.trail_clear?.(this.registry_, entity as number);
    }
}

/** Resource handle for the per-app trail API. */
export const Trail = defineResource<TrailAPI>(null!, 'Trail');
