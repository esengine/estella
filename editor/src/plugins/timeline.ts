import type { EditorPlugin } from './EditorPlugin';
import { registerComponentSchema, type ComponentSchema } from '../schemas/ComponentSchemas';
import { TIME_SCALE_MAX } from '../schemas/schemaConstants';

const TimelinePlayerSchema: ComponentSchema = {
    name: 'TimelinePlayer',
    category: 'builtin',
    properties: [
        { name: 'timeline', type: 'timeline-file' },
        { name: 'playing', type: 'boolean' },
        { name: 'speed', type: 'number', min: 0, max: TIME_SCALE_MAX, step: 0.1 },
        { name: 'wrapMode', type: 'enum', options: [{ label: 'Once', value: 'once' }, { label: 'Loop', value: 'loop' }, { label: 'Ping Pong', value: 'pingPong' }] },
    ],
};

export const timelinePlugin: EditorPlugin = {
    name: 'timeline',
    register() {
        registerComponentSchema(TimelinePlayerSchema);
    },
};
