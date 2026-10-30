// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Time, type TimeData } from '../ecs/resource';
import { fxPreviewOrPlayMode } from '../ecs/env';
import type { CppRegistry } from '../wasm';
import { engineApi } from '../ecs/bridge/engineApi';
import { registerSceneComponentCodec } from '../scene/scene';
import { Particle, ParticleAPI } from './ParticleAPI';
import { particleQueryResolver } from './ParticleCollisionBridge';
import { ParticleCollisionEvent, type ParticleCollisionEventPayload } from './collision';
import { EventWriter, type EventWriterInstance } from '../ecs/event';
import { Draw } from '../render/draw';
import { registerScopedDrawCallback, unregisterDrawCallback } from '../render/customDraw';

import { bakeGradient, type Gradient } from './gradient';
import { bakeCurve, type Curve } from './curve';

let overlayId = 0;

export class ParticlePlugin implements Plugin {
    name = 'particle';

    /** Entity → authored color-over-life gradient (out-of-band; baked to the C++ LUT). */
    private readonly gradients_ = new Map<number, Gradient>();
    /** Entity → authored size-over-life curve (out-of-band; baked to the C++ LUT). */
    private readonly sizeCurves_ = new Map<number, Curve>();
    /** Entity → authored burst schedule (out-of-band; handed to the sim as (time, count) pairs). */
    private readonly bursts_ = new Map<number, { time: number; count: number }[]>();
    private overlay_: string | null = null;
    private offDespawn_: (() => void) | null = null;

    build(app: App): void {
        // Whichever core is present; a core built without ES_ENABLE_PARTICLES simply
        // answers no particle_* entry point, which the API already tolerates.
        // `?? {}`: an app with no engine core (a test, a pure-logic host) still gets
        // the resource, and every call through it no-ops.
        const engine = engineApi(app) ?? {};
        const registry = app.world.getCppRegistry() as CppRegistry;
        const api = new ParticleAPI(engine, registry, particleQueryResolver(app));
        app.insertResource(Particle, api);
        this.overlay_ = `particle-collision:${++overlayId}`;
        registerScopedDrawCallback(this.overlay_,registry,()=>{
            if (!api.debugNormals) return;
            for (const hit of api.collisionContacts) {
                Draw.line3D({x:hit.x,y:hit.y,z:hit.z},
                    {x:hit.x+hit.normalX*20,y:hit.y+hit.normalY*20,z:hit.z+hit.normalZ*20},
                    {r:.2,g:.9,b:.7,a:1},1);
            }
        });

        // The color gradient is authored as stops in the component data but isn't a
        // C++ field — carry it out-of-band and bake it into the sim's LUT on load.
        const gradients = this.gradients_;
        const sizeCurves = this.sizeCurves_;
        const bursts = this.bursts_;

        this.offDespawn_ = app.world.onDespawn((entity) => {
            if (gradients.delete(entity)) api.setColorLut(entity, null);
            if (sizeCurves.delete(entity)) api.setSizeLut(entity, null);
            if (bursts.delete(entity)) api.setBursts(entity, null);
        });

        registerSceneComponentCodec('ParticleEmitter', {
            outOfBandFields: ['colorGradient', 'sizeCurve', 'bursts'],
            importData: (entity, outOfBand) => {
                const g = outOfBand.colorGradient as Gradient | undefined;
                api.setColorLut(entity, bakeGradient(g));
                if (g?.stops?.length) gradients.set(entity, g);
                else gradients.delete(entity);

                const c = outOfBand.sizeCurve as Curve | undefined;
                api.setSizeLut(entity, bakeCurve(c));
                if (c?.keys?.length) sizeCurves.set(entity, c);
                else sizeCurves.delete(entity);

                const b = outOfBand.bursts as { time: number; count: number }[] | undefined;
                api.setBursts(entity, b ?? null);
                if (b?.length) bursts.set(entity, b);
                else bursts.delete(entity);
            },
            exportData: (entity, data) => {
                const g = gradients.get(entity);
                if (g) data.colorGradient = g;
                const c = sizeCurves.get(entity);
                if (c) data.sizeCurve = c;
                const b = bursts.get(entity);
                if (b) data.bursts = b;
            },
        });

        // Particle advance is gameplay — frozen in editor edit mode, runs in
        // play mode / standalone runtime (matches animation/physics/timeline).
        // The FX edit-preview flag is the one authoring exception (env.ts).
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [Res(Time), Res(Particle), EventWriter(ParticleCollisionEvent)],
            (time: TimeData, particle: ParticleAPI, events: EventWriterInstance<ParticleCollisionEventPayload>) => {
                particle.update(time.delta);
                for (const hit of particle.collisionEvents) events.send(hit);
            },
            { name: 'ParticleSystem' }
        ), { runIf: fxPreviewOrPlayMode });
    }

    cleanup(): void {
        if (this.overlay_) unregisterDrawCallback(this.overlay_);
        this.overlay_ = null;
        this.offDespawn_?.();
        this.offDespawn_ = null;
        this.gradients_.clear();
        this.sizeCurves_.clear();
    }
}

export const particlePlugin = new ParticlePlugin();
