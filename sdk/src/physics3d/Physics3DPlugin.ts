// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DPlugin.ts
 * @brief   Loads the 3D physics module and drives one world from the ECS.
 */
import { reportContact, setBodyPusher } from '../breakable/breakable';
import { AnimatorController } from '../animation/Animator';
import { installPlanetGravity } from './planetGravity';
import { installRagdolls } from './ragdoll';
import { Physics3DRuntime } from './physics3dRuntime';
import type { App, Plugin } from '../app/app';
import { Schedule, defineSystem } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';
import {
    loadPhysics3DModule, Physics3DEvents, type Physics3DModuleFactory,
    type Physics3DWasmModule, type Physics3DEventsData,
} from './Physics3DModule';
import {
    stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG, type Physics3DConfig, type PieceMap,
} from './Physics3DSystem';
import { Physics3DQueries } from './Physics3DQueries';
import { CollisionGeometryRes } from '../runtime/collisionGeometry';
import { setupPhysics3DDebugDraw } from './Physics3DDebugDraw';
import type { Joint3DMap } from './Physics3DJoints';

/** Ask the 3D world what is where. Present once the module has loaded. */
export const Physics3D = defineResource<Physics3DQueries | null>(null, 'Physics3D');

export { Physics3DRuntime } from './physics3dRuntime';

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
            joints: new Map(), pieces: new Map(), config: this.config_,
        };
        const events: Physics3DEventsData = {
            contactEnters: [], contactExits: [], sensorEnters: [], sensorExits: [],
        };
        app.insertResource(Physics3DEvents, events);
        app.insertResource(Physics3DRuntime, runtime);
        // A planet in the world pulls bodies toward its centre; with none, this does nothing.
        installPlanetGravity(app);
        // A character with a Ragdoll component can go limp; with none, the systems find nothing.
        installRagdolls(app);
        app.subsystems?.transition?.('physics3d', 'initializing');

        const initPromise = loadPhysics3DModule(this.wasmUrl_, this.factory_).then((module) => {
            this.module_ = module;
            const { gravity, maxBodies } = this.config_;
            module._physics3d_init(gravity.x, gravity.y, gravity.z, maxBodies);
            const solver = this.config_;
            module._physics3d_setSolver(solver.velocityIterations, solver.positionIterations,
                solver.enableSleep ? 1 : 0, solver.bounceThreshold);
            // Before any body: an ObjectLayer is fixed when a body is created, so a
            // matrix installed later would not reach what is already in the world.
            this.config_.layerMasks?.forEach((mask, layer) => {
                module._physics3d_setLayerMask(layer, mask);
            });
            runtime.module = module;
            // The character map, not a copy of it: characters are created lazily
            // by the step, so a snapshot taken here would never hold one.
            const queries = new Physics3DQueries(module, this.config_.pixelsPerUnit, runtime.characters, runtime.bodies);
            // Whatever throws things about without knowing there is a solver asks through this.
            setBodyPusher((entity, velocity) => queries.setLinearVelocity(entity, velocity));
            app.insertResource(Physics3D, queries);
            // What a foot-plant constraint stands on. Beside the queries, because the animation core must not know physics exists.
            if (app.hasResource(AnimatorController)) {
                app.getResource(AnimatorController).setGroundProbe((origin, drop, layers) => {
                    const hit = queries.raycast(origin, { x: 0, y: -drop, z: 0 }, layers);
                    return hit ? { y: hit.y, normal: { x: hit.normalX, y: hit.normalY, z: hit.normalZ } } : null;
                });
            }
            app.addSystemToSchedule(Schedule.FixedUpdate, defineSystem([], () => {
                stepPhysics3D(app, module, runtime.bodies, this.config_,
                              runtime.characters, events, runtime.joints, runtime.pieces,
                              app.hasResource(CollisionGeometryRes) ? app.getResource(CollisionGeometryRes) : null);
                // What met what, and how hard: told to whatever breaks, which knows nothing of the solver.
                for (const c of events.contactEnters) if (c.speed !== undefined) reportContact(c.entityA, c.entityB, c.speed, { x: c.pointX, y: c.pointY, z: c.pointZ });
            }, { name: 'Physics3DStepSystem' }), { profileDomain: 'physics3d' });
            // Installed with the world, drawn only once a game turns the resource
            // on — a scene that never asks for it pays a resource and nothing else.
            setupPhysics3DDebugDraw(app, () => events.contactEnters);
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
