import {
    EmitterShape, BlendMode, ParticleEasing,
    Transform, ParticleEmitter,
} from 'esengine';
import type { ParticleEmitterData, CommandsInstance } from 'esengine';
import { ShowcaseEmitter } from './components';

// A showcase is a named set of emitters placed relative to the screen center.
// Only the fields that differ from ParticleEmitter's defaults are listed; the
// defaults already give looping, playOnStart, World space and additive blending.
export interface EmitterSpec {
    x: number;
    y: number;
    data: Partial<ParticleEmitterData>;
}
export interface Showcase {
    name: string;
    emitters: EmitterSpec[];
}

export const SHOWCASES: Showcase[] = [
    {
        name: 'Campfire',
        emitters: [
            { x: 0, y: -150, data: {
                rate: 100, maxParticles: 320, lifetimeMin: 0.7, lifetimeMax: 1.4,
                shape: EmitterShape.Circle, shapeRadius: 16, speedMin: 90, speedMax: 180,
                angleSpreadMin: 78, angleSpreadMax: 102, startSizeMin: 18, startSizeMax: 30,
                endSizeMin: 3, endSizeMax: 6, sizeEasing: ParticleEasing.EaseOut,
                startColor: { r: 1, g: 0.65, b: 0.15, a: 1 }, endColor: { r: 1, g: 0.12, b: 0.02, a: 0 },
                colorEasing: ParticleEasing.EaseIn, gravity: { x: 0, y: 70 } } },
            { x: 0, y: -70, data: {
                rate: 22, maxParticles: 140, lifetimeMin: 2.0, lifetimeMax: 3.5,
                shape: EmitterShape.Circle, shapeRadius: 14, speedMin: 30, speedMax: 55,
                angleSpreadMin: 75, angleSpreadMax: 105, startSizeMin: 26, startSizeMax: 40,
                endSizeMin: 90, endSizeMax: 130, sizeEasing: ParticleEasing.EaseOut,
                startColor: { r: 0.5, g: 0.5, b: 0.53, a: 0.45 }, endColor: { r: 0.25, g: 0.25, b: 0.28, a: 0 },
                gravity: { x: 0, y: 40 }, damping: 0.4, blendMode: BlendMode.Normal } },
            { x: 0, y: -150, data: {
                rate: 14, maxParticles: 90, lifetimeMin: 1.2, lifetimeMax: 2.2,
                shape: EmitterShape.Circle, shapeRadius: 10, speedMin: 60, speedMax: 150,
                angleSpreadMin: 60, angleSpreadMax: 120, startSizeMin: 3, startSizeMax: 6,
                endSizeMin: 0, endSizeMax: 0, startColor: { r: 1, g: 0.8, b: 0.3, a: 1 },
                endColor: { r: 1, g: 0.4, b: 0.1, a: 0 }, angularVelocityMin: -180, angularVelocityMax: 180,
                gravity: { x: 0, y: 95 } } },
        ],
    },
    {
        name: 'Fireworks',
        emitters: [-260, 0, 260].map((x, i) => ({
            x, y: [120, 185, 130][i], data: {
                rate: 0, burstCount: 46, burstInterval: [1.1, 1.5, 1.9][i], maxParticles: 220,
                lifetimeMin: 0.8, lifetimeMax: 1.6, shape: EmitterShape.Point, speedMin: 170, speedMax: 380,
                startSizeMin: 5, startSizeMax: 10, endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseOut,
                startColor: [{ r: 1, g: 0.85, b: 0.3, a: 1 }, { r: 0.4, g: 0.9, b: 1, a: 1 }, { r: 1, g: 0.4, b: 0.9, a: 1 }][i],
                endColor: { r: 1, g: 0.3, b: 0.1, a: 0 }, gravity: { x: 0, y: -150 }, damping: 0.3,
            },
        })),
    },
    {
        name: 'Magic Portal',
        emitters: [
            { x: 0, y: 0, data: {
                rate: 120, maxParticles: 420, lifetimeMin: 1.2, lifetimeMax: 2.4,
                shape: EmitterShape.Circle, shapeRadius: 90, speedMin: 8, speedMax: 30,
                startSizeMin: 8, startSizeMax: 16, endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseInOut,
                startColor: { r: 0.6, g: 0.35, b: 1, a: 1 }, endColor: { r: 0.35, g: 0.9, b: 1, a: 0 },
                angularVelocityMin: -160, angularVelocityMax: 160, damping: 0.3 } },
            { x: 0, y: 0, data: {
                rate: 60, maxParticles: 220, lifetimeMin: 0.8, lifetimeMax: 1.6,
                shape: EmitterShape.Circle, shapeRadius: 30, speedMin: 5, speedMax: 20,
                startSizeMin: 6, startSizeMax: 12, endSizeMin: 0, endSizeMax: 0,
                startColor: { r: 0.9, g: 0.7, b: 1, a: 1 }, endColor: { r: 0.5, g: 0.9, b: 1, a: 0 },
                angularVelocityMin: 120, angularVelocityMax: 240 } },
        ],
    },
    {
        name: 'Fountain',
        emitters: [
            { x: 0, y: -170, data: {
                rate: 130, maxParticles: 420, lifetimeMin: 1.2, lifetimeMax: 2.0,
                shape: EmitterShape.Point, speedMin: 320, speedMax: 460, angleSpreadMin: 84, angleSpreadMax: 96,
                startSizeMin: 6, startSizeMax: 12, endSizeMin: 3, endSizeMax: 5,
                startColor: { r: 0.5, g: 0.8, b: 1, a: 1 }, endColor: { r: 0.2, g: 0.4, b: 1, a: 0 },
                gravity: { x: 0, y: -430 } } },
            { x: 0, y: -170, data: {
                rate: 40, maxParticles: 160, lifetimeMin: 1.5, lifetimeMax: 2.5,
                shape: EmitterShape.Circle, shapeRadius: 20, speedMin: 60, speedMax: 140,
                angleSpreadMin: 70, angleSpreadMax: 110, startSizeMin: 8, startSizeMax: 16,
                endSizeMin: 20, endSizeMax: 30, startColor: { r: 0.6, g: 0.85, b: 1, a: 0.5 },
                endColor: { r: 0.4, g: 0.6, b: 1, a: 0 }, gravity: { x: 0, y: -120 }, damping: 0.5 } },
        ],
    },
    {
        name: 'Snowfall',
        emitters: [
            { x: 0, y: 380, data: {
                rate: 90, maxParticles: 800, lifetimeMin: 5, lifetimeMax: 8,
                shape: EmitterShape.Rectangle, shapeSize: { x: 1320, y: 12 },
                speedMin: 40, speedMax: 90, angleSpreadMin: 250, angleSpreadMax: 290,
                startSizeMin: 5, startSizeMax: 11, endSizeMin: 5, endSizeMax: 11,
                startColor: { r: 1, g: 1, b: 1, a: 0.9 }, endColor: { r: 0.85, g: 0.92, b: 1, a: 0.5 },
                angularVelocityMin: -25, angularVelocityMax: 25, gravity: { x: 0, y: -12 },
                damping: 0.05, blendMode: BlendMode.Normal } },
        ],
    },
    {
        name: 'Sparkles',
        emitters: [
            { x: 0, y: 0, data: {
                rate: 70, maxParticles: 320, lifetimeMin: 1.0, lifetimeMax: 2.2,
                shape: EmitterShape.Rectangle, shapeSize: { x: 1120, y: 620 },
                speedMin: 5, speedMax: 25, startSizeMin: 3, startSizeMax: 9,
                endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseInOut,
                startColor: { r: 1, g: 1, b: 0.8, a: 1 }, endColor: { r: 0.6, g: 0.8, b: 1, a: 0 },
                angularVelocityMin: -90, angularVelocityMax: 90 } },
        ],
    },
];

