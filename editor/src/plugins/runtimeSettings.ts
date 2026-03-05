import type { EditorPlugin } from './EditorPlugin';
import {
    registerSettingsSection,
    registerSettingsGroup,
    registerSettingsItem,
} from '../settings/SettingsRegistry';

export const runtimeSettingsPlugin: EditorPlugin = {
    name: 'runtime-settings',
    dependencies: ['core-settings'],
    register() {
        registerSettingsSection({ id: 'runtime', title: 'Runtime', icon: 'play', order: 5 });

        registerSettingsGroup({ id: 'runtime.canvas', section: 'runtime', label: 'Canvas', order: 0 });
        registerSettingsGroup({ id: 'runtime.timing', section: 'runtime', label: 'Timing', order: 1 });
        registerSettingsGroup({ id: 'runtime.scene-transitions', section: 'runtime', label: 'Scene Transitions', order: 2 });

        registerSettingsItem({ id: 'runtime.sceneTransitionDuration', section: 'runtime', group: 'runtime.scene-transitions', label: 'Scene Transition Duration', description: 'Fade duration when switching scenes, in seconds', type: 'number', defaultValue: 0.3, min: 0, max: 5, step: 0.1, order: 0, projectSync: true });
        registerSettingsItem({ id: 'runtime.sceneTransitionColor', section: 'runtime', group: 'runtime.scene-transitions', label: 'Scene Transition Color', description: 'Background color during scene transitions', type: 'color', defaultValue: '#000000', order: 1, projectSync: true });

        registerSettingsItem({ id: 'runtime.defaultFontFamily', section: 'runtime', label: 'Default Font Family', description: 'Fallback font used for text rendering', type: 'string', defaultValue: 'Arial', order: 2, projectSync: true });
        registerSettingsItem({ id: 'runtime.textCanvasSize', section: 'runtime', label: 'Text Canvas Size', type: 'select', defaultValue: '512', order: 3, projectSync: true, options: [{ label: '256', value: '256' }, { label: '512', value: '512' }, { label: '1024', value: '1024' }, { label: '2048', value: '2048' }] });

        registerSettingsItem({ id: 'runtime.canvasScaleMode', section: 'runtime', group: 'runtime.canvas', label: 'Canvas Scale Mode', description: 'How the canvas adapts to different screen sizes', type: 'select', defaultValue: 'FixedHeight', order: 0, projectSync: true, options: [{ label: 'Fixed Width', value: 'FixedWidth' }, { label: 'Fixed Height', value: 'FixedHeight' }, { label: 'Expand', value: 'Expand' }, { label: 'Shrink', value: 'Shrink' }, { label: 'Match', value: 'Match' }] });
        registerSettingsItem({ id: 'runtime.canvasMatchWidthOrHeight', section: 'runtime', group: 'runtime.canvas', label: 'Canvas Match W/H', description: 'Blend between matching width (0) and height (1)', type: 'range', defaultValue: 0.5, min: 0, max: 1, step: 0.1, order: 1, projectSync: true, visibleWhen: { settingId: 'runtime.canvasScaleMode', value: 'Match' } });

        registerSettingsItem({ id: 'runtime.maxDeltaTime', section: 'runtime', group: 'runtime.timing', label: 'Max Delta Time', description: 'Maximum allowed frame delta time in seconds', type: 'number', defaultValue: 0.25, min: 0.01, max: 1, step: 0.01, order: 0, projectSync: true });
        registerSettingsItem({ id: 'runtime.maxFixedSteps', section: 'runtime', group: 'runtime.timing', label: 'Max Fixed Steps', description: 'Maximum fixed update iterations per frame', type: 'number', defaultValue: 8, min: 1, max: 64, step: 1, order: 1, projectSync: true });
    },
};
