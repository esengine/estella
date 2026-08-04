// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  projectSettings.ts — project-scoped settings, persisted to
 *        project.esproject (the editorSettings.ts extension point for project/
 *        plugin sections). Registered as a side effect; SettingsDialog renders
 *        them under the "Project" category with no UI change. Bound to
 *        ProjectStore, which owns manifest read/write.
 */
import { resolveThemeTokens, THEME_COLOR_ROLES } from 'esengine';
import { settingsRegistry } from './registry';
import { ProjectStore } from '@/project/ProjectStore';
import { rgbaToHex8 } from '@/components/ColorControl';
import { EngineHost } from '@/engine/EngineHost';
import { Toasts } from '@/store/Toasts';
import { useEditorMode } from '@/store/editorModeStore';
import { SORTING_LAYER_COUNT, type ScreenOrientation, type CameraScaleMode, type ScreenPreset } from '@/project/format';
import { t } from '@/i18n';

const ORIENTATION = [
  { value: 'portrait', label: t('set.orientation.portrait') },
  { value: 'landscape', label: t('set.orientation.landscape') },
];

const CAMERA_FIT = [
  { value: 'none', label: t('set.cameraFit.none') },
  { value: 'fixed-height', label: t('set.cameraFit.fixedHeight') },
  { value: 'fixed-width', label: t('set.cameraFit.fixedWidth') },
  { value: 'expand', label: t('set.cameraFit.expand') },
  { value: 'shrink', label: t('set.cameraFit.shrink') },
  { value: 'match', label: t('set.cameraFit.match') },
];

// ── Display (design/reference resolution + orientation; screen shape) ──
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

/**
 * What gets persisted for one row: an all-zero (or half-filled) inset is dropped
 * rather than written, because "no safe area" and "a safe area of nothing" are
 * the same screen, and only one of them should appear in the project file.
 */
function normalizeScreenPreset(p: ScreenPreset): ScreenPreset {
  const s = p.safe;
  const edges = s ? [s.top, s.bottom, s.left, s.right].map((n) => (Number.isFinite(n) ? Number(n) : 0)) : [];
  if (edges.length === 0 || edges.every((n) => n <= 0)) {
    const { safe: _drop, ...rest } = p;
    return rest;
  }
  const [top, bottom, left, right] = edges.map((n) => Math.max(0, n));
  return { ...p, safe: { top, bottom, left, right } };
}

// The screens this project tests on. The built-in device list is a guess; a team
// that ships to specific hardware corrects it here, and an entry reusing a
// built-in id replaces that built-in rather than sitting beside it.
settingsRegistry.register({
  id: 'project.display.screenPresets',
  type: 'objectList', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.screenPresets'),
  description: t('set.project.display.screenPresets.desc'),
  layout: 'block',
  default: [],
  columns: [
    { key: 'id', label: t('set.screenPreset.id'), type: 'text', width: '120px', placeholder: 'my-device' },
    { key: 'label', label: t('set.screenPreset.label'), type: 'text', width: '1fr', placeholder: 'My Device' },
    { key: 'width', label: t('set.screenPreset.width'), type: 'number', width: '84px', min: 1 },
    { key: 'height', label: t('set.screenPreset.height'), type: 'number', width: '84px', min: 1 },
  ],
  // Safe-area insets ride in an expander: most screens have none, and four more
  // columns would widen every row to serve the few that do.
  detailColumns: [
    { key: 'safe.top', label: t('set.screenPreset.safeTop'), type: 'number', width: '72px', min: 0 },
    { key: 'safe.bottom', label: t('set.screenPreset.safeBottom'), type: 'number', width: '72px', min: 0 },
    { key: 'safe.left', label: t('set.screenPreset.safeLeft'), type: 'number', width: '72px', min: 0 },
    { key: 'safe.right', label: t('set.screenPreset.safeRight'), type: 'number', width: '72px', min: 0 },
  ],
  detailLabel: t('set.screenPreset.safeArea'),
  addLabel: t('set.screenPreset.add'),
  emptyHint: t('set.screenPreset.empty'),
  // Portrait storage keeps one meaning for the orientation toggle across the
  // built-ins and a project's own, so a swap is always the same operation.
  newRow: () => ({ id: '', label: '', width: 1080, height: 1920 }),
  rowError: (row, all) => {
    const id = String(row.id ?? '').trim();
    if (!id) return t('set.screenPreset.errId');
    if (all.filter((r) => String(r.id ?? '').trim() === id).length > 1) return t('set.screenPreset.errDup');
    if (!(Number(row.width) > 0) || !(Number(row.height) > 0)) return t('set.screenPreset.errSize');
    return null;
  },
  bind: {
    get: () => ProjectStore.screenPresets() as unknown as Record<string, unknown>[],
    set: (v) => void ProjectStore.setScreenPresets((v as unknown as ScreenPreset[]).map(normalizeScreenPreset)),
  },
});

// Project-wide screen orientation — one value every export target reads (WeChat
// game.json, the web/playable rotate hint, the desktop window aspect). Shown as the
// resolved value (explicit, else derived from the design resolution's aspect); the
// segmented control's default is only the fallback before a project loads.
settingsRegistry.register({
  id: 'project.display.orientation',
  type: 'enum', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.orientation'),
  description: t('set.project.display.orientation.desc'),
  options: ORIENTATION, segmented: true, default: 'landscape',
  bind: {
    get: () => ProjectStore.resolvedOrientation(),
    set: (v) => {
      void ProjectStore.setPackaging({ orientation: v as ScreenOrientation });
      // Keep the editor's device preview in lockstep with the shipped orientation.
      useEditorMode.setState({ orientation: v as ScreenOrientation });
    },
  },
});

