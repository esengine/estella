// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DPlugin.ts
 * @brief   Loads the 3D physics module and drives one world from the ECS.
 */
import { bindBodyPusher, reportContact, type ContactSink } from '../breakable/breakable';
import { AnimatorController } from '../animation/Animator';
import { installPlanetGravity } from './planetGravity';
import { installHitboxes } from './hitboxes';
import { installRagdolls } from './ragdoll';
import { Physics3DRuntime } from './physics3dRuntime';
import type { App, Plugin } from '../app/app';
import { PluginInstallations } from '../app/pluginInstallations';
import { Schedule, defineSystem } from '../ecs/system';
import { defineResource } from '../ecs/resource';
import {
    loadPhysics3DModule, Physics3DEvents, type Physics3DModuleFactory,
    type Physics3DWasmModule, type Physics3DEventsData,
} from './Physics3DModule';
import {
    stepPhysics3D, DEFAULT_PHYSICS3D_CONFIG, type Physics3DConfig,
} from './Physics3DSystem';
import { Physics3DQueries } from './Physics3DQueries';
import { CollisionGeometryRes } from '../runtime/collisionGeometry';
import { setupPhysics3DDebugDraw } from './Physics3DDebugDraw';
import { CameraCollision, type CameraCollisionProbe } from '../camera/CameraDeoccluder';
import { log } from '../util/logger';

/** Ask the 3D world what is where. Present once the module has loaded. */
export const Physics3D = defineResource<Physics3DQueries | null>(null, 'Physics3D');

export { Physics3DRuntime } from './physics3dRuntime';

// Each native module holds one world. A cached factory result can be reused after its owner stops.
const activeModules = new WeakSet<Physics3DWasmModule>();

export class Physics3DPlugin implements Plugin {
    name = 'physics3d';
    private config_: Physics3DConfig;
    private wasmUrl_: string;
    private factory_?: Physics3DModuleFactory;
    private readonly cleanups_ = new PluginInstallations<() => void>();

    constructor(wasmUrl: string, config: Partial<Physics3DConfig> = {},
                factory?: Physics3DModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = { ...DEFAULT_PHYSICS3D_CONFIG, ...config };
    }

