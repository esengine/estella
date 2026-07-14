// SPDX-License-Identifier: Apache-2.0
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
import { EngineHost } from '@/engine/EngineHost';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

// ── Display (design/reference resolution; seeds new Canvas entities) ──
settingsRegistry.registerSection({ id: 'display', label: t('set.section.display'), category: 'project', order: 0 });

settingsRegistry.register({
  id: 'project.display.width',
  type: 'number', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.width'), suffix: 'px',
  description: t('set.project.display.width.desc'),
  default: 1920, min: 1, step: 1,
  bind: {
    get: () => ProjectStore.designResolution().width,
    set: (v) => void ProjectStore.setDisplay({ width: Math.round(v) }),
  },
});

settingsRegistry.register({
  id: 'project.display.height',
  type: 'number', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.height'), suffix: 'px',
  default: 1080, min: 1, step: 1,
  bind: {
    get: () => ProjectStore.designResolution().height,
    set: (v) => void ProjectStore.setDisplay({ height: Math.round(v) }),
  },
});

// ── Physics (the enable flag = UE Plugins-Browser analog; gravity = Project Settings) ──
settingsRegistry.registerSection({ id: 'physics', label: t('set.section.physics'), category: 'project', order: 1 });

// ── Rendering (named sorting layers feed the inspector's render `layer` dropdown) ──
settingsRegistry.registerSection({ id: 'rendering', label: t('set.section.rendering'), category: 'project', order: 2 });

