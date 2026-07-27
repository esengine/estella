// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editorSettings.ts — the editor's built-in settings, registered as a side
 *        effect (import this once at boot). Each is wired to a REAL backing: a CSS
 *        variable, a live store (editorStore), or a subsystem (LogStore). Adding a
 *        setting here makes it appear in SettingsDialog with no UI change.
 *
 * Project- and plugin-scoped sections (physics / render / asset pipeline) plug in
 * the same way once their persistence + backing land — that's the architecture's
 * extension point, not a special case.
 */
import { settingsRegistry } from './registry';
import { useEditorStore } from '@/store/editorStore';
import { LogStore } from '@/store/LogStore';
import { commands } from '@/commands';
import { setUseLessCpuInBackground } from '@/engine/backgroundThrottle';
import { EngineHost } from '@/engine/EngineHost';
import { Toasts } from '@/store/Toasts';
import { t, editorLocale, systemDefaultLocale, EDITOR_LOCALES, LANGUAGE_SETTING_ID } from '@/i18n';

const root = () => document.documentElement.style;

// ── Sections (editor category) ──────────────────────────────────────────────
settingsRegistry.registerSection({ id: 'appearance', label: t('set.section.appearance'), category: 'editor', order: 1 });
settingsRegistry.registerSection({ id: 'viewport', label: t('set.section.viewport'), category: 'editor', order: 2 });
settingsRegistry.registerSection({ id: 'performance', label: t('set.section.performance'), category: 'editor', order: 3 });
settingsRegistry.registerSection({ id: 'shortcuts', label: t('set.section.shortcuts'), category: 'editor', order: 4 });
settingsRegistry.registerSection({ id: 'console', label: t('set.section.console'), category: 'editor', order: 5 });
settingsRegistry.registerSection({ id: 'renderer', label: t('set.section.renderer'), category: 'editor', order: 6 });
// The rows under it are registered by externalPrograms.ts — one per program slot,
// so a contributed slot appears here without this file knowing it exists.
settingsRegistry.registerSection({ id: 'externalTools', label: t('set.section.externalTools'), category: 'editor', order: 7 });

// ── Appearance (store-owned, applied via CSS) ───────────────────────────────
// The session renders in the locale resolved at boot from this same persisted
// value (see i18n/index.ts), so a change only lands after a reload — prompt for
// it. Setting it back before reloading needs no prompt (nothing would change).
settingsRegistry.register({
  id: LANGUAGE_SETTING_ID,
  type: 'enum',
  scope: 'editor',
  section: 'appearance',
  group: t('set.group.appearance'),
  label: t('set.appearance.language'),
  description: t('set.appearance.language.desc'),
  default: systemDefaultLocale,
  options: EDITOR_LOCALES,
  effect: (v) => {
    if (v === editorLocale) return;
    Toasts.push(t('toast.langReload'), 'info', 8000, { label: t('ui.reloadNow'), run: () => location.reload() });
  },
});

// The accent is a family, not one color — hover/pressed shades and the
// translucent selection/focus tints all derive from the chosen hue. On the
// default azure the overrides are removed so the hand-tuned tokens.css values
// stay pixel-exact; other accents derive their shades numerically.
const ACCENT_DEFAULT = '#2f88d6';
const ACCENT_VARS = ['--star', '--acc', '--star-hi', '--star-deep', '--star-dim', '--star-soft', '--star-line'];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

settingsRegistry.register({
  id: 'appearance.accent',
  type: 'color',
  scope: 'editor',
  section: 'appearance',
  group: t('set.group.appearance'),
  label: t('set.appearance.accent'),
  description: t('set.appearance.accent.desc'),
  default: ACCENT_DEFAULT,
  swatches: [ACCENT_DEFAULT, '#46b08c', '#b272d6', '#e08c43', '#c75d6e'],
  effect: (v) => {
    const rgb = hexToRgb(v);
    if (!rgb || v.toLowerCase() === ACCENT_DEFAULT) {
      for (const p of ACCENT_VARS) root().removeProperty(p);
      return;
    }
    const [r, g, b] = rgb;
    const toward = (amt: number) =>
      amt >= 0
        ? `rgb(${rgb.map((c) => Math.round(c + (255 - c) * amt)).join(' ')})`
        : `rgb(${rgb.map((c) => Math.round(c * (1 + amt))).join(' ')})`;
    root().setProperty('--star', v);
    root().setProperty('--acc', v);
    root().setProperty('--star-hi', toward(0.16));
    root().setProperty('--star-deep', toward(-0.25));
    root().setProperty('--star-dim', `rgba(${r}, ${g}, ${b}, 0.18)`);
    root().setProperty('--star-soft', `rgba(${r}, ${g}, ${b}, 0.3)`);
    root().setProperty('--star-line', `rgba(${r}, ${g}, ${b}, 0.55)`);
  },
});