export const SHOWCASE_COUNT = SHOWCASES.length;

// A one-shot firework spawned at the cursor on a click in empty space. duration
// must be > 0 (emission runs only while elapsed < duration); a huge burstInterval
// keeps it to one burst; getAliveCount() then drives despawn once it fades.
export const BURST: Partial<ParticleEmitterData> = {
    rate: 0, burstCount: 64, burstInterval: 999, duration: 0.1,
    looping: false, playOnStart: true, maxParticles: 140,
    shape: EmitterShape.Point, speedMin: 180, speedMax: 440,
    lifetimeMin: 0.7, lifetimeMax: 1.5, startSizeMin: 6, startSizeMax: 12,
    endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseOut,
    startColor: { r: 1, g: 0.9, b: 0.4, a: 1 }, endColor: { r: 1, g: 0.3, b: 0.1, a: 0 },
    gravity: { x: 0, y: -160 }, damping: 0.4, layer: 5,
};

// Spawn every emitter of a showcase, tagged so they can be despawned together.
// `layer: 5` keeps particles above the backdrop; `texture` is the handle read
// from the scene's TexHolder sprite.
export function spawnShowcase(cmds: CommandsInstance, index: number, texture: number): void {
    for (const emitter of SHOWCASES[index].emitters) {
        cmds.spawn()
            .insert(Transform, { position: { x: emitter.x, y: emitter.y, z: 0 } })
            .insert(ParticleEmitter, { layer: 5, texture, ...emitter.data })
            .insert(ShowcaseEmitter, {});
    }
}
