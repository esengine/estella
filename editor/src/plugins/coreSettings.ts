import type { EditorPlugin, EditorPluginContext } from './EditorPlugin';
import type { SettingsItemType, SettingsSectionDescriptor, SettingsGroupDescriptor, SettingsItemDescriptor } from '../settings/SettingsRegistry';
import { SETTINGS_SECTION, SETTINGS_GROUP, SETTINGS_ITEM } from '../container/tokens';
import { DEFAULT_DESIGN_WIDTH, DEFAULT_DESIGN_HEIGHT } from 'esengine';
import { renderCollisionMatrix } from '../settings/CollisionMatrixWidget';
import { MAX_COLLISION_LAYERS } from '../settings/collisionLayers';

export const coreSettingsPlugin: EditorPlugin = {
    name: 'core-settings',
    register(ctx: EditorPluginContext) {
        const registerSettingsSection = (d: SettingsSectionDescriptor) => ctx.registrar.provide(SETTINGS_SECTION, d.id, d);
        const registerSettingsGroup = (d: SettingsGroupDescriptor) => ctx.registrar.provide(SETTINGS_GROUP, d.id, d);
        const registerSettingsItem = (d: SettingsItemDescriptor) => ctx.registrar.provide(SETTINGS_ITEM, d.id, d);

        registerSettingsSection({ id: 'general', title: 'General', icon: 'settings', order: 0 });
        registerSettingsSection({ id: 'project', title: 'Project', icon: 'folder', order: 2 });
        registerSettingsSection({ id: 'rendering', title: 'Rendering', icon: 'image', order: 2.5 });
        registerSettingsSection({ id: 'physics', title: 'Physics', icon: 'zap', order: 3 });
        registerSettingsSection({ id: 'build', title: 'Build', icon: 'package', order: 4 });
        registerSettingsSection({ id: 'asset-loading', title: 'Asset Loading', icon: 'download', order: 6.5 });
        registerSettingsSection({ id: 'network', title: 'Network', icon: 'globe', order: 7 });

        registerSettingsGroup({ id: 'physics.collision-layers', section: 'physics', label: 'Collision Layers', order: 10, collapsed: true });
        registerSettingsGroup({ id: 'physics.collision-matrix', section: 'physics', label: 'Collision Matrix', order: 11 });

        registerSettingsItem({ id: 'general.language', section: 'general', label: 'Language', type: 'select', defaultValue: 'en', order: 0, options: [{ label: 'English', value: 'en' }] });
        registerSettingsItem({ id: 'general.previewPort', section: 'general', label: 'Preview Port', type: 'number', defaultValue: 3456, min: 1024, max: 65535, step: 1, order: 1 });

        registerSettingsItem({ id: 'project.spineVersion', section: 'project', label: 'Spine Version', type: 'select', defaultValue: 'none', order: 0, projectSync: true, options: [{ label: 'None', value: 'none' }, { label: 'Spine 4.2', value: '4.2' }, { label: 'Spine 4.1', value: '4.1' }, { label: 'Spine 3.8', value: '3.8' }] });
        registerSettingsItem({ id: 'project.name', section: 'project', label: 'Project Name', type: 'string', defaultValue: '', order: 1, projectSync: true });
        registerSettingsItem({ id: 'project.version', section: 'project', label: 'Version', type: 'string', defaultValue: '', order: 2, projectSync: true });
        registerSettingsItem({ id: 'project.defaultScene', section: 'project', label: 'Default Scene', type: 'string', defaultValue: '', order: 3, projectSync: true });
        registerSettingsItem({ id: 'project.designWidth', section: 'project', label: 'Design Width', type: 'number', defaultValue: DEFAULT_DESIGN_WIDTH, min: 1, step: 1, order: 4, projectSync: true });
        registerSettingsItem({ id: 'project.designHeight', section: 'project', label: 'Design Height', type: 'number', defaultValue: DEFAULT_DESIGN_HEIGHT, min: 1, step: 1, order: 5, projectSync: true });
        registerSettingsItem({ id: 'project.enablePhysics', section: 'physics', label: 'Enable Physics', type: 'boolean', defaultValue: false, order: 0, projectSync: true });

        registerSettingsItem({ id: 'rendering.defaultSpriteWidth', section: 'rendering', label: 'Default Sprite Width', description: 'Default width for new sprites in pixels', type: 'number', defaultValue: 100, min: 1, max: 4096, step: 1, order: 0, projectSync: true });
        registerSettingsItem({ id: 'rendering.defaultSpriteHeight', section: 'rendering', label: 'Default Sprite Height', description: 'Default height for new sprites in pixels', type: 'number', defaultValue: 100, min: 1, max: 4096, step: 1, order: 1, projectSync: true });
        registerSettingsItem({ id: 'rendering.pixelsPerUnit', section: 'rendering', label: 'Pixels Per Unit', description: 'Number of pixels per world unit', type: 'number', defaultValue: 100, min: 1, max: 1000, step: 1, order: 2, projectSync: true });

        const COLLISION_LAYER_DEFAULTS = ['Default', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
        for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
            registerSettingsItem({ id: `physics.layerName${i}`, section: 'physics', group: 'physics.collision-layers', label: `Layer ${i}`, type: 'string', defaultValue: COLLISION_LAYER_DEFAULTS[i], order: i, projectSync: true, tags: ['collision', 'layer'] });
            registerSettingsItem({ id: `physics.layerMask${i}`, section: 'physics', label: `Layer ${i} Mask`, type: 'number', defaultValue: 0xFFFF, hidden: true, projectSync: true });
        }

        registerSettingsItem({ id: 'physics.collisionMatrix', section: 'physics', group: 'physics.collision-matrix', label: 'Collision Matrix', type: 'custom' as SettingsItemType, defaultValue: null, render: renderCollisionMatrix, tags: ['collision', 'matrix', 'layer'] });
        registerSettingsItem({ id: 'physics.gravityX', section: 'physics', label: 'Gravity X', type: 'number', defaultValue: 0, step: 0.1, order: 1, projectSync: true });
        registerSettingsItem({ id: 'physics.gravityY', section: 'physics', label: 'Gravity Y', type: 'number', defaultValue: -9.81, step: 0.1, order: 2, projectSync: true });
        registerSettingsItem({ id: 'physics.fixedTimestep', section: 'physics', label: 'Fixed Timestep', description: 'Maximum simulation time step in seconds', type: 'number', defaultValue: 1 / 60, step: 0.001, min: 0.001, order: 3, projectSync: true });
        registerSettingsItem({ id: 'physics.subStepCount', section: 'physics', label: 'Sub-Step Count', description: 'Maximum physics sub-steps per frame', type: 'number', defaultValue: 4, step: 1, min: 1, max: 16, order: 4, projectSync: true });
        registerSettingsItem({ id: 'physics.contactHertz', section: 'physics', label: 'Contact Hertz', description: 'Contact stiffness (cycles/sec). Higher = less overlap but more jitter', type: 'number', defaultValue: 30, step: 10, min: 1, max: 500, order: 5, projectSync: true });
        registerSettingsItem({ id: 'physics.contactDampingRatio', section: 'physics', label: 'Contact Damping Ratio', description: 'Contact bounciness damping. Lower = faster overlap recovery but more energetic', type: 'number', defaultValue: 10, step: 1, min: 0.1, max: 100, order: 6, projectSync: true });
        registerSettingsItem({ id: 'physics.contactSpeed', section: 'physics', label: 'Contact Speed', description: 'Max overlap resolution speed (m/s)', type: 'number', defaultValue: 3, step: 1, min: 1, max: 100, order: 7, projectSync: true });

        registerSettingsItem({ id: 'build.atlasMaxSize', section: 'build', label: 'Atlas Max Size', type: 'select', defaultValue: '2048', order: 0, projectSync: true, options: [{ label: '512', value: '512' }, { label: '1024', value: '1024' }, { label: '2048', value: '2048' }, { label: '4096', value: '4096' }] });
        registerSettingsItem({ id: 'build.atlasPadding', section: 'build', label: 'Atlas Padding', type: 'number', defaultValue: 2, min: 0, max: 16, step: 1, order: 1, projectSync: true });

        registerSettingsItem({ id: 'asset.timeout', section: 'asset-loading', label: 'Load Timeout', description: 'Maximum time to wait for an asset load in milliseconds', type: 'number', defaultValue: 30000, min: 1000, max: 120000, step: 1000, order: 0, projectSync: true });
        registerSettingsItem({ id: 'asset.failureCooldown', section: 'asset-loading', label: 'Failure Cooldown', description: 'Time to wait before retrying a failed asset load in milliseconds', type: 'number', defaultValue: 5000, min: 0, max: 60000, step: 1000, order: 1, projectSync: true });

        registerSettingsItem({ id: 'network.proxy', section: 'network', label: 'HTTP Proxy', description: 'Proxy for update downloads (e.g. http://127.0.0.1:7890)', type: 'string', defaultValue: '', order: 0 });
    },
};
