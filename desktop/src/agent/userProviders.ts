// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    userProviders.ts
 * @brief   The providers a person typed, projected into the registry the
 *          shipped ones live in.
 *
 * The only module that knows a provider can come from a settings table:
 * providers.ts stays a registry, and every reader downstream sees one kind of
 * provider.
 */
import { useSettings, dropPersisted } from '@/store/settingsStore';
import {
  type AgentProviderDef, agentKeyId, asProtocol, parseModelList, setUserProviders,
  CUSTOM_PROVIDER,
} from '@/agent/providers';
import { forgetSecret } from '@/store/SecretStore';
import { DEFAULT_CONTEXT_WINDOW } from '@/settings/agentIds';
import { t } from '@/i18n';

export const AGENT_PROVIDERS_SETTING = 'agents.providers';

/**
 * One row of that table, as it is stored.
 *
 * Flat and all-scalar because it IS the edited shape: the table writes these
 * fields directly. `models` stays the raw text — splitting it on save would make
 * the field fight the cursor halfway through a comma.
 */
export interface UserProviderRow {
  /** Stable for the row's life — the key is filed under it. Never re-used. */
  id: string;
  label: string;
  protocol: string;
  baseUrl: string;
  models: string;
  vision: boolean;
  /** Left blank on a new row, and blank means {@link DEFAULT_CONTEXT_WINDOW} —
   *  a zero typed into the cell reads the same way. */
  contextWindow?: number;
  reasoningEffort: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * What to call a provider whose name was left blank.
 *
 * The picker groups models under this, so an empty string there is a heading of
 * nothing above a list of models with no way to tell whose they are. The host is
 * the better guess than a generic word: someone running two local models knows
 * their ports.
 */
function fallbackLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || t('agent.picker.custom');
  } catch {
    return t('agent.picker.custom');
  }
}

/**
 * A stored row as the rest of the editor sees it, or null for one that cannot be
 * used yet — a row still being typed is an ordinary state, not an error, and the
 * table says what is missing (see the setting's `rowError`).
 */
export function rowToDef(row: Record<string, unknown>): AgentProviderDef | null {
  const id = str(row.id).trim();
  if (!id) return null;
  const baseUrl = str(row.baseUrl).trim();
  const contextWindow = Number(row.contextWindow);
  return {
    id,
    label: str(row.label).trim() || fallbackLabel(baseUrl),
    protocol: asProtocol(row.protocol),
    baseUrl,
    models: parseModelList(str(row.models)),
    vision: row.vision === true,
    // Absent means yes, so only an explicit `false` turns it off.
    reasoningEffort: row.reasoningEffort !== false,
    contextWindow: contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW,
    userDefined: true,
  };
}

/** The table, as stored. */
export const userProviderRows = (): Record<string, unknown>[] =>
  useSettings.getState().getValue<Record<string, unknown>[]>(AGENT_PROVIDERS_SETTING) ?? [];

/** Project the table into the provider registry. Called on every edit to it. */
export const syncUserProviders = (): void => {
  const defs: AgentProviderDef[] = [];
  for (const row of userProviderRows()) {
    const def = rowToDef(row);
    if (def) defs.push(def);
  }
  setUserProviders(defs);
};

/**
 * A row for a provider being added, with an id no earlier row has held.
 *
 * Monotonic rather than "first free": a recycled id inherits whatever is still
 * filed under it. {@link forgetProviderSecret} closes the same hole from the
 * other side.
 */
export function newProviderRow(rows: readonly Record<string, unknown>[]): UserProviderRow {
  let next = 1;
  for (const row of rows) {
    const m = /^custom-(\d+)$/.exec(str(row.id));
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return {
    id: `custom-${next}`,
    label: '',
    // Getting this wrong is refused rather than degraded, so default to what
    // most gateways and every local runner implement.
    protocol: 'openai',
    baseUrl: '',
    models: '',
    vision: false,
    // Left out so the cell shows the fallback as its placeholder, not a 0.
    reasoningEffort: true,
  };
}

/** The legacy singleton's settings, folded into the table on first run. */
const LEGACY_IDS = [
  'agents.customProtocol', 'agents.customBaseUrl', 'agents.customModels', 'agents.customVision',
] as const;

/**
 * Fold a pre-table setup into the table, once.
 *
 * The row MUST take {@link CUSTOM_PROVIDER} as its id: a key is filed under its
 * provider's id and main never hands a sealed one back, so an id that does not
 * carry over is a credential the person has to find again. The saved model pick
 * (`estella.agent.selection`) names the same id and keeps resolving too.
 *
 * Runs only while the table has never been written — someone who has since
 * deleted every row meant it.
 */
export function migrateLegacyCustomProvider(): void {
  const { values } = useSettings.getState();
  if (values[AGENT_PROVIDERS_SETTING] !== undefined) return;
  const baseUrl = str(values['agents.customBaseUrl']).trim();
  const models = str(values['agents.customModels']).trim();
  if (!baseUrl && !models) {
    dropPersisted(LEGACY_IDS);
    return;
  }
  const migrated: UserProviderRow = {
    id: CUSTOM_PROVIDER,
    label: t('agent.picker.custom'),
    protocol: asProtocol(values['agents.customProtocol']),
    baseUrl,
    models,
    vision: values['agents.customVision'] === true,
    reasoningEffort: true,
  };
  useSettings.getState().setValue(AGENT_PROVIDERS_SETTING, [migrated as unknown as Record<string, unknown>]);
  dropPersisted(LEGACY_IDS);
}

/** Let go of the credential a removed provider held — see {@link newProviderRow}. */
export function forgetProviderSecret(row: Record<string, unknown>): void {
  const id = str(row.id).trim();
  if (id) void forgetSecret(agentKeyId(id));
}
