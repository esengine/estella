import { EmitterShape, BlendMode, ParticleEasing } from 'esengine';
import type { ParticleEmitterData } from 'esengine';

// A particle "look" — the subset of ParticleEmitter fields the presets vary.
// Lifecycle (looping/playOnStart/maxParticles), the texture, and the World
// simulation space stay fixed on the follow emitter; a preset only changes how
// it looks and moves. Angles are degrees measured from +x, so 90 = up.
export interface Preset {
    name: string;
    rate: number;
    lifetimeMin: number;
    lifetimeMax: number;
    shape: number;
    shapeRadius: number;
    shapeAngle: number;
    speedMin: number;
    speedMax: number;
    angleSpreadMin: number;
    angleSpreadMax: number;
    startSizeMin: number;
    startSizeMax: number;
    endSizeMin: number;
    endSizeMax: number;
    sizeEasing: number;
    startColor: { r: number; g: number; b: number; a: number };
    endColor: { r: number; g: number; b: number; a: number };
    colorEasing: number;
    angularVelocityMin: number;
    angularVelocityMax: number;
    gravity: { x: number; y: number };
    damping: number;
    blendMode: number;
}

export const PRESETS: Preset[] = [
    {
        name: 'Fire', rate: 90, lifetimeMin: 0.7, lifetimeMax: 1.4,
        shape: EmitterShape.Circle, shapeRadius: 14, shapeAngle: 0,
        speedMin: 90, speedMax: 190, angleSpreadMin: 75, angleSpreadMax: 105,
        startSizeMin: 16, startSizeMax: 26, endSizeMin: 3, endSizeMax: 6, sizeEasing: ParticleEasing.EaseOut,
        startColor: { r: 1, g: 0.65, b: 0.15, a: 1 }, endColor: { r: 1, g: 0.12, b: 0.02, a: 0 }, colorEasing: ParticleEasing.EaseIn,
        angularVelocityMin: 0, angularVelocityMax: 0, gravity: { x: 0, y: 60 }, damping: 0, blendMode: BlendMode.Additive,
    },
    {
        name: 'Sparks', rate: 70, lifetimeMin: 0.5, lifetimeMax: 1.0,
        shape: EmitterShape.Point, shapeRadius: 0, shapeAngle: 0,
        speedMin: 160, speedMax: 360, angleSpreadMin: 0, angleSpreadMax: 360,
        startSizeMin: 5, startSizeMax: 9, endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.Linear,
        startColor: { r: 1, g: 0.95, b: 0.6, a: 1 }, endColor: { r: 1, g: 0.4, b: 0.1, a: 0 }, colorEasing: ParticleEasing.Linear,
        angularVelocityMin: -220, angularVelocityMax: 220, gravity: { x: 0, y: -280 }, damping: 0.6, blendMode: BlendMode.Additive,
    },
    {
        name: 'Smoke', rate: 26, lifetimeMin: 1.8, lifetimeMax: 3.2,
        shape: EmitterShape.Circle, shapeRadius: 12, shapeAngle: 0,
        speedMin: 25, speedMax: 55, angleSpreadMin: 70, angleSpreadMax: 110,
        startSizeMin: 22, startSizeMax: 34, endSizeMin: 70, endSizeMax: 110, sizeEasing: ParticleEasing.EaseOut,
        startColor: { r: 0.55, g: 0.55, b: 0.58, a: 0.5 }, endColor: { r: 0.28, g: 0.28, b: 0.30, a: 0 }, colorEasing: ParticleEasing.EaseIn,
        angularVelocityMin: -20, angularVelocityMax: 20, gravity: { x: 0, y: 35 }, damping: 0.4, blendMode: BlendMode.Normal,
    },
    {
        name: 'Magic', rate: 80, lifetimeMin: 1.2, lifetimeMax: 2.2,
        shape: EmitterShape.Circle, shapeRadius: 30, shapeAngle: 0,
        speedMin: 30, speedMax: 90, angleSpreadMin: 0, angleSpreadMax: 360,
        startSizeMin: 8, startSizeMax: 16, endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseInOut,
        startColor: { r: 0.65, g: 0.4, b: 1.0, a: 1 }, endColor: { r: 0.3, g: 0.9, b: 1.0, a: 0 }, colorEasing: ParticleEasing.Linear,
        angularVelocityMin: -120, angularVelocityMax: 120, gravity: { x: 0, y: 45 }, damping: 0.2, blendMode: BlendMode.Additive,
    },
    {
        name: 'Snow', rate: 40, lifetimeMin: 2.5, lifetimeMax: 4.0,
        shape: EmitterShape.Circle, shapeRadius: 40, shapeAngle: 0,
        speedMin: 30, speedMax: 70, angleSpreadMin: 255, angleSpreadMax: 285,
        startSizeMin: 6, startSizeMax: 12, endSizeMin: 6, endSizeMax: 12, sizeEasing: ParticleEasing.Linear,
        startColor: { r: 1, g: 1, b: 1, a: 0.9 }, endColor: { r: 0.8, g: 0.9, b: 1.0, a: 0.25 }, colorEasing: ParticleEasing.Linear,
        angularVelocityMin: -30, angularVelocityMax: 30, gravity: { x: 0, y: -15 }, damping: 0.1, blendMode: BlendMode.Normal,
    },
    {
        name: 'Fountain', rate: 120, lifetimeMin: 1.1, lifetimeMax: 1.9,
        shape: EmitterShape.Point, shapeRadius: 0, shapeAngle: 0,
        speedMin: 300, speedMax: 440, angleSpreadMin: 82, angleSpreadMax: 98,
        startSizeMin: 6, startSizeMax: 12, endSizeMin: 3, endSizeMax: 5, sizeEasing: ParticleEasing.Linear,
        startColor: { r: 0.5, g: 0.8, b: 1, a: 1 }, endColor: { r: 0.2, g: 0.4, b: 1, a: 0 }, colorEasing: ParticleEasing.Linear,
        angularVelocityMin: 0, angularVelocityMax: 0, gravity: { x: 0, y: -420 }, damping: 0, blendMode: BlendMode.Additive,
    },
];

