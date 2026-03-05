import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';
import { LAYER_MIN, LAYER_MAX } from '../schemas/schemaConstants';

const ParticleEmitterSchema: ComponentSchema = {
    name: 'ParticleEmitter',
    category: 'builtin',
    properties: [
        { name: 'enabled', type: 'boolean' },
        { name: 'playOnStart', type: 'boolean' },
        { name: 'looping', type: 'boolean' },
        { name: 'duration', type: 'number', min: 0, step: 0.1 },
        { name: 'rate', type: 'number', min: 0, step: 1, group: 'Emission' },
        { name: 'burstCount', type: 'number', min: 0, step: 1, group: 'Emission' },
        { name: 'burstInterval', type: 'number', min: 0, step: 0.1, group: 'Emission' },
        { name: 'maxParticles', type: 'number', min: 1, step: 1, group: 'Emission' },
        { name: 'lifetimeMin', type: 'number', min: 0, step: 0.1, group: 'Lifetime' },
        { name: 'lifetimeMax', type: 'number', min: 0, step: 0.1, group: 'Lifetime' },
        { name: 'shape', type: 'enum', group: 'Shape', options: [{ label: 'Point', value: 0 }, { label: 'Circle', value: 1 }, { label: 'Rectangle', value: 2 }, { label: 'Cone', value: 3 }] },
        { name: 'shapeRadius', type: 'number', min: 0, step: 0.1, group: 'Shape' },
        { name: 'shapeSize', type: 'vec2', group: 'Shape' },
        { name: 'shapeAngle', type: 'number', min: 0, max: 360, step: 1, group: 'Shape' },
        { name: 'speedMin', type: 'number', min: 0, step: 0.1, group: 'Velocity' },
        { name: 'speedMax', type: 'number', min: 0, step: 0.1, group: 'Velocity' },
        { name: 'angleSpreadMin', type: 'number', min: 0, max: 360, step: 1, group: 'Velocity' },
        { name: 'angleSpreadMax', type: 'number', min: 0, max: 360, step: 1, group: 'Velocity' },
        { name: 'startSizeMin', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'startSizeMax', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'endSizeMin', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'endSizeMax', type: 'number', min: 0, step: 0.1, group: 'Size' },
        { name: 'sizeEasing', type: 'enum', group: 'Size', options: [{ label: 'Linear', value: 0 }, { label: 'EaseIn', value: 1 }, { label: 'EaseOut', value: 2 }, { label: 'EaseInOut', value: 3 }] },
        { name: 'startColor', type: 'color', group: 'Color' },
        { name: 'endColor', type: 'color', group: 'Color' },
        { name: 'colorEasing', type: 'enum', group: 'Color', options: [{ label: 'Linear', value: 0 }, { label: 'EaseIn', value: 1 }, { label: 'EaseOut', value: 2 }, { label: 'EaseInOut', value: 3 }] },
        { name: 'rotationMin', type: 'number', step: 1, group: 'Rotation' },
        { name: 'rotationMax', type: 'number', step: 1, group: 'Rotation' },
        { name: 'angularVelocityMin', type: 'number', step: 1, group: 'Rotation' },
        { name: 'angularVelocityMax', type: 'number', step: 1, group: 'Rotation' },
        { name: 'gravity', type: 'vec2', group: 'Forces' },
        { name: 'damping', type: 'number', min: 0, step: 0.01, group: 'Forces' },
        { name: 'texture', type: 'texture', group: 'Texture' },
        { name: 'spriteColumns', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteRows', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteFPS', type: 'number', min: 1, step: 1, group: 'Texture' },
        { name: 'spriteLoop', type: 'boolean', group: 'Texture' },
        { name: 'blendMode', type: 'enum', group: 'Rendering', options: [{ label: 'Normal', value: 0 }, { label: 'Additive', value: 1 }] },
        { name: 'layer', type: 'number', min: LAYER_MIN, max: LAYER_MAX, group: 'Rendering' },
        { name: 'material', type: 'material-file', group: 'Rendering' },
        { name: 'simulationSpace', type: 'enum', group: 'Rendering', options: [{ label: 'World', value: 0 }, { label: 'Local', value: 1 }] },
    ],
};

export const particlePlugin: EditorPlugin = {
    name: 'particle',
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, ParticleEmitterSchema.name, ParticleEmitterSchema);
    },
};
