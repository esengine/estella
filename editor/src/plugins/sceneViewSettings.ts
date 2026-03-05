import type { EditorPlugin } from './EditorPlugin';
import {
    registerSettingsSection,
    registerSettingsGroup,
    registerSettingsItem,
} from '../settings/SettingsRegistry';

export const sceneViewSettingsPlugin: EditorPlugin = {
    name: 'scene-view-settings',
    dependencies: ['core-settings'],
    register() {
        registerSettingsSection({ id: 'scene-view', title: 'Scene View', icon: 'eye', order: 1 });

        registerSettingsGroup({ id: 'scene-view.grid', section: 'scene-view', label: 'Grid', order: 0 });
        registerSettingsGroup({ id: 'scene-view.overlays', section: 'scene-view', label: 'Overlays', order: 1 });
        registerSettingsGroup({ id: 'scene-view.gizmo-appearance', section: 'scene-view', label: 'Gizmo Appearance', order: 2, collapsed: true });

        registerSettingsItem({ id: 'scene.showGrid', section: 'scene-view', group: 'scene-view.grid', label: 'Show Grid', type: 'boolean', defaultValue: true, order: 0 });
        registerSettingsItem({ id: 'scene.gridColor', section: 'scene-view', group: 'scene-view.grid', label: 'Grid Color', type: 'color', defaultValue: '#333333', order: 1 });
        registerSettingsItem({ id: 'scene.gridOpacity', section: 'scene-view', group: 'scene-view.grid', label: 'Grid Opacity', type: 'range', defaultValue: 1.0, min: 0, max: 1, step: 0.1, order: 2 });
        registerSettingsItem({ id: 'scene.gridSize', section: 'scene-view', group: 'scene-view.grid', label: 'Grid Size', type: 'number', defaultValue: 50, min: 5, max: 500, step: 5, order: 3 });

        registerSettingsItem({ id: 'scene.showGizmos', section: 'scene-view', group: 'scene-view.overlays', label: 'Show Gizmos', type: 'boolean', defaultValue: true, order: 0 });
        registerSettingsItem({ id: 'scene.showSelectionBox', section: 'scene-view', group: 'scene-view.overlays', label: 'Show Selection Box', type: 'boolean', defaultValue: true, order: 1 });
        registerSettingsItem({ id: 'scene.showColliders', section: 'scene-view', group: 'scene-view.overlays', label: 'Show Colliders', type: 'boolean', defaultValue: true, order: 2 });
        registerSettingsItem({ id: 'scene.showStats', section: 'scene-view', group: 'scene-view.overlays', label: 'Show Stats', type: 'boolean', defaultValue: false, order: 3 });

        registerSettingsItem({ id: 'scene.gizmoColorX', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Color X', type: 'color', defaultValue: '#e74c3c', order: 0, tags: ['gizmo', 'color'] });
        registerSettingsItem({ id: 'scene.gizmoColorY', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Color Y', type: 'color', defaultValue: '#2ecc71', order: 1, tags: ['gizmo', 'color'] });
        registerSettingsItem({ id: 'scene.gizmoColorXY', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Color XY', type: 'color', defaultValue: '#f1c40f', order: 2, tags: ['gizmo', 'color'] });
        registerSettingsItem({ id: 'scene.gizmoColorHover', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Color Hover', type: 'color', defaultValue: '#ffffff', order: 3, tags: ['gizmo', 'color'] });
        registerSettingsItem({ id: 'scene.selectionColor', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Selection Color', type: 'color', defaultValue: '#00aaff', order: 4, tags: ['gizmo', 'selection'] });
        registerSettingsItem({ id: 'scene.gizmoHandleSize', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Handle Size', type: 'number', defaultValue: 10, min: 4, max: 24, step: 1, order: 5, tags: ['gizmo'] });
        registerSettingsItem({ id: 'scene.gizmoSize', section: 'scene-view', group: 'scene-view.gizmo-appearance', label: 'Gizmo Size', type: 'number', defaultValue: 80, min: 40, max: 200, step: 5, order: 6, tags: ['gizmo'] });
    },
};
