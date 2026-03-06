import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { ComponentSchema } from '../schemas/ComponentSchemas';
import { COMPONENT_SCHEMA } from '../container/tokens';
import { Constraints } from '../schemas/schemaConstants';

const spatialVisible = { field: 'spatial', equals: true } as const;

const AudioSourceSchema: ComponentSchema = {
    name: 'AudioSource',
    category: 'builtin',
    properties: [
        { name: 'clip', type: 'audio-file' },
        { name: 'bus', type: 'enum', options: [{ label: 'SFX', value: 'sfx' }, { label: 'Music', value: 'music' }, { label: 'UI', value: 'ui' }, { label: 'Voice', value: 'voice' }] },
        { name: 'volume', type: 'number', ...Constraints.opacity },
        { name: 'pitch', type: 'number', ...Constraints.pitch },
        { name: 'loop', type: 'boolean' },
        { name: 'playOnAwake', type: 'boolean', displayName: 'Play On Awake' },
        { name: 'priority', type: 'number', ...Constraints.positiveInt },
        { name: 'enabled', type: 'boolean' },
        { name: 'spatial', type: 'boolean', group: 'Spatial' },
        { name: 'minDistance', type: 'number', min: 0, step: 10, displayName: 'Min Distance', group: 'Spatial',
          visibleWhen: spatialVisible },
        { name: 'maxDistance', type: 'number', min: 0, step: 10, displayName: 'Max Distance', group: 'Spatial',
          visibleWhen: spatialVisible },
        { name: 'attenuationModel', type: 'enum', displayName: 'Attenuation', group: 'Spatial',
          visibleWhen: spatialVisible,
          options: [{ label: 'Linear', value: 0 }, { label: 'Inverse', value: 1 }, { label: 'Exponential', value: 2 }] },
        { name: 'rolloff', type: 'number', min: 0, max: 5, step: 0.1, group: 'Spatial',
          visibleWhen: spatialVisible },
    ],
};

const AudioListenerSchema: ComponentSchema = {
    name: 'AudioListener',
    category: 'builtin',
    properties: [{ name: 'enabled', type: 'boolean' }],
};

export const audioPlugin: EditorPlugin = {
    name: 'audio',
    register(ctx: EditorPluginContext) {
        ctx.registrar.provide(COMPONENT_SCHEMA, AudioSourceSchema.name, AudioSourceSchema);
        ctx.registrar.provide(COMPONENT_SCHEMA, AudioListenerSchema.name, AudioListenerSchema);
    },
};
