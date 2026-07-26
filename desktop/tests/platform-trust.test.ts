// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The trust gate on project platform profiles.
 *
 * These profiles are `await import()`ed into the MAIN process with full Node — the
 * most privileged thing a project can ask the editor to run, and for a long time the
 * only one with no approval step while renderer plugins had one. The gate closes
 * that; these tests pin the two halves that matter: an unapproved profile is NOT
 * imported, and it is still REPORTED so the user can find out it exists.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  listPlatforms, listPlayableNetworks, loadProjectPlatform, setPlatformTrustGate,
  platformTrustId, PROJECT_PLATFORM_DIR,
} from '../electron/platformCatalog';
import { discoverPlugins } from '../electron/pluginHost';

let root: string;
let userData: string;
const dirs = { web: '/nonexistent-web', wechat: '/nonexistent-wechat' };
const VERSION = '9.9.9';

/** Set by a loaded profile, so a test can prove whether the import actually ran. */
const IMPORT_MARKER = 'estella-platform-trust-test-imported';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-platform-'));
  userData = mkdtempSync(path.join(tmpdir(), 'estella-userdata-'));
  // Keep the native probes off this machine's installed templates.
  process.env.ESTELLA_NATIVE_TEMPLATES = path.join(root, 'templates');
  mkdirSync(path.join(root, PROJECT_PLATFORM_DIR), { recursive: true });
  writeFileSync(
    path.join(root, PROJECT_PLATFORM_DIR, 'acme.mjs'),
    `globalThis[${JSON.stringify(IMPORT_MARKER)}] = (globalThis[${JSON.stringify(IMPORT_MARKER)}] ?? 0) + 1;\n` +
      `export default { id: 'acme', label: 'Acme', emitConfigFiles: () => [] };\n`,
  );
});

afterAll(() => {
  setPlatformTrustGate(null);
  delete process.env.ESTELLA_NATIVE_TEMPLATES;
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

afterEach(() => {
  setPlatformTrustGate(null);
  delete (globalThis as Record<string, unknown>)[IMPORT_MARKER];
});

const acmeRow = async () => (await listPlatforms(root, dirs, VERSION)).find((p) => p.id === 'acme');

describe('project platform trust gate', () => {
  it('does not import an unapproved profile', async () => {
    setPlatformTrustGate(() => false);
    const row = await acmeRow();

    expect(row?.needsTrust).toBe(true);
    expect(row?.ready).toBe(false);
    // The label is the FILE name, not the profile's own — proof the module body
    // never ran. This is the assertion that actually catches a bypass.
    expect(row?.label).toBe('acme.mjs');
    expect((globalThis as Record<string, unknown>)[IMPORT_MARKER]).toBeUndefined();
  });

  it('imports an approved profile and uses its own metadata', async () => {
    setPlatformTrustGate(() => true);
    const row = await acmeRow();

    expect(row?.needsTrust).toBeUndefined();
    expect(row?.label).toBe('Acme');
    expect((globalThis as Record<string, unknown>)[IMPORT_MARKER]).toBe(1);
  });

  it('keeps reporting an unapproved profile rather than hiding it', async () => {
    setPlatformTrustGate(() => false);
    // Silently dropping it would leave the user unable to tell "I never wrote it"
    // from "the editor refused to run it".
    expect(await acmeRow()).toBeDefined();

    const networks = await listPlayableNetworks(root);
    const acme = networks.find((n) => n.id === 'acme');
    expect(acme?.error).toMatch(/approval/i);
  });

  it('refuses to resolve an unapproved profile for an actual export', async () => {
    setPlatformTrustGate(() => false);
    // The listing is cosmetic; THIS is the path that would have run the code.
    expect(await loadProjectPlatform(root, 'acme', dirs)).toBeNull();
    expect((globalThis as Record<string, unknown>)[IMPORT_MARKER]).toBeUndefined();

    setPlatformTrustGate(() => true);
    expect(await loadProjectPlatform(root, 'acme', dirs)).not.toBeNull();
  });

  it('gates on the id the Plugins panel approves under', async () => {
    const seen: string[] = [];
    setPlatformTrustGate((id) => {
      seen.push(id);
      return false;
    });
    await acmeRow();
    // The panel records approval under this id, so the gate must ask for the same one.
    expect(seen).toContain(platformTrustId(path.join(root, PROJECT_PLATFORM_DIR, 'acme.mjs')));
    expect(seen[0]).toBe('platform.acme');
  });

  it('lists the profile as project-supplied code alongside plugins', async () => {
    const found = await discoverPlugins(root, userData);
    const entry = found.find((p) => p.id === 'platform.acme');
    expect(entry?.kind).toBe('project-platform');
    expect(entry?.scope).toBe('project');
    // A synthesized manifest gives the row something to display and to key approval by.
    expect(entry?.manifest?.version).toBe('0.0.0');
    expect(entry?.manifest?.capabilities).toContain('process');
  });

  it('leaves the catalog ungated when no gate is installed (unit-test posture)', async () => {
    const row = await acmeRow();
    expect(row?.label).toBe('Acme');
  });
});
