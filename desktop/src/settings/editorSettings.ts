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

const root = () => document.documentElement.style;

// ── Sections (editor category) ──────────────────────────────────────────────
settingsRegistry.registerSection({ id: 'appearance', label: 'Appearance', category: 'editor', order: 1 });
settingsRegistry.registerSection({ id: 'viewport', label: 'Viewport', category: 'editor', order: 2 });
settingsRegistry.registerSection({ id: 'shortcuts', label: 'Keyboard Shortcuts', category: 'editor', order: 3 });
settingsRegistry.registerSection({ id: 'console', label: 'Console', category: 'editor', order: 4 });

// ── Appearance (store-owned, applied via CSS) ───────────────────────────────
settingsRegistry.register({
  id: 'appearance.accent',
  type: 'color',
  scope: 'editor',
  section: 'appearance',
  group: 'Appearance',
  label: 'Accent color',
  description: 'Used for selection, active controls, and focus.',
  default: '#2f88d6',
  swatches: ['#2f88d6', '#46b08c', '#b272d6', '#e08c43', '#c75d6e'],
  effect: (v) => {
    root().setProperty('--star', v);
    root().setProperty('--acc', v);
  },
});

settingsRegistry.register({
  id: 'appearance.uiScale',
  type: 'number',
  scope: 'editor',
  section: 'appearance',
  group: 'Appearance',
  label: 'UI scale',
  description: 'Scales every panel — fonts and controls.',
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

// ── Viewport (bound to editorStore — one source with the viewport toolbar) ───
const ed = () => useEditorStore.getState();

settingsRegistry.register({
  id: 'viewport.showGrid',
  type: 'boolean',
  scope: 'editor',
  section: 'viewport',
  group: 'Grid',
  label: 'Show grid',
  default: true,
  bind: { get: () => ed().showGrid, set: (v) => useEditorStore.setState({ showGrid: v }) },
});

settingsRegistry.register({
  id: 'viewport.gridSize',
  type: 'number',
  scope: 'editor',
  section: 'viewport',
  group: 'Grid',
  label: 'Grid size',
  description: 'World-unit spacing of the scene grid (and Move snap).',
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
  group: 'Grid',
  label: 'Snap to grid',
  default: false,
  bind: { get: () => ed().snapping, set: (v) => useEditorStore.setState({ snapping: v }) },
});

settingsRegistry.register({
  id: 'viewport.showGizmos',
  type: 'boolean',
  scope: 'editor',
  section: 'viewport',
  group: 'Gizmos',
  label: 'Show gizmos',
  default: true,
  bind: { get: () => ed().showGizmos, set: (v) => useEditorStore.setState({ showGizmos: v }) },
});

// ── Console (store-owned, applied to the log ring buffer) ────────────────────
settingsRegistry.register({
  id: 'console.maxLines',
  type: 'number',
  scope: 'editor',
  section: 'console',
  group: 'Console',
  label: 'Max retained lines',
  description: 'Output Log keeps at most this many entries.',
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
    group: cmd.category ?? 'General',
    label: cmd.label,
    commandId: cmd.id,
    default: primaryChord(cmd.keybinding),
    bind: {
      get: () => primaryChord(commands.keybindingFor(cmd.id)),
      set: (chord) => commands.setKeybinding(cmd.id, chord),
    },
  });
}