// Camera fit — how the MAIN camera scales the design resolution, independent of any UI
// Canvas. 'None' (default) keeps the raw orthoSize (zero regression); any other mode
// letterboxes every target + the editor device preview. The sibling of a UI CanvasScaler.
settingsRegistry.register({
  id: 'project.display.cameraFit',
  type: 'enum', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.cameraFit'),
  description: t('set.project.display.cameraFit.desc'),
  options: CAMERA_FIT, default: 'none',
  bind: {
    get: () => ProjectStore.renderingFeature().cameraScaleMode,
    set: (v) => void ProjectStore.setRendering({ cameraScaleMode: v as CameraScaleMode }),
  },
});

settingsRegistry.register({
  id: 'project.display.cameraMatch',
  type: 'number', scope: 'project', section: 'display', group: t('set.group.designResolution'),
  label: t('set.project.display.cameraMatch'),
  description: t('set.project.display.cameraMatch.desc'),
  default: 0.5, min: 0, max: 1, step: 0.05,
  bind: {
    get: () => ProjectStore.renderingFeature().cameraMatch,
    set: (v) => void ProjectStore.setRendering({ cameraMatch: v }),
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
  layout: 'block',
  count: SORTING_LAYER_COUNT,
  placeholder: (i) => t('set.layerN', { i }),
  default: Array.from({ length: SORTING_LAYER_COUNT }, () => ''),
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
  count: SORTING_LAYER_COUNT,
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
settingsRegistry.registerSection({ id: 'ui', label: t('set.section.ui'), category: 'project', order: 3 });

settingsRegistry.register({
  id: 'project.ui.theme',
  type: 'enum',
  scope: 'project',
  section: 'ui',
  group: t('set.group.uiTheme'),
  label: t('set.project.ui.theme'),
  description: t('set.project.ui.theme.desc'),
  default: 'dark',
  segmented: true,
  options: [
    { value: 'dark', label: t('set.project.ui.theme.dark') },
    { value: 'light', label: t('set.project.ui.theme.light') },
  ],
  bind: {
    get: () => ProjectStore.uiTheme(),
    set: (v) => { void ProjectStore.setUiTheme(v as 'dark' | 'light'); },
  },
});

// Per-role token overrides — one picker per semantic color. Unset (the default)
// inherits the base theme's value, shown as the picker's placeholder; the row's
// standard reset affordance clears the override. Live-applied to the edit world
// by ProjectStore.patchUiFeature_ → applyWidgetTheme.
const roleLabel = (role: string): string => role.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
for (const role of THEME_COLOR_ROLES) {
  settingsRegistry.register({
    id: `project.ui.color.${role}`,
    type: 'colorpicker',
    scope: 'project',
    section: 'ui',
    group: t('set.group.uiThemeColors'),
    label: roleLabel(role),
    ...(role === 'surface' ? { description: t('set.project.ui.color.desc') } : {}),
    default: '',
    placeholderColor: () => {
      const c = resolveThemeTokens(ProjectStore.uiTheme()).colors[role];
      return rgbaToHex8(c.r, c.g, c.b, c.a);
    },
    bind: {
      get: () => ProjectStore.uiThemeColors()[role] ?? '',
      set: (v) => { void ProjectStore.setUiThemeColor(role, v || null); },
    },
  });
}

settingsRegistry.registerSection({ id: 'packaging', label: t('set.section.packaging'), category: 'project', order: 4 });

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

// The application identifier every installable target needs. One project ships as
// one application, so it is declared once; a target that genuinely differs
// overrides it below. Absent ⇒ derived from the project name, so a build always
// has something to sign — but a shipped app should say its own.
settingsRegistry.register({
  id: 'project.packaging.appId',
  type: 'string', scope: 'project', section: 'packaging', group: t('set.group.application'),
  label: t('set.project.packaging.appId'),
  description: t('set.project.packaging.appId.desc'),
  placeholder: 'com.studio.game', default: '',
  bind: {
    get: () => ProjectStore.packagingSettings().appId ?? '',
    set: (v) => void ProjectStore.setPackaging({ appId: v || undefined }),
  },
});

// One icon for every installable target: Android takes it as the launcher mipmap,
// iOS as the asset catalog Xcode derives its sizes from. Nothing resizes it, so
// one large square is all a project keeps.
settingsRegistry.register({
  id: 'project.packaging.icon',
  type: 'string', scope: 'project', section: 'packaging', group: t('set.group.application'),
  label: t('set.project.packaging.icon'),
  description: t('set.project.packaging.icon.desc'),
  placeholder: 'assets/icon.png', default: '',
  bind: {
    get: () => ProjectStore.packagingSettings().icon ?? '',
    set: (v) => void ProjectStore.setPackaging({ icon: v || undefined }),
  },
});

settingsRegistry.register({
  id: 'project.packaging.android.versionCode',
  type: 'number', scope: 'project', section: 'packaging', group: t('set.group.application'),
  label: t('set.project.packaging.android.versionCode'),
  description: t('set.project.packaging.android.versionCode.desc'),
  default: 1, min: 1, step: 1,
  bind: {
    get: () => ProjectStore.platformPackaging().android?.versionCode ?? 1,
    set: (v) => void ProjectStore.setPlatformPackaging('android', { versionCode: Math.max(1, Math.round(v)) }),
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
