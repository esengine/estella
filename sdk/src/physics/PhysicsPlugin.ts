// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { PhysicsBridge } from './PhysicsBridge';
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
    CollisionHitEvent,
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
        enableSleep: config.enableSleep ?? true,
        enableContinuous: config.enableContinuous ?? true,
        restitutionThreshold: config.restitutionThreshold ?? 0, // ≤0 → keep Box2D default
        maxLinearSpeed: config.maxLinearSpeed ?? 0, // ≤0 → keep Box2D default
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
    private bridge_ = new PhysicsBridge();
    private module_: PhysicsWasmModule | null = null;

    constructor(wasmUrl: string, config: PhysicsPluginConfig = {}, factory?: PhysicsModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = resolveConfig(config);
    }

    build(app: App): void {
        app.insertResource(PhysicsEvents, {
            collisionEnters: [],
            collisionExits: [],
            collisionHits: [],
            sensorEnters: [],
            sensorExits: [],
        });
        app.insertResource(PhysicsRuntime, { module: null, initPromise: null });
        // wasm loading → show "initializing", not a stuck "registered".
        app.subsystems.transition('physics', 'initializing');

        const initPromise = loadPhysicsModule(this.wasmUrl_, this.factory_).then(
            (loaded: PhysicsWasmModule) => {
                // Push a terminal Box2D abort to the registry too (not just the
                // bridge's call-time guard). Set before connect() so the bridge's
                // abort guard preserves and chains this handler.
                (loaded as { onAbort?: (what: unknown) => void }).onAbort = () =>
                    app.subsystems.markError('physics', 'Box2D wasm module aborted');

                // Route the module through the single WASM bridge: this installs
                // the terminal-abort guard and yields a guarded view in which
                // every `_physics_*` call short-circuits after an abort. The
                // guarded module has the same type, so every downstream call
                // site (PhysicsSystem closures, the Physics API wrapper) gains
                // abort safety without changing a single call.
                this.bridge_.connect(loaded);
                const module = this.bridge_.module;
                this.module_ = module;

                module._physics_init(
                    this.config_.gravity.x,
                    this.config_.gravity.y,
                    this.config_.fixedTimestep,
                    this.config_.subStepCount,
                    this.config_.contactHertz,
                    this.config_.contactDampingRatio,
                    this.config_.contactSpeed,
                );
                module._physics_setWorldConfig(
                    this.config_.enableSleep ? 1 : 0,
                    this.config_.enableContinuous ? 1 : 0,
                    this.config_.restitutionThreshold,
                    this.config_.maxLinearSpeed,
                );

                registerPhysicsSystem(app, module, this.config_);

                app.getResource(PhysicsRuntime).module = module;
                app.insertResource(PhysicsAPI, Physics._fromModule(module));
                setupPhysicsDebugDraw(app, PhysicsAPI, PhysicsEvents);
                app.setFixedTimestep(this.config_.fixedTimestep);
                // Module loaded, world initialized, systems registered.
                app.subsystems.transition('physics', 'ready');
            },
        );

        initPromise.catch((e) => {
            app.subsystems.markError('physics', e instanceof Error ? e.message : String(e));
            handleWasmError(e, 'PhysicsPlugin.init');
        });
        app.getResource(PhysicsRuntime).initPromise = initPromise;
    }

    /**
     * Shut the native Box2D world down on app teardown. Without this,
     * `_physics_shutdown` was dead code and the C++ physics world (bodies,
     * joints, contact state) leaked across an engine re-init. The bridge-guarded
     * module makes the call abort-safe; null after so a double cleanup is a no-op.
     */
    cleanup(): void {
        this.module_?._physics_shutdown();
        this.module_ = null;
    }
}
