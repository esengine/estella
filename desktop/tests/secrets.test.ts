// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The credential store behind the `secret` setting type. Three things have to
// hold, and only the first is about happy paths:
//
//   1. A stored secret survives a restart and comes back to MAIN, plaintext.
//   2. It is never on disk in the clear — a machine that cannot encrypt is told
//      "no", not quietly given a plaintext file.
//   3. What the renderer is told is TRUE: a secret sealed by a keychain this
//      machine no longer has reads as not-configured, not as configured-and-then
//      mysteriously broken at the first API call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AGENT_API_KEY } from '../src/settings/agentIds';

let userData: string;
let available = true;
let backend = 'gnome_libsecret';
/** Which "machine" sealed a ciphertext — a mismatch is a restored backup. */
let keyring = 'this-machine';
let sealFails = false;

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (plain: string) => {
      if (!available || sealFails) throw new Error('the keychain refused');
      return Buffer.from(`${keyring}:${plain}`);
    },
    decryptString: (buf: Buffer) => {
      const [sealedBy, ...rest] = buf.toString().split(':');
      if (sealedBy !== keyring) throw new Error('failed to decrypt');
      return rest.join(':');
    },
  },
}));

async function load() {
  vi.resetModules();
  return import('../electron/secrets');
}

const file = () => path.join(userData, 'secrets.json');
const onDisk = () => readFileSync(file(), 'utf8');

