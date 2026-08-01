// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SecretStore.ts
 * @brief   The credentials main holds, as the UI is allowed to see them.
 *
 *          Main owns the secrets themselves (electron/secrets.ts) — it seals them
 *          with the OS keychain and never hands one back. This mirrors the one bit
 *          it does report, so a settings row can render "stored" or an entry field
 *          without the value ever reaching this process or localStorage.
 *
 *          A vanilla store, not a hook: the settings registry is plain data and a
 *          descriptor's `status` is read outside React (SettingsDialog subscribes
 *          it to a row through useSyncExternalStore), the same as McpStore.
 */
import { createStore } from 'zustand/vanilla';
import type { SecretStatus } from '../../electron/secrets';
import { t } from '@/i18n';

export type { SecretStatus };

const store = createStore<{ byId: Record<string, SecretStatus> }>(() => ({ byId: {} }));

const adopt = (status: SecretStatus): SecretStatus => {
  store.setState((prev) => ({ byId: { ...prev.byId, [status.id]: status } }));
  return status;
};

/**
 * What main last said about `id` — undefined until it has said anything. The
 * unknown state is kept distinct on purpose: "not configured" is a claim, and
 * making it before asking would tell a user their key had gone missing.
 */
export const secretStatus = (id: string): SecretStatus | undefined => store.getState().byId[id];

/** Re-render on any change (useSyncExternalStore / plain subscriber). */
export const subscribeSecrets = (fn: () => void): (() => void) => store.subscribe(fn);

export async function refreshSecret(id: string): Promise<SecretStatus | undefined> {
  const status = await window.estella?.secrets?.status(id);
  return status && adopt(status);
}

/** Hand main a secret to seal. This is the only direction it travels. */
export async function storeSecret(id: string, value: string): Promise<SecretStatus | undefined> {
  const status = await window.estella?.secrets?.set(id, value);
  return status && adopt(status);
}

export async function forgetSecret(id: string): Promise<SecretStatus | undefined> {
  const status = await window.estella?.secrets?.clear(id);
  return status && adopt(status);
}

/**
 * The row's live line — what the machine actually did with the secret, not what
 * was asked of it. Silent in the ordinary cases (nothing stored yet, or stored
 * in a real keychain): the control itself says which of those it is, and a line
 * that is always there stops being read.
 *
 * Returns a string so useSyncExternalStore can compare it with Object.is; see
 * settings/types.ts.
 */
export function secretStatusLine(id: string): string | null {
  const s = secretStatus(id);
  if (!s) return null;
  if (s.storage === 'unavailable') return t('set.secret.noKeychain');
  if (s.error) return t('set.secret.damaged', { message: s.error });
  if (s.storage === 'obfuscated') return t('set.secret.obfuscated');
  return null;
}
