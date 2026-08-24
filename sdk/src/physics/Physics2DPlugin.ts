// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics2DPlugin.ts
 * @brief   Physics2DAPI plugin — async wasm load + resource wiring
 *
 * Thin orchestration layer. Types live in `PhysicsTypes.ts`,
 * the Physics2DAPI API class in `Physics2DAPI.ts`, and the per-frame loop
 * + entity-tracking state in `PhysicsSystem.ts`. This file just
 * loads the wasm module, wires resources, and hands off to the
 * system layer.
 */

import type { Plugin, App } from '../app/app';
import {
    loadPhysicsModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
} from './PhysicsModuleLoader';
import { setupPhysics2DDebugDraw } from './Physics2DDebugDraw';
import { PhysicsBridge } from './PhysicsBridge';
import { Physics2DRuntime } from './Physics2DRuntime';
import { Physics2DAPI, Physics2D } from './Physics2D';
import { registerPhysics2DSystem } from './PhysicsSystem';
import { registerCharacterController2DSystem } from './CharacterController2D';
import { registerPhysics2DEventBridge } from './PhysicsEventBridge';
import {
    Physics2DEvents,
    type Physics2DPluginConfig,
    type ResolvedPhysics2DConfig,
} from './PhysicsTypes';
import { handleWasmError } from '../wasm/wasmError';

// Re-export the shapes consumers reach for via the plugin file so
// existing `import from './physics/Physics2DPlugin'` sites keep working.
export {
    Physics2DEvents,
    Physics2D,
    Physics2DAPI,
};
export type {
    Physics2DPluginConfig,
    Physics2DEventsData,
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

function resolveConfig(config: Physics2DPluginConfig): ResolvedPhysics2DConfig {
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

/**
 * What the frame loop calls every step. A module missing any of it is a wasm
 * built before the JS that drives it.
 *
 * `PhysicsWasmModule` is a TypeScript interface, so it is gone at run time and
 * nothing was checking that the binary answered to it. A `physics.wasm` built
 * hours before the commit that added pose interpolation therefore installed
 * happily, and `PhysicsStepSystem` and `PhysicsInterpolateSystem` then threw
 * `_physics_capturePoses is not a function` TWICE A FRAME, for the length of
 * the session, at anyone who dropped a RigidBody2D into a scene and pressed Play.
 * Two dogfood runs read that as "physics is broken" and turned it off.
 *
 * Not the whole interface — the per-frame contract, whose absence is the one
 * that fails on every tick rather than once.
 */
const REQUIRED_EXPORTS = [
    '_physics_init', '_physics_setWorldConfig', '_physics_step',
    '_physics_capturePoses', '_physics_getInterpolatedCount', '_physics_getInterpolatedTransforms',
    '_physics_collectEvents', '_physics_getDynamicBodyCount', '_physics_getDynamicBodyTransforms',
    '_physics_setBodyTransform',
] as const;

function assertModuleContract(module: PhysicsWasmModule): void {
    const missing = REQUIRED_EXPORTS.filter(
        (name) => typeof (module as unknown as Record<string, unknown>)[name] !== 'function',
    );
    if (missing.length === 0) return;
    // Thrown, so the plugin's own catch marks the subsystem in error and no
    // system is registered: the game runs WITHOUT physics and says why once,
    // rather than running with physics that cannot step and saying why forever.
    throw new Error(
        `physics.wasm is out of date — it does not export ${missing.join(', ')}. `
        + 'It was built before the engine code that calls it; rebuild the physics module '
        + '(the WASM build is a separate step from the editor build). Physics is not installed.',
    );
}

export class Physics2DPlugin implements Plugin {
    name = 'physics';
    private config_: ResolvedPhysics2DConfig;
    private wasmUrl_: string;
    private factory_?: PhysicsModuleFactory;
    private bridge_ = new PhysicsBridge();
    private module_: PhysicsWasmModule | null = null;

    constructor(wasmUrl: string, config: Physics2DPluginConfig = {}, factory?: PhysicsModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = resolveConfig(config);
    }

    build(app: App): void {
        app.insertResource(Physics2DEvents, {
            collisionEnters: [],
            collisionExits: [],
            collisionHits: [],
            sensorEnters: [],
            sensorExits: [],
        });
        app.insertResource(Physics2DRuntime, { module: null, initPromise: null });
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
                // site (PhysicsSystem closures, the Physics2DAPI API wrapper) gains
                // abort safety without changing a single call.
                assertModuleContract(loaded);

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

                registerPhysics2DSystem(app, module, this.config_);

                app.getResource(Physics2DRuntime).module = module;
                app.insertResource(Physics2D, Physics2DAPI._fromModule(module));
                registerCharacterController2DSystem(app);
                // Contacts also reach the entity event channel, so a trigger area
                // can be wired by an authored EventBinding row like a button is.
                registerPhysics2DEventBridge(app);
                setupPhysics2DDebugDraw(app, Physics2D, Physics2DEvents);
                app.setFixedTimestep(this.config_.fixedTimestep);
                // Module loaded, world initialized, systems registered.
                app.subsystems.transition('physics', 'ready');
            },
        );

        initPromise.catch((e) => {
            app.subsystems.markError('physics', e instanceof Error ? e.message : String(e));
            handleWasmError(e, 'Physics2DPlugin.init');
        });
        app.getResource(Physics2DRuntime).initPromise = initPromise;
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

export function physics2dPlugin(
    wasmUrl: string, config: Physics2DPluginConfig = {}, factory?: PhysicsModuleFactory,
): Physics2DPlugin {
    return new Physics2DPlugin(wasmUrl, config, factory);
}