    build(app: App): void {
        this.cleanup(app);
        const config = {
            ...this.config_, gravity: { ...this.config_.gravity }, layerMasks: this.config_.layerMasks?.slice(),
        };
        const runtime: Physics3DRuntime = {
            module: null, initPromise: null, bodies: new Map(), characters: new Map(),
            joints: new Map(), pieces: new Map(), config,
        };
        let released = false;
        let queries: Physics3DQueries | null = null;
        let stepId: symbol | undefined;
        let disposeOverlay: (() => void) | undefined;
        let unbindQueries: (() => void) | undefined;
        this.cleanups_.set(app, () => {
            released = true;
            const module = runtime.module;
            runtime.module = null;
            queries = null;
            runtime.bodies.clear();
            runtime.characters.clear();
            runtime.joints.clear();
            runtime.pieces.clear();
            try {
                disposeOverlay?.();
                if (stepId) app.removeSystem(stepId);
                unbindQueries?.();
            } finally {
                if (module) {
                    module._physics3d_shutdown();
                    activeModules.delete(module);
                }
            }
        });
        const events: Physics3DEventsData = {
            contactEnters: [], contactExits: [], sensorEnters: [], sensorExits: [],
        };
        app.insertResource(Physics3DEvents, events);
        app.insertResource(Physics3DRuntime, runtime);
        // A planet in the world pulls bodies toward its centre; with none, this does nothing.
        installPlanetGravity(app);
        // A character with a Ragdoll component can go limp; with none, the systems find nothing.
        installRagdolls(app);
        // A character a shot can tell the parts of has a box on each bone; with none, the system finds nothing.
        installHitboxes(app);
        app.subsystems?.transition?.('physics3d', 'initializing');

        const initPromise = loadPhysics3DModule(this.wasmUrl_, this.factory_).then((module) => {
            if (released) return;
            if (activeModules.has(module)) throw new Error('A 3D physics module can run only one App at a time. Return a separate module for each active App.');
            activeModules.add(module);
            runtime.module = module;
            const { gravity, maxBodies } = config;
            module._physics3d_init(gravity.x, gravity.y, gravity.z, maxBodies);
            module._physics3d_setSolver(config.velocityIterations, config.positionIterations,
                config.enableSleep ? 1 : 0, config.bounceThreshold);
            // Before any body: an ObjectLayer is fixed when a body is created, so a
            // matrix installed later would not reach what is already in the world.
            config.layerMasks?.forEach((mask, layer) => {
                module._physics3d_setLayerMask(layer, mask);
            });
            // The character map, not a copy of it: characters are created lazily
            // by the step, so a snapshot taken here would never hold one.
            const contact: ContactSink = (a, b, impulse, point) => reportContact(a, b, impulse, point, app);
            const physics = new Physics3DQueries(module, config.pixelsPerUnit, runtime.characters, runtime.bodies, config, contact);
            queries = physics;
            // Whatever throws things about without knowing there is a solver asks through this.
            const unbindPusher = bindBodyPusher(app, (entity, velocity) => physics.setLinearVelocity(entity, velocity));
            // What a camera's deoccluder sweeps with. Beside the queries, because the camera core must not know physics exists.
            const camera: CameraCollisionProbe = {
                sweep: (origin, radius, delta, layers) => queries?.sphereCast(origin, radius, delta, layers)?.fraction ?? null,
            };
            unbindQueries = () => {
                unbindPusher();
                if (app.hasResource(Physics3D) && app.getResource(Physics3D) === physics) app.insertResource(Physics3D, null);
                if (app.hasResource(CameraCollision) && app.getResource(CameraCollision) === camera) app.insertResource(CameraCollision, null);
            };
            app.insertResource(Physics3D, physics);
            app.insertResource(CameraCollision, camera);
            // What a foot-plant constraint stands on. Beside the queries, because the animation core must not know physics exists.
            if (app.hasResource(AnimatorController)) {
                app.getResource(AnimatorController).setGroundProbe((origin, drop, layers) => {
                    const hit = queries?.raycast(origin, { x: 0, y: -drop, z: 0 }, layers);
                    return hit ? { y: hit.y, normal: { x: hit.normalX, y: hit.normalY, z: hit.normalZ } } : null;
                });
            }
            const step = defineSystem([], () => {
                stepPhysics3D(app, module, runtime.bodies, config,
                              runtime.characters, events, runtime.joints, runtime.pieces,
                              app.hasResource(CollisionGeometryRes) ? app.getResource(CollisionGeometryRes) : null);
                // What met what, and how hard: told to whatever breaks, which knows nothing of the solver.
                for (const c of events.contactEnters) if (c.impulse !== undefined) contact(c.entityA, c.entityB, c.impulse, { x: c.pointX, y: c.pointY, z: c.pointZ });
                // A character that runs into a window strikes it as a body would: a dive through it, not a lean on it.
                for (const h of events.characterHits ?? []) contact(h.character, h.other, h.impulse, { x: h.pointX, y: h.pointY, z: h.pointZ });
            }, { name: 'Physics3DStepSystem' });
            stepId = step._id;
            app.addSystemToSchedule(Schedule.FixedUpdate, step, { profileDomain: 'physics3d' });
            // Installed with the world, drawn only once a game turns the resource
            // on — a scene that never asks for it pays a resource and nothing else.
            disposeOverlay = setupPhysics3DDebugDraw(app, () => events.contactEnters);
            app.setFixedTimestep?.(config.fixedTimestep);
            app.subsystems?.transition?.('physics3d', 'ready');
        });

        initPromise.catch((e: unknown) => {
            if (released) return;
            try { this.cleanup(app); }
            catch (error) { log.warn('physics3d', 'Failed to release the physics world after initialization failed', error); }
            app.subsystems?.markError?.('physics3d',
                                        e instanceof Error ? e.message : String(e));
        });
        runtime.initPromise = initPromise;
    }

    /** Tear the world down, so a re-init does not inherit the last one's bodies. */
    cleanup(app?: App): void {
        this.cleanups_.take(app)?.();
    }
}

export function physics3dPlugin(
    wasmUrl: string, config: Partial<Physics3DConfig> = {}, factory?: Physics3DModuleFactory,
): Physics3DPlugin {
    return new Physics3DPlugin(wasmUrl, config, factory);
}
