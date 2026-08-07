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
import { mcpStatus, setMcpEnabled, subscribeMcp } from '@/store/McpStore';
import { secretStatusLine, subscribeSecrets } from '@/store/SecretStore';
import { syncAgentEndpoint } from '@/store/AgentStore';
import { useSettings } from '@/store/settingsStore';
import {
  agentProviders, agentKeyId, modelsSettingId, AGENT_PROTOCOLS, parseModelList,
} from '@/agent/providers';
import {
  AGENT_PROVIDERS_SETTING, syncUserProviders, newProviderRow, forgetProviderSecret,
  migrateLegacyCustomProvider,
} from '@/agent/userProviders';
import { AGENT_EFFORTS, DEFAULT_EFFORT, DEFAULT_CONTEXT_WINDOW } from '@/settings/agentIds';
import { applyUiZoom, UI_SCALE_SETTING, ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX } from '@/layout/uiZoom';
import { t, type MsgKey, editorLocale, systemDefaultLocale, EDITOR_LOCALES, LANGUAGE_SETTING_ID } from '@/i18n';

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
settingsRegistry.registerSection({ id: 'agents', label: t('set.section.agents'), category: 'editor', order: 8 });

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
  id: UI_SCALE_SETTING,
  type: 'number',
  scope: 'editor',
  section: 'appearance',
  group: t('set.group.appearance'),
  label: t('set.appearance.uiScale'),
  description: t('set.appearance.uiScale.desc'),
  default: ZOOM_DEFAULT,
  min: ZOOM_MIN,
  max: ZOOM_MAX,
  step: 5,
  slider: true,
  suffix: '%',
  effect: (v) => applyUiZoom(v),
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

// ── AI Agents ───────────────────────────────────────────────────────────────
// The unit of configuration is a PROVIDER, and every one keeps its own key —
// switching back to one you used last week must not mean finding its key again.
// Which model runs is picked in the composer instead, because that is a
// per-message decision, not a preference (src/agent/providers.ts).
for (const provider of agentProviders()) {
  if (provider.userDefined) continue;
  settingsRegistry.register({
    id: agentKeyId(provider.id),
    type: 'secret',
    scope: 'editor',
    section: 'agents',
    group: t('set.group.builtinAgent'),
    label: t('set.agents.providerKey', { provider: provider.label }),
    description: t('set.agents.providerKey.desc', { provider: provider.label }),
    placeholder: 'sk-…',
    default: false,
    status: { read: () => secretStatusLine(agentKeyId(provider.id)), subscribe: subscribeSecrets },
  });
  // A vendor whose address holds still but whose model NAMES do not: shipping a
  // list would be right until its next release, and a name we get wrong is not
  // an error — it is a gateway quietly serving something smaller all session.
  if (!provider.typedModels) continue;
  settingsRegistry.register({
    id: modelsSettingId(provider.id),
    type: 'string',
    scope: 'editor',
    section: 'agents',
    group: t('set.group.builtinAgent'),
    label: t('set.agents.providerModels', { provider: provider.label }),
    description: t('set.agents.providerModels.desc', { provider: provider.label }),
    placeholder: 'model-a, model-b',
    default: '',
    effect: () => syncAgentEndpoint(),
  });
}

// How hard the model is asked to think. Its own setting rather than part of the
// model pick: the same model is worth running shallower for "rename these
// three", and depth is what someone reaches for when a turn cost too much or
// took too long — not when they change provider.
settingsRegistry.register({
  id: 'agents.effort',
  type: 'enum',
  scope: 'editor',
  section: 'agents',
  group: t('set.group.builtinAgent'),
  label: t('set.agents.effort'),
  description: t('set.agents.effort.desc'),
  default: DEFAULT_EFFORT,
  options: AGENT_EFFORTS.map((value) => ({ value, label: value })),
  effect: () => syncAgentEndpoint(),
});

