// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectSettings.ts — project-scoped settings, persisted to
 *        project.esproject (the editorSettings.ts extension point for project/
 *        plugin sections). Registered as a side effect; SettingsDialog renders
 *        them under the "Project" category with no UI change. Bound to
 *        ProjectStore, which owns manifest read/write.
 */
import { settingsRegistry } from './registry';
import { ProjectStore } from '@/project/ProjectStore';

// ── Physics (the enable flag = UE Plugins-Browser analog; gravity = Project Settings) ──
settingsRegistry.registerSection({ id: 'physics', label: 'Physics', category: 'project', order: 1 });

// ── Rendering (named sorting layers feed the inspector's render `layer` dropdown) ──
settingsRegistry.registerSection({ id: 'rendering', label: 'Rendering', category: 'project', order: 2 });

settingsRegistry.register({
  id: 'project.rendering.sortingLayers',
  type: 'stringList',
  scope: 'project',
  section: 'rendering',
  group: 'Sorting Layers',
  label: 'Layer names',
  description: 'Name render sorting layers (lowest first); a render `layer` field then picks from them instead of a raw number.',
  count: 8,
  placeholder: (i) => `Layer ${i}`,
  default: Array.from({ length: 8 }, () => ''),
  bind: {
    get: () => ProjectStore.renderingFeature().sortingLayers,
    set: (v) => void ProjectStore.setRendering({ sortingLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.enabled',
  type: 'boolean',
  scope: 'project',
  section: 'physics',
  group: 'Physics',
  label: 'Enable physics',
  description: 'Install the Box2D world when this project plays — required for bodies a script spawns at runtime.',
  default: false,
  bind: {
    get: () => ProjectStore.physicsFeature().enabled,
    set: (v) => void ProjectStore.setPhysics({ enabled: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.gravityX',
  type: 'number',
  scope: 'project',
  section: 'physics',
  group: 'Gravity',
  label: 'Gravity X',
  default: 0,
  step: 0.1,
  bind: {
    get: () => ProjectStore.physicsFeature().gravity.x,
    set: (v) => void ProjectStore.setPhysics({ gravity: { ...ProjectStore.physicsFeature().gravity, x: v } }),
  },
});

settingsRegistry.register({
  id: 'project.physics.collisionLayers',
  type: 'stringList',
  scope: 'project',
  section: 'physics',
  group: 'Collision Layers',
  label: 'Layer names',
  description: 'Names for the 16 collision-filter layers — shown in collider Category/Mask pickers.',
  count: 16,
  placeholder: (i) => `Layer ${i}`,
  default: Array.from({ length: 16 }, (_, i) => (i === 0 ? 'Default' : '')),
  bind: {
    get: () => ProjectStore.physicsFeature().collisionLayers,
    set: (v) => void ProjectStore.setPhysics({ collisionLayers: v }),
  },
});

// ── Packaging (per-platform Project Settings; read by the export, persisted to project.esproject) ──
settingsRegistry.registerSection({ id: 'packaging', label: 'Packaging', category: 'project', order: 3 });

const ORIENTATION = [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }];

settingsRegistry.register({
  id: 'project.packaging.wechat.appid',
  type: 'string', scope: 'project', section: 'packaging', group: 'WeChat',
  label: 'AppID',
  description: 'Your WeChat MiniGame appid — written into project.config.json on export.',
  placeholder: 'wx0123456789abcdef', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().wechat?.appid ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('wechat', { appid: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.wechat.orientation',
  type: 'enum', scope: 'project', section: 'packaging', group: 'WeChat',
  label: 'Orientation', options: ORIENTATION, segmented: true, default: 'portrait',
  bind: {
    get: () => ProjectStore.platformPackaging().wechat?.orientation ?? 'portrait',
    set: (v) => void ProjectStore.setPlatformPackaging('wechat', { orientation: v as 'portrait' | 'landscape' }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.desktop.appId',
  type: 'string', scope: 'project', section: 'packaging', group: 'Desktop',
  label: 'App ID',
  description: 'Reverse-DNS id for the installer (electron-builder appId), e.g. com.studio.game.',
  placeholder: 'com.studio.game', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().desktop?.appId ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('desktop', { appId: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.desktop.productName',
  type: 'string', scope: 'project', section: 'packaging', group: 'Desktop',
  label: 'Product name',
  description: 'Display name for the desktop app + installer (defaults to the project name).',
  placeholder: '(project name)', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().desktop?.productName ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('desktop', { productName: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.playable.orientation',
  type: 'enum', scope: 'project', section: 'packaging', group: 'Playable',
  label: 'Orientation', options: ORIENTATION, segmented: true, default: 'portrait',
  bind: {
    get: () => ProjectStore.platformPackaging().playable?.orientation ?? 'portrait',
    set: (v) => void ProjectStore.setPlatformPackaging('playable', { orientation: v as 'portrait' | 'landscape' }),
  },
});

settingsRegistry.register({
  id: 'project.physics.gravityY',
  type: 'number',
  scope: 'project',
  section: 'physics',
  group: 'Gravity',
  label: 'Gravity Y',
  description: 'Negative pulls down (Box2D default −9.81).',
  default: -9.81,
  step: 0.1,
  bind: {
    get: () => ProjectStore.physicsFeature().gravity.y,
    set: (v) => void ProjectStore.setPhysics({ gravity: { ...ProjectStore.physicsFeature().gravity, y: v } }),
  },
});