settingsRegistry.register({
  id: 'project.rendering.sortingLayers',
  type: 'stringList',
  scope: 'project',
  section: 'rendering',
  group: t('set.group.sortingLayers'),
  label: t('set.project.rendering.sortingLayers'),
  description: t('set.project.rendering.sortingLayers.desc'),
  count: 8,
  placeholder: (i) => t('set.layerN', { i }),
  default: Array.from({ length: 8 }, () => ''),
  bind: {
    get: () => ProjectStore.renderingFeature().sortingLayers,
    set: (v) => void ProjectStore.setRendering({ sortingLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.rendering.colorSpace',
  type: 'enum',
  scope: 'project',
  section: 'rendering',
  group: t('set.group.colorSpace'),
  label: t('set.project.rendering.colorSpace'),
  description: t('set.project.rendering.colorSpace.desc'),
  default: 'gamma',
  segmented: true,
  options: [
    { value: 'gamma', label: t('set.project.rendering.colorSpace.gamma') },
    { value: 'linear', label: t('set.project.rendering.colorSpace.linear') },
  ],
  bind: {
    get: () => ProjectStore.renderingFeature().colorSpace,
    // Shaders compile against the color space, so it is fixed at engine boot —
    // persist, then prompt for a reload when it differs from the live frame
    // (the renderer.backend precedent).
    set: (v) => {
      void ProjectStore.setRendering({ colorSpace: v as 'gamma' | 'linear' });
      if (v !== EngineHost.activeColorSpace) {
        Toasts.push(t('toast.colorSpaceReload'), 'info', 8000,
          { label: t('ui.reloadNow'), run: () => location.reload() });
      }
    },
  },
});

settingsRegistry.register({
  id: 'project.rendering.ySortLayers',
  type: 'flagList',
  scope: 'project',
  section: 'rendering',
  group: t('set.group.ySort'),
  label: t('set.project.rendering.ySortLayers'),
  description: t('set.project.rendering.ySortLayers.desc'),
  count: 8,
  labels: () => ProjectStore.renderingFeature().sortingLayers,
  default: [],
  bind: {
    get: () => ProjectStore.renderingFeature().ySortLayers,
    set: (v) => void ProjectStore.setRendering({ ySortLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.enabled',
  type: 'boolean',
  scope: 'project',
  section: 'physics',
  group: t('set.group.physics'),
  label: t('set.project.physics.enabled'),
  description: t('set.project.physics.enabled.desc'),
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
  group: t('set.group.gravity'),
  label: t('set.project.physics.gravityX'),
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
  group: t('set.group.collisionLayers'),
  label: t('set.project.physics.collisionLayers'),
  description: t('set.project.physics.collisionLayers.desc'),
  count: 16,
  placeholder: (i) => t('set.layerN', { i }),
  default: Array.from({ length: 16 }, (_, i) => (i === 0 ? 'Default' : '')),
  bind: {
    get: () => ProjectStore.physicsFeature().collisionLayers,
    set: (v) => void ProjectStore.setPhysics({ collisionLayers: v }),
  },
});

settingsRegistry.register({
  id: 'project.physics.collisionMatrix',
  type: 'matrix',
  scope: 'project',
  section: 'physics',
  group: t('set.group.collisionLayers'),
  label: t('set.project.physics.collisionMatrix'),
  description: t('set.project.physics.collisionMatrix.desc'),
  count: 16,
  labels: () => ProjectStore.physicsFeature().collisionLayers,
  default: Array.from({ length: 16 }, () => 0xffff),
  bind: {
    get: () => ProjectStore.physicsFeature().collisionLayerMasks,
    set: (v) => void ProjectStore.setPhysics({ collisionLayerMasks: v }),
  },
});

// ── Packaging (per-platform Project Settings; read by the export, persisted to project.esproject) ──
settingsRegistry.registerSection({ id: 'packaging', label: t('set.section.packaging'), category: 'project', order: 3 });

const ORIENTATION = [
  { value: 'portrait', label: t('set.orientation.portrait') },
  { value: 'landscape', label: t('set.orientation.landscape') },
];

settingsRegistry.register({
  id: 'project.packaging.wechat.appid',
  type: 'string', scope: 'project', section: 'packaging', group: t('set.group.wechat'),
  label: t('set.project.packaging.wechat.appid'),
  description: t('set.project.packaging.wechat.appid.desc'),
  placeholder: 'wx0123456789abcdef', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().wechat?.appid ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('wechat', { appid: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.wechat.orientation',
  type: 'enum', scope: 'project', section: 'packaging', group: t('set.group.wechat'),
  label: t('set.project.packaging.orientation'), options: ORIENTATION, segmented: true, default: 'portrait',
  bind: {
    get: () => ProjectStore.platformPackaging().wechat?.orientation ?? 'portrait',
    set: (v) => void ProjectStore.setPlatformPackaging('wechat', { orientation: v as 'portrait' | 'landscape' }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.desktop.appId',
  type: 'string', scope: 'project', section: 'packaging', group: t('set.group.desktop'),
  label: t('set.project.packaging.desktop.appId'),
  description: t('set.project.packaging.desktop.appId.desc'),
  placeholder: 'com.studio.game', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().desktop?.appId ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('desktop', { appId: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.desktop.productName',
  type: 'string', scope: 'project', section: 'packaging', group: t('set.group.desktop'),
  label: t('set.project.packaging.desktop.productName'),
  description: t('set.project.packaging.desktop.productName.desc'),
  placeholder: '(project name)', default: '',
  bind: {
    get: () => ProjectStore.platformPackaging().desktop?.productName ?? '',
    set: (v) => void ProjectStore.setPlatformPackaging('desktop', { productName: v }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.playable.orientation',
  type: 'enum', scope: 'project', section: 'packaging', group: t('set.group.playable'),
  label: t('set.project.packaging.orientation'), options: ORIENTATION, segmented: true, default: 'portrait',
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
  group: t('set.group.gravity'),
  label: t('set.project.physics.gravityY'),
  description: t('set.project.physics.gravityY.desc'),
  default: -9.81,
  step: 0.1,
  bind: {
    get: () => ProjectStore.physicsFeature().gravity.y,
    set: (v) => void ProjectStore.setPhysics({ gravity: { ...ProjectStore.physicsFeature().gravity, y: v } }),
  },
});

// ── Solver (world simulation tuning; absent ⇒ engine defaults) ──
settingsRegistry.register({
  id: 'project.physics.fixedTimestep',
  type: 'number', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.fixedTimestep'), suffix: 's',
  description: t('set.project.physics.fixedTimestep.desc'),
  default: 1 / 60, min: 0.001, step: 0.001,
  bind: {
    get: () => ProjectStore.physicsFeature().fixedTimestep,
    set: (v) => void ProjectStore.setPhysics({ fixedTimestep: v }),
  },
});
settingsRegistry.register({
  id: 'project.physics.subStepCount',
  type: 'number', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.subStepCount'),
  description: t('set.project.physics.subStepCount.desc'),
  default: 4, min: 1, max: 8, step: 1,
  bind: {
    get: () => ProjectStore.physicsFeature().subStepCount,
    set: (v) => void ProjectStore.setPhysics({ subStepCount: Math.round(v) }),
  },
});
settingsRegistry.register({
  id: 'project.physics.contactHertz',
  type: 'number', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.contactHertz'),
  description: t('set.project.physics.contactHertz.desc'),
  default: 120, min: 1, step: 1,
  bind: {
    get: () => ProjectStore.physicsFeature().contactHertz,
    set: (v) => void ProjectStore.setPhysics({ contactHertz: v }),
  },
});
settingsRegistry.register({
  id: 'project.physics.contactDampingRatio',
  type: 'number', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.contactDampingRatio'),
  description: t('set.project.physics.contactDampingRatio.desc'),
  default: 10, min: 0, step: 0.5,
  bind: {
    get: () => ProjectStore.physicsFeature().contactDampingRatio,
    set: (v) => void ProjectStore.setPhysics({ contactDampingRatio: v }),
  },
});
settingsRegistry.register({
  id: 'project.physics.contactSpeed',
  type: 'number', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.contactSpeed'), suffix: 'm/s',
  description: t('set.project.physics.contactSpeed.desc'),
  default: 10, min: 0, step: 0.5,
  bind: {
    get: () => ProjectStore.physicsFeature().contactSpeed,
    set: (v) => void ProjectStore.setPhysics({ contactSpeed: v }),
  },
});
settingsRegistry.register({
  id: 'project.physics.enableSleep',
  type: 'boolean', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.enableSleep'),
  description: t('set.project.physics.enableSleep.desc'),
  default: true,
  bind: {
    get: () => ProjectStore.physicsFeature().enableSleep,
    set: (v) => void ProjectStore.setPhysics({ enableSleep: v }),
  },
});
settingsRegistry.register({
  id: 'project.physics.enableContinuous',
  type: 'boolean', scope: 'project', section: 'physics', group: t('set.group.solver'),
  label: t('set.project.physics.enableContinuous'),
  description: t('set.project.physics.enableContinuous.desc'),
  default: true,
  bind: {
    get: () => ProjectStore.physicsFeature().enableContinuous,
    set: (v) => void ProjectStore.setPhysics({ enableContinuous: v }),
  },
});