// The pool size the follow emitter is authored with — big enough for the
// highest-rate preset (Fountain: 120/s × ~2s life). Kept constant across presets
// because changing maxParticles mid-run does not resize an existing pool.
export const FOLLOW_MAX_PARTICLES = 600;

// A one-shot firework spawned at the cursor on left-click. duration must be > 0
// (the sim only emits while elapsed < duration), and a huge burstInterval keeps
// it to a single burst; getAliveCount() then drives despawn once it fades out.
export const BURST: Partial<ParticleEmitterData> = {
    rate: 0, burstCount: 64, burstInterval: 999, duration: 0.1,
    looping: false, playOnStart: true, maxParticles: 140,
    shape: EmitterShape.Point, speedMin: 180, speedMax: 440,
    lifetimeMin: 0.7, lifetimeMax: 1.5, angleSpreadMin: 0, angleSpreadMax: 360,
    startSizeMin: 6, startSizeMax: 12, endSizeMin: 0, endSizeMax: 0, sizeEasing: ParticleEasing.EaseOut,
    startColor: { r: 1, g: 0.9, b: 0.4, a: 1 }, endColor: { r: 1, g: 0.3, b: 0.1, a: 0 },
    gravity: { x: 0, y: -160 }, damping: 0.4, blendMode: BlendMode.Additive, layer: 5,
};

// Copy a preset's look onto a live emitter (scalar-by-scalar so the ECS proxy's
// nested Vec2/Color fields are written in place). New particles pick it up next
// frame; particles already alive keep the look they were born with.
export function applyPreset(e: ParticleEmitterData, p: Preset): void {
    e.rate = p.rate;
    e.lifetimeMin = p.lifetimeMin;
    e.lifetimeMax = p.lifetimeMax;
    e.shape = p.shape;
    e.shapeRadius = p.shapeRadius;
    e.shapeAngle = p.shapeAngle;
    e.speedMin = p.speedMin;
    e.speedMax = p.speedMax;
    e.angleSpreadMin = p.angleSpreadMin;
    e.angleSpreadMax = p.angleSpreadMax;
    e.startSizeMin = p.startSizeMin;
    e.startSizeMax = p.startSizeMax;
    e.endSizeMin = p.endSizeMin;
    e.endSizeMax = p.endSizeMax;
    e.sizeEasing = p.sizeEasing;
    e.startColor.r = p.startColor.r;
    e.startColor.g = p.startColor.g;
    e.startColor.b = p.startColor.b;
    e.startColor.a = p.startColor.a;
    e.endColor.r = p.endColor.r;
    e.endColor.g = p.endColor.g;
    e.endColor.b = p.endColor.b;
    e.endColor.a = p.endColor.a;
    e.colorEasing = p.colorEasing;
    e.angularVelocityMin = p.angularVelocityMin;
    e.angularVelocityMax = p.angularVelocityMax;
    e.gravity.x = p.gravity.x;
    e.gravity.y = p.gravity.y;
    e.damping = p.damping;
    e.blendMode = p.blendMode;
}
