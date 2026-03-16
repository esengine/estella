import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import { defineSchema } from '../schemas/ComponentSchemas';
import { Constraints } from '../schemas/schemaConstants';

const spatialVisible = { field: 'spatial', equals: true } as const;

const AudioSourceSchema = defineSchema('AudioSource', {
    overrides: {
        bus: {
            type: 'enum',
            options: [
                { label: 'SFX', value: 'sfx' },
                { label: 'Music', value: 'music' },
                { label: 'UI', value: 'ui' },
                { label: 'Voice', value: 'voice' },
            ],
        },
        volume: { ...Constraints.opacity },
        pitch: { ...Constraints.pitch },
        playOnAwake: { displayName: 'Play On Awake' },
        priority: { ...Constraints.positiveInt },
        spatial: { group: 'Spatial' },
        minDistance: {
            min: 0, step: 10, displayName: 'Min Distance', group: 'Spatial',
            visibleWhen: spatialVisible,
        },
        maxDistance: {
            min: 0, step: 10, displayName: 'Max Distance', group: 'Spatial',
            visibleWhen: spatialVisible,
        },
        attenuationModel: {
            type: 'enum', displayName: 'Attenuation', group: 'Spatial',
            visibleWhen: spatialVisible,
            options: [
                { label: 'Linear', value: 0 },
                { label: 'Inverse', value: 1 },
                { label: 'Exponential', value: 2 },
            ],
        },
        rolloff: {
            min: 0, max: 5, step: 0.1, group: 'Spatial',
            visibleWhen: spatialVisible,
        },
    },
});

const AudioListenerSchema = defineSchema('AudioListener');

export const audioPlugin: EditorPlugin = {
    name: 'audio',
    register(_ctx: EditorPluginContext) {},
};
