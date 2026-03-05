import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';

const AudioSourceSchema: ComponentSchema = {
    name: 'AudioSource',
    category: 'builtin',
    properties: [
        { name: 'clip', type: 'audio-file' },
        { name: 'bus', type: 'enum', options: [{ label: 'SFX', value: 'sfx' }, { label: 'Music', value: 'music' }, { label: 'UI', value: 'ui' }, { label: 'Voice', value: 'voice' }] },
        { name: 'volume', type: 'number', min: 0, max: 1, step: 0.05 },
        { name: 'pitch', type: 'number', min: 0.1, max: 3, step: 0.1 },
        { name: 'loop', type: 'boolean' },
        { name: 'playOnAwake', type: 'boolean' },
        { name: 'spatial', type: 'boolean' },
        { name: 'minDistance', type: 'number', min: 0, step: 10 },
        { name: 'maxDistance', type: 'number', min: 0, step: 10 },
        { name: 'attenuationModel', type: 'enum', options: [{ label: 'Linear', value: 0 }, { label: 'Inverse', value: 1 }, { label: 'Exponential', value: 2 }] },
        { name: 'rolloff', type: 'number', min: 0, max: 5, step: 0.1 },
        { name: 'priority', type: 'number', min: 0, step: 1 },
        { name: 'enabled', type: 'boolean' },
    ],
};

const AudioListenerSchema: ComponentSchema = {
    name: 'AudioListener',
    category: 'builtin',
    properties: [{ name: 'enabled', type: 'boolean' }],
};

export const audioPlugin: EditorPlugin = {
    name: 'audio',
    register() {
        registerComponentSchema(AudioSourceSchema);
        registerComponentSchema(AudioListenerSchema);
    },
};
