// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  secrets.ts — main's keeper of the credentials a setting can hold (the
 *        built-in agent's API key today).
 *
 * The direction of travel is the whole feature: a secret comes IN from the
 * renderer once, when the user types it, and never goes back out. There is no
 * `get` over IPC — only main reads one ({@link readSecret}), and only to hand it
 * to the client that must send it. The window learns exactly one bit, whether
 * something is stored, which is what the settings row renders.
 *
 * At rest it is sealed with Electron's safeStorage, i.e. the OS keychain (macOS
 * Keychain, Windows DPAPI, libsecret/kwallet on Linux). Where there is no
 * keychain to seal with, storing is REFUSED rather than quietly downgraded to a
 * plaintext file — an API key written in the clear because the machine made it
 * inconvenient not to is the bug this file exists to not have.
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const log = (...a: unknown[]) => process.stderr.write(`[secrets] ${a.join(' ')}\n`);

/**
 * What this machine can seal a secret with.
 *
 * `obfuscated` is Linux's `basic_text` backend: safeStorage answers that
 * encryption is "available" and then encrypts with a hardcoded password, which
 * is not a keychain and should not be presented as one.
 */
export type SecretStorage = 'keychain' | 'obfuscated' | 'unavailable';

/** Everything the renderer is allowed to know about a secret. */
export interface SecretStatus {
  id: string;
  /** A secret is stored AND this machine can still open it. */
  configured: boolean;
  storage: SecretStorage;
  /** Why the stored one could not be opened, if there is one that cannot. */
  error: string | null;
}

/** Ciphertext as it sits on disk, read once per process. */
let stored: Map<string, Buffer> | null = null;
/** Per-id decrypt verdict — null when it opened, else the failure. Memoised so
 *  a status read is not a keychain round trip. */
const checked = new Map<string, string | null>();

function file(): string {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function storage(): SecretStorage {
  if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
  if (process.platform !== 'linux') return 'keychain';
  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text' ? 'obfuscated' : 'keychain';
  } catch {
    // The call is Linux-only and documented to exist there; a build without it
    // still has working encryption, so don't downgrade what we report over it.
    return 'keychain';
  }
}

/** The file, or an empty set — an absent one is the ordinary first-run state. */
function load(): Map<string, Buffer> {
  if (stored) return stored;
  stored = new Map();
  let raw: string;
  try {
    raw = readFileSync(file(), 'utf8');
  } catch {
    return stored;
  }
  try {
    for (const [id, b64] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      stored.set(id, Buffer.from(b64, 'base64'));
    }
  } catch (e) {
    // Keep the empty map: a file we cannot parse is one we cannot honour, and
    // the next `set` rewrites it. Reported so it is not a silent forgetting.
    log('ignoring an unreadable secrets file:', String(e));
  }
  return stored;
}

function persist(): void {
  const out: Record<string, string> = {};
  for (const [id, cipher] of load()) out[id] = cipher.toString('base64');
  const target = file();
  const tmp = `${target}.tmp`;
  // Write-then-rename, 0600: the contents are ciphertext, but a half-written
  // file would lose every secret in it, and the mode is what keeps it out of
  // another account's reach on a shared machine.
  writeFileSync(tmp, `${JSON.stringify(out)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
}

/**
 * Whether the entry for `id` still opens: null yes, a string why not, undefined
 * when there is no entry. A secret sealed by a keychain this machine no longer
 * has is not a secret we have, and reporting it as configured would send the
 * user looking for the fault anywhere but here.
 */
function check(id: string): string | null | undefined {
  const cipher = load().get(id);
  if (!cipher) return undefined;
  if (!checked.has(id)) {
    try {
      safeStorage.decryptString(cipher);
      checked.set(id, null);
    } catch (e) {
      checked.set(id, String((e as Error)?.message ?? e));
    }
  }
  return checked.get(id);
}

export function secretStatus(id: string): SecretStatus {
  const store = storage();
  // Nothing can be open when nothing can be sealed, and `storage` already says
  // why — an error here would say it twice.
  if (store === 'unavailable') return { id, configured: false, storage: store, error: null };
  const failure = check(id);
  return { id, configured: failure === null, storage: store, error: failure ?? null };
}

/**
 * Seal `value` under `id`. Blank is a no-op rather than a clear: the row's own
 * control never submits one, so a blank arriving here is a mistake, and taking
 * a configured key away over it is not the helpful reading.
 */
export function setSecret(id: string, value: string): SecretStatus {
  const secret = value.trim();
  if (!secret) return secretStatus(id);
  const store = storage();
  if (store === 'unavailable') return { id, configured: false, storage: store, error: null };
  const previous = load().get(id);
  try {
    load().set(id, safeStorage.encryptString(secret));
    checked.set(id, null);
    persist();
  } catch (e) {
    // Put back what was there. A store that fails must not also lose the working
    // key it was replacing — the file on disk still has that one, so dropping it
    // here would only make the two disagree until the next restart.
    if (previous) load().set(id, previous);
    else load().delete(id);
    checked.delete(id);
    const message = String((e as Error)?.message ?? e);
    log(`could not store ${id}:`, message);
    return { ...secretStatus(id), error: message };
  }
  return secretStatus(id);
}

export function clearSecret(id: string): SecretStatus {
  checked.delete(id);
  if (load().delete(id)) persist();
  return secretStatus(id);
}

/**
 * The plaintext, for the one caller that has to send it. Main-process only —
 * this is deliberately not behind an IPC handler, see the file header.
 */
export function readSecret(id: string): string | null {
  const cipher = load().get(id);
  if (!cipher) return null;
  try {
    return safeStorage.decryptString(cipher);
  } catch {
    return null;
  }
}
