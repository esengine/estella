import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';

const EASING_OPTIONS = [
    { label: 'Linear', value: 0 },
    { label: 'EaseIn', value: 1 },
    { label: 'EaseOut', value: 2 },
    { label: 'EaseInOut', value: 3 },
];

const ParticleEmitterSchema = defineSchema('ParticleEmitter', {
    overrides: {
        duration:         { min: 0, step: 0.1 },
        rate:             { min: 0, step: 1, group: 'Emission' },
        burstCount:       { min: 0, step: 1, group: 'Emission' },
        burstInterval:    { min: 0, step: 0.1, group: 'Emission' },
        maxParticles:     { min: 1, step: 1, group: 'Emission' },
        lifetimeMin:      { min: 0, step: 0.1, group: 'Lifetime' },
        lifetimeMax:      { min: 0, step: 0.1, group: 'Lifetime' },
        shape: {
            type: 'enum', group: 'Shape',
            options: [
                { label: 'Point', value: 0 },
                { label: 'Circle', value: 1 },
                { label: 'Rectangle', value: 2 },
                { label: 'Cone', value: 3 },
            ],
        },
        shapeRadius:      { min: 0, step: 0.1, group: 'Shape' },
        shapeSize:        { group: 'Shape' },
        shapeAngle:       { min: 0, max: 360, step: 1, group: 'Shape' },
        speedMin:         { min: 0, step: 0.1, group: 'Velocity' },
        speedMax:         { min: 0, step: 0.1, group: 'Velocity' },
        angleSpreadMin:   { min: 0, max: 360, step: 1, group: 'Velocity' },
        angleSpreadMax:   { min: 0, max: 360, step: 1, group: 'Velocity' },
        startSizeMin:     { min: 0, step: 0.1, group: 'Size' },
        startSizeMax:     { min: 0, step: 0.1, group: 'Size' },
        endSizeMin:       { min: 0, step: 0.1, group: 'Size' },
        endSizeMax:       { min: 0, step: 0.1, group: 'Size' },
        sizeEasing:       { type: 'enum', group: 'Size', options: EASING_OPTIONS },
        startColor:       { group: 'Color' },
        endColor:         { group: 'Color' },
        colorEasing:      { type: 'enum', group: 'Color', options: EASING_OPTIONS },
        rotationMin:      { step: 1, group: 'Rotation' },
        rotationMax:      { step: 1, group: 'Rotation' },
        angularVelocityMin: { step: 1, group: 'Rotation' },
        angularVelocityMax: { step: 1, group: 'Rotation' },
        gravity:          { group: 'Forces' },
        damping:          { min: 0, step: 0.01, group: 'Forces' },
        texture:          { group: 'Texture' },
        spriteColumns:    { min: 1, step: 1, group: 'Texture' },
        spriteRows:       { min: 1, step: 1, group: 'Texture' },
        spriteFPS:        { min: 1, step: 1, group: 'Texture' },
        spriteLoop:       { group: 'Texture' },
        blendMode: {
            type: 'enum', group: 'Rendering',
            options: [
                { label: 'Normal', value: 0 },
                { label: 'Additive', value: 1 },
            ],
        },
        layer:            { min: LAYER_MIN, max: LAYER_MAX, group: 'Rendering' },
        material:         { group: 'Rendering' },
        simulationSpace: {
            type: 'enum', group: 'Rendering',
            options: [
                { label: 'World', value: 0 },
                { label: 'Local', value: 1 },
            ],
        },
    },
});

export const particlePlugin: EditorPlugin = {
    name: 'particle',
    register(_ctx: EditorPluginContext) {},
};
