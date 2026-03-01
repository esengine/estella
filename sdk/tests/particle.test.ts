import { describe, it, expect } from 'vitest';
import { getComponent } from '../src/component';

describe('ParticleEmitter Component', () => {
    it('should be registered as a builtin component', () => {
        const def = getComponent('ParticleEmitter');
        expect(def).toBeDefined();
        expect(def!._builtin).toBe(true);
        expect(def!._name).toBe('ParticleEmitter');
    });

    it('should have correct default values', () => {
        const def = getComponent('ParticleEmitter');
        const defaults = def!._default as Record<string, unknown>;

        expect(defaults.rate).toBe(10);
        expect(defaults.burstCount).toBe(0);
        expect(defaults.burstInterval).toBe(1);
        expect(defaults.duration).toBe(5);
        expect(defaults.looping).toBe(true);
        expect(defaults.playOnStart).toBe(true);
        expect(defaults.maxParticles).toBe(100);
        expect(defaults.lifetimeMin).toBe(1);
        expect(defaults.lifetimeMax).toBe(2);
        expect(defaults.enabled).toBe(true);
    });

    it('should have shape defaults', () => {
        const def = getComponent('ParticleEmitter');
        const defaults = def!._default as Record<string, unknown>;

        expect(defaults.shape).toBe(0);
        expect(defaults.shapeRadius).toBe(1);
        expect(defaults.shapeSize).toEqual({ x: 1, y: 1 });
        expect(defaults.shapeAngle).toBe(45);
    });

    it('should have color defaults', () => {
        const def = getComponent('ParticleEmitter');
        const defaults = def!._default as Record<string, unknown>;

        expect(defaults.startColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        expect(defaults.endColor).toEqual({ r: 1, g: 1, b: 1, a: 0 });
        expect(defaults.colorEasing).toBe(0);
    });

    it('should have texture defaults', () => {
        const def = getComponent('ParticleEmitter');
        const defaults = def!._default as Record<string, unknown>;

        expect(defaults.spriteColumns).toBe(1);
        expect(defaults.spriteRows).toBe(1);
        expect(defaults.spriteFPS).toBe(10);
        expect(defaults.spriteLoop).toBe(true);
    });

    it('should have rendering defaults', () => {
        const def = getComponent('ParticleEmitter');
        const defaults = def!._default as Record<string, unknown>;

        expect(defaults.blendMode).toBe(1);
        expect(defaults.layer).toBe(0);
        expect(defaults.simulationSpace).toBe(0);
    });
});

describe('Particle Enums', () => {
    it('should export EmitterShape constants', async () => {
        const { EmitterShape } = await import('../src/component');
        expect(EmitterShape.Point).toBe(0);
        expect(EmitterShape.Circle).toBe(1);
        expect(EmitterShape.Rectangle).toBe(2);
        expect(EmitterShape.Cone).toBe(3);
    });

    it('should export SimulationSpace constants', async () => {
        const { SimulationSpace } = await import('../src/component');
        expect(SimulationSpace.World).toBe(0);
        expect(SimulationSpace.Local).toBe(1);
    });
});
