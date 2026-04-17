/**
 * @file    PhysicsPlugin.ts
 * @brief   Physics plugin — async wasm load + resource wiring
 *
 * Thin orchestration layer. Types live in `PhysicsTypes.ts`,
 * the Physics API class in `Physics.ts`, and the per-frame loop
 * + entity-tracking state in `PhysicsSystem.ts`. This file just
 * loads the wasm module, wires resources, and hands off to the
 * system layer.
 */

import type { Plugin, App } from '../app';
import {
    loadPhysicsModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
} from './PhysicsModuleLoader';
import { setupPhysicsDebugDraw } from './PhysicsDebugDraw';
import { PhysicsRuntime } from './PhysicsRuntime';
import { Physics, PhysicsAPI } from './Physics';
import { registerPhysicsSystem } from './PhysicsSystem';
import {
    PhysicsEvents,
    type PhysicsPluginConfig,
    type ResolvedPhysicsConfig,
} from './PhysicsTypes';
import { handleWasmError } from '../wasmError';

// Re-export the shapes consumers reach for via the plugin file so
// existing `import from './physics/PhysicsPlugin'` sites keep working.
export {
    PhysicsEvents,
    PhysicsAPI,
    Physics,
};
export type {
    PhysicsPluginConfig,
    PhysicsEventsData,
    CollisionEnterEvent,
    SensorEvent,
    RaycastHit,
    ShapeCastHit,
    MassData,
} from './PhysicsTypes';

// =============================================================================
// Config defaults
// =============================================================================

function resolveConfig(config: PhysicsPluginConfig): ResolvedPhysicsConfig {
    return {
        gravity: config.gravity ?? { x: 0, y: -9.81 },
        fixedTimestep: config.fixedTimestep ?? 1 / 30,
        subStepCount: config.subStepCount ?? 4,
        contactHertz: config.contactHertz ?? 30,
        contactDampingRatio: config.contactDampingRatio ?? 10,
        contactSpeed: config.contactSpeed ?? 3,
        collisionLayerMasks: config.collisionLayerMasks,
    };
}

// =============================================================================
// Plugin
// =============================================================================

export class PhysicsPlugin implements Plugin {
    name = 'physics';
    private config_: ResolvedPhysicsConfig;
    private wasmUrl_: string;
    private factory_?: PhysicsModuleFactory;

    constructor(wasmUrl: string, config: PhysicsPluginConfig = {}, factory?: PhysicsModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = resolveConfig(config);
    }

    build(app: App): void {
        app.insertResource(PhysicsEvents, {
            collisionEnters: [],
            collisionExits: [],
            sensorEnters: [],
            sensorExits: [],
        });
        app.insertResource(PhysicsRuntime, { module: null, initPromise: null });

        const initPromise = loadPhysicsModule(this.wasmUrl_, this.factory_).then(
            (module: PhysicsWasmModule) => {
                module._physics_init(
                    this.config_.gravity.x,
                    this.config_.gravity.y,
                    this.config_.fixedTimestep,
                    this.config_.subStepCount,
                    this.config_.contactHertz,
                    this.config_.contactDampingRatio,
                    this.config_.contactSpeed,
                );

                registerPhysicsSystem(app, module, this.config_);

                app.getResource(PhysicsRuntime).module = module;
                app.insertResource(PhysicsAPI, Physics._fromModule(module));
                setupPhysicsDebugDraw(app, PhysicsAPI, PhysicsEvents);
                app.setFixedTimestep(this.config_.fixedTimestep);
            },
        );

        initPromise.catch((e) => {
            handleWasmError(e, 'PhysicsPlugin.init');
        });
        app.getResource(PhysicsRuntime).initPromise = initPromise;
    }
}