beforeEach(() => {
  userData = mkdtempSync(path.join(tmpdir(), 'estella-secrets-'));
  available = true;
  backend = 'gnome_libsecret';
  keyring = 'this-machine';
  sealFails = false;
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('storing a secret', () => {
  it('reports nothing configured before anything is stored, and writes no file', async () => {
    const { secretStatus } = await load();
    expect(secretStatus(AGENT_API_KEY)).toEqual({
      id: AGENT_API_KEY, configured: false, storage: 'keychain', error: null,
    });
    expect(existsSync(file())).toBe(false);
  });

  it('hands the value back to main and never writes it in the clear', async () => {
    const { setSecret, readSecret } = await load();
    expect(setSecret(AGENT_API_KEY, 'sk-ant-secret')).toMatchObject({ configured: true, error: null });
    expect(readSecret(AGENT_API_KEY)).toBe('sk-ant-secret');
    expect(onDisk()).not.toContain('sk-ant-secret');
  });

  it('keeps the file to this account', async () => {
    const { setSecret } = await load();
    setSecret(AGENT_API_KEY, 'sk-ant-secret');
    if (process.platform === 'win32') return; // POSIX modes only
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('survives a restart', async () => {
    const first = await load();
    first.setSecret(AGENT_API_KEY, 'sk-ant-secret');

    const restarted = await load();
    expect(restarted.secretStatus(AGENT_API_KEY)).toMatchObject({ configured: true });
    expect(restarted.readSecret(AGENT_API_KEY)).toBe('sk-ant-secret');
  });

  it('replaces rather than accumulates', async () => {
    const { setSecret, readSecret } = await load();
    setSecret(AGENT_API_KEY, 'first');
    setSecret(AGENT_API_KEY, 'second');
    expect(readSecret(AGENT_API_KEY)).toBe('second');
    expect(Object.keys(JSON.parse(onDisk()) as object)).toEqual([AGENT_API_KEY]);
  });

  it('trims what was pasted', async () => {
    const { setSecret, readSecret } = await load();
    setSecret(AGENT_API_KEY, '  sk-ant-secret\n');
    expect(readSecret(AGENT_API_KEY)).toBe('sk-ant-secret');
  });

  // A blank submission is a mistake, and reading it as "forget my key" is not the
  // helpful interpretation of one.
  it('ignores a blank instead of taking the stored one away', async () => {
    const { setSecret, readSecret } = await load();
    setSecret(AGENT_API_KEY, 'sk-ant-secret');
    expect(setSecret(AGENT_API_KEY, '   ')).toMatchObject({ configured: true });
    expect(readSecret(AGENT_API_KEY)).toBe('sk-ant-secret');
  });

  // The file on disk still holds the old one, so dropping it in memory would only
  // make the two disagree until the next restart.
  it('keeps the working key when replacing it fails', async () => {
    const { setSecret, readSecret, secretStatus } = await load();
    setSecret(AGENT_API_KEY, 'sk-ant-works');

    sealFails = true; // the keychain refuses mid-session
    const failed = setSecret(AGENT_API_KEY, 'sk-ant-new');
    sealFails = false;

    expect(failed.error).toContain('refused');
    expect(secretStatus(AGENT_API_KEY)).toMatchObject({ configured: true });
    expect(readSecret(AGENT_API_KEY)).toBe('sk-ant-works');
  });

  it('forgets one on request, on disk too', async () => {
    const { setSecret, clearSecret, readSecret } = await load();
    setSecret(AGENT_API_KEY, 'sk-ant-secret');
    expect(clearSecret(AGENT_API_KEY)).toMatchObject({ configured: false });
    expect(readSecret(AGENT_API_KEY)).toBeNull();
    expect(JSON.parse(onDisk())).toEqual({});
  });
});

describe('a machine that cannot encrypt', () => {
  it('refuses to store rather than falling back to plaintext', async () => {
    available = false;
    const { setSecret, secretStatus } = await load();
    expect(setSecret(AGENT_API_KEY, 'sk-ant-secret')).toEqual({
      id: AGENT_API_KEY, configured: false, storage: 'unavailable', error: null,
    });
    expect(existsSync(file())).toBe(false);
    expect(secretStatus(AGENT_API_KEY).storage).toBe('unavailable');
  });

  // Linux's basic_text backend encrypts with a hardcoded password. safeStorage
  // answers "available" for it, and calling that a keychain in the UI would be
  // the one claim a user might act on.
  it('names Linux obfuscation as what it is', async () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    backend = 'basic_text';
    try {
      const { setSecret } = await load();
      expect(setSecret(AGENT_API_KEY, 'sk-ant-secret')).toMatchObject({
        configured: true, storage: 'obfuscated',
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }
  });
});

describe('a stored secret this machine cannot open', () => {
  it('reads as not configured, and says why', async () => {
    const first = await load();
    first.setSecret(AGENT_API_KEY, 'sk-ant-secret');

    keyring = 'another-machine'; // restored from a backup / a rotated keychain
    const restarted = await load();
    const status = restarted.secretStatus(AGENT_API_KEY);
    expect(status.configured).toBe(false);
    expect(status.error).toContain('decrypt');
    expect(restarted.readSecret(AGENT_API_KEY)).toBeNull();
  });

  it('is replaced by simply entering it again', async () => {
    const first = await load();
    first.setSecret(AGENT_API_KEY, 'sk-ant-secret');

    keyring = 'another-machine';
    const restarted = await load();
    expect(restarted.setSecret(AGENT_API_KEY, 'sk-ant-new')).toMatchObject({ configured: true, error: null });
    expect(restarted.readSecret(AGENT_API_KEY)).toBe('sk-ant-new');
  });

  it('treats an unparseable file as nothing stored rather than throwing', async () => {
    writeFileSync(file(), '{ this is not json');
    const { secretStatus, setSecret } = await load();
    expect(secretStatus(AGENT_API_KEY)).toMatchObject({ configured: false, error: null });
    expect(setSecret(AGENT_API_KEY, 'sk-ant-secret')).toMatchObject({ configured: true });
  });
});

// The invariant is enforced by an absence, so it is worth a test that notices the
// absence going away: main exposes set/clear/status and nothing that reads a
// secret back out. Adding a fourth channel here should be a decision, not a diff.
describe('the IPC surface', () => {
  it('offers no way to read a secret back', async () => {
    const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const channels = [...main.matchAll(/ipcMain\.handle\('(secret:[^']+)'/g)].map((m) => m[1]);
    expect(channels.sort()).toEqual(['secret:clear', 'secret:set', 'secret:status']);
  });
});