settingsRegistry.register({
  id: 'appearance.uiScale',
  type: 'number',
  scope: 'editor',
  section: 'appearance',
  group: t('set.group.appearance'),
  label: t('set.appearance.uiScale'),
  description: t('set.appearance.uiScale.desc'),
  default: 100,
  min: 80,
  max: 150,
  step: 5,
  slider: true,
  suffix: '%',
  effect: (v) => {
    document.body.style.setProperty('zoom', String(v / 100));
  },
});

// ── Renderer (read at engine boot; the GfxDevice backend seam) ──────────────
// Skips the boot-time effect replay so the reload prompt only fires on a real change.
let backendPrimed = false;
settingsRegistry.register({
  id: 'renderer.backend',
  type: 'enum',
  scope: 'editor',
  section: 'renderer',
  group: t('set.group.renderer'),
  label: t('set.renderer.backend'),
  description: t('set.renderer.backend.desc'),
  default: 'webgl2',
  segmented: true,
  options: [
    { value: 'webgl2', label: 'WebGL2' },
    { value: 'webgpu', label: 'WebGPU' },
  ],
  // The backend is fixed at engine instantiation, so a change applies on reload.
  // Prompt for it — but skip the boot-time replay (the first call), and only when
  // the target differs from the live device. `backendPrimed` is module-local so it
  // resets with a page reload (when applySettings replays effects again).
  effect: (v) => {
    if (!backendPrimed) { backendPrimed = true; return; }
    if (v === EngineHost.activeBackend) return;
    Toasts.push(
      t('toast.backendReload', { backend: v === 'webgpu' ? 'WebGPU' : 'WebGL2' }),
      'info',
      8000,
      { label: t('ui.reloadNow'), run: () => location.reload() },
    );
  },
});

// ── Viewport (bound to editorStore — one source with the viewport toolbar) ───
const ed = () => useEditorStore.getState();

settingsRegistry.register({
  id: 'viewport.showGrid',
  type: 'boolean',
  scope: 'editor',
  section: 'viewport',
  group: t('set.group.grid'),
  label: t('set.viewport.showGrid'),
  default: true,
  bind: { get: () => ed().showGrid, set: (v) => useEditorStore.setState({ showGrid: v }) },
});

settingsRegistry.register({
  id: 'viewport.gridSize',
  type: 'number',
  scope: 'editor',
  section: 'viewport',
  group: t('set.group.grid'),
  label: t('set.viewport.gridSize'),
  description: t('set.viewport.gridSize.desc'),
  default: 32,
  min: 8,
  max: 128,
  step: 1,
  bind: { get: () => ed().snapStep, set: (v) => useEditorStore.setState({ snapStep: v }) },
});

settingsRegistry.register({
  id: 'viewport.snapping',
  type: 'boolean',
  scope: 'editor',
  section: 'viewport',
  group: t('set.group.grid'),
  label: t('set.viewport.snapping'),
  default: false,
  bind: { get: () => ed().snapping, set: (v) => useEditorStore.setState({ snapping: v }) },
});

settingsRegistry.register({
  id: 'viewport.showGizmos',
  type: 'boolean',
  scope: 'editor',
  section: 'viewport',
  group: t('set.group.gizmos'),
  label: t('set.viewport.showGizmos'),
  default: true,
  bind: { get: () => ed().showGizmos, set: (v) => useEditorStore.setState({ showGizmos: v }) },
});

// ── Performance ──────────────────────────────────────────────────────────────
settingsRegistry.register({
  id: 'performance.useLessCpuInBackground',
  type: 'boolean',
  scope: 'editor',
  section: 'performance',
  group: t('set.group.background'),
  label: t('set.performance.useLessCpuInBackground'),
  description: t('set.performance.useLessCpuInBackground.desc'),
  default: true,
  effect: (v) => setUseLessCpuInBackground(v),
});

// ── Console (store-owned, applied to the log ring buffer) ────────────────────
settingsRegistry.register({
  id: 'console.maxLines',
  type: 'number',
  scope: 'editor',
  section: 'console',
  group: t('set.group.console'),
  label: t('set.console.maxLines'),
  description: t('set.console.maxLines.desc'),
  default: 2000,
  min: 100,
  max: 10000,
  step: 100,
  effect: (v) => LogStore.setCap(v),
});

// ── Keyboard Shortcuts (editable, bound to the command registry overrides) ───
// Each keybound command gets a row; the value is the effective chord, bound to
// the registry so rebinding persists + takes effect, and reset clears the override.
const primaryChord = (kb: ReturnType<typeof commands.keybindingFor>): string =>
  (Array.isArray(kb) ? kb[0] : kb) ?? '';

for (const cmd of commands.all()) {
  if (!cmd.keybinding) continue;
  settingsRegistry.register({
    id: `shortcut.${cmd.id}`,
    type: 'keybinding',
    scope: 'editor',
    section: 'shortcuts',
    group: cmd.category ?? t('cat.general'),
    label: cmd.label,
    commandId: cmd.id,
    default: primaryChord(cmd.keybinding),
    bind: {
      get: () => primaryChord(commands.keybindingFor(cmd.id)),
      set: (chord) => commands.setKeybinding(cmd.id, chord),
    },
  });
}