// Providers we have not heard of — which are exactly the ones we cannot ship an
// address, a model list, or a word about what they accept.
//
// A TABLE, not a set of fields, because the unit of configuration is a provider
// and a person has more than one: a local runner and a company gateway are not
// two states of one setting. Each row keeps its own key, for the same reason the
// shipped rows above do.
//
// The main columns say where it is and what it speaks; the expander says what it
// can DO. That split is the point — an endpoint that could only be given an
// address had no way to tell the agent it accepts screenshots, and the agent
// spent every session working blind without either side deciding that.
settingsRegistry.register({
  id: AGENT_PROVIDERS_SETTING,
  type: 'objectList',
  scope: 'editor',
  section: 'agents',
  group: t('set.group.customProvider'),
  label: t('set.agents.providers'),
  description: t('set.agents.providers.desc'),
  layout: 'block',
  default: [],
  columns: [
    { key: 'label', label: t('set.agents.col.label'), type: 'text', width: '0.9fr', mono: false, placeholder: 'Local llama' },
    {
      key: 'protocol',
      label: t('set.agents.col.protocol'),
      type: 'enum',
      width: '108px',
      options: AGENT_PROTOCOLS.map((value) => ({ value, label: t(`set.agents.protocolShort.${value}` as MsgKey) })),
    },
    { key: 'baseUrl', label: t('set.agents.col.baseUrl'), type: 'text', width: '1.6fr', placeholder: 'http://localhost:11434/v1' },
    { key: 'models', label: t('set.agents.col.models'), type: 'text', width: '1.1fr', placeholder: 'model-a, model-b' },
    { key: 'apiKey', label: t('set.agents.col.key'), type: 'secret', width: '96px', secretId: (row) => agentKeyId(String(row.id ?? '')) },
  ],
  detailColumns: [
    { key: 'vision', label: t('set.agents.customVision'), type: 'boolean' },
    { key: 'contextWindow', label: t('set.agents.col.contextWindow'), type: 'number', width: '104px', min: 0, placeholder: String(DEFAULT_CONTEXT_WINDOW) },
    { key: 'reasoningEffort', label: t('set.agents.col.reasoningEffort'), type: 'boolean' },
  ],
  detailLabel: t('set.agents.capabilities'),
  addLabel: t('set.agents.addProvider'),
  emptyHint: t('set.agents.providers.empty'),
  newRow: () => newProviderRow(
    useSettings.getState().getValue<Record<string, unknown>[]>(AGENT_PROVIDERS_SETTING) ?? [],
  ) as unknown as Record<string, unknown>,
  rowError: (row) => {
    if (!String(row.baseUrl ?? '').trim()) return t('set.agents.err.baseUrl');
    if (parseModelList(String(row.models ?? '')).length === 0) return t('set.agents.err.models');
    return null;
  },
  // A key outlives the row it belonged to otherwise: sealed on the machine,
  // unreachable from any UI, and waiting to be inherited by a later provider.
  onRowRemoved: forgetProviderSecret,
  effect: () => {
    syncUserProviders();
    syncAgentEndpoint();
  },
});

// Fold a pre-table setup into the table, before anything reads either.
migrateLegacyCustomProvider();

// ── External agents (main-owned endpoint, driven from here) ─────────────────
// An external agent reaches this editor through the MCP endpoint main can expose,
// and `--attach` finds it through the discovery file the endpoint writes. An
// editor launched the ordinary way — by double-clicking it — wrote no such file,
// so the only way to let an agent in was a command-line flag, which is not
// something a GUI user has any reason to know exists. This is that flag, as a
// setting: persisted per user and replayed at boot, so it survives a restart the
// way `--mcp` never could.
//
// Reports rather than assumes: the effect resolves with what main actually did,
// and the status line renders THAT — an editor started with `--mcp` shows itself
// already open (and stays open, the toggle notwithstanding), a port that could
// not bind shows why. Only failures toast; success is the line right there, and
// the boot replay would otherwise greet every launch with a notification.
function mcpStatusLine(): string | null {
  const s = mcpStatus();
  if (s.error) return t('set.agents.mcp.error', { message: s.error });
  if (!s.running || s.port === null) return null;
  return s.forced
    ? t('set.agents.mcp.forced', { port: String(s.port) })
    : t('set.agents.mcp.listening', { port: String(s.port) });
}

settingsRegistry.register({
  id: 'agents.mcpEnabled',
  type: 'boolean',
  scope: 'editor',
  section: 'agents',
  group: t('set.group.agents'),
  label: t('set.agents.mcpEnabled'),
  description: t('set.agents.mcpEnabled.desc'),
  default: false,
  effect: (on) => {
    void setMcpEnabled(on).then((s) => {
      if (s.error) Toasts.push(t('toast.mcpFailed', { message: s.error }), 'error');
    });
  },
  status: { read: mcpStatusLine, subscribe: subscribeMcp },
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
