// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DPlugin.ts
 * @brief   Loads the 3D physics module and drives one world from the ECS.
 */
import type { App, Plugin } from '../app/app';
import { Schedule, defineSystem } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';
import {
    loadPhysics3DModule, type Physics3DModuleFactory, type Physics3DWasmModule,
} from './Physics3DModule';
import {
    stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG, type Physics3DConfig,
} from './Physics3DSystem';

/** The live module and the promise that resolves it, for a caller that must wait. */
export interface Physics3DRuntime {
    module: Physics3DWasmModule | null;
    initPromise: Promise<unknown> | null;
    /** Entity -> body id, so a scene teardown can drop the world's population. */
    bodies: Map<Entity, number>;
    /** Entity -> character id. Characters are not bodies and are kept apart. */
    characters: Map<Entity, number>;
}

export const Physics3DRuntime = defineResource<Physics3DRuntime>(
    { module: null, initPromise: null, bodies: new Map(), characters: new Map() },
    'Physics3DRuntime',
);

export class Physics3DPlugin implements Plugin {
    name = 'physics3d';
    private config_: Physics3DConfig;
    private wasmUrl_: string;
    private factory_?: Physics3DModuleFactory;
    private module_: Physics3DWasmModule | null = null;

    constructor(wasmUrl: string, config: Partial<Physics3DConfig> = {},
                factory?: Physics3DModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = { ...DEFAULT_PHYSICS3D_CONFIG, ...config };
    }

    build(app: App): void {
        const runtime: Physics3DRuntime = {
            module: null, initPromise: null, bodies: new Map(), characters: new Map(),
        };
        app.insertResource(Physics3DRuntime, runtime);
        app.subsystems?.transition?.('physics3d', 'initializing');

        const initPromise = loadPhysics3DModule(this.wasmUrl_, this.factory_).then((module) => {
            this.module_ = module;
            const { gravity, maxBodies } = this.config_;
            module._physics3d_init(gravity.x, gravity.y, gravity.z, maxBodies);
            runtime.module = module;
            app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
                stepPhysics3D(app, module, runtime.bodies, this.config_, runtime.characters);
            }));
            app.setFixedTimestep?.(this.config_.fixedTimestep);
            app.subsystems?.transition?.('physics3d', 'ready');
        });

        initPromise.catch((e: unknown) => {
            app.subsystems?.markError?.('physics3d',
                                        e instanceof Error ? e.message : String(e));
        });
        runtime.initPromise = initPromise;
    }

    /** Tear the world down, so a re-init does not inherit the last one's bodies. */
    cleanup(): void {
        this.module_?._physics3d_shutdown();
        this.module_ = null;
    }
}

export function physics3dPlugin(
    wasmUrl: string, config: Partial<Physics3DConfig> = {}, factory?: Physics3DModuleFactory,
): Physics3DPlugin {
    return new Physics3DPlugin(wasmUrl, config, factory);
}
