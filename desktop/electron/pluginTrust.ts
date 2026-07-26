// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The record of which project-supplied code the user approved.
 *
 * Its own module because there is more than one kind of such code, and they must
 * share ONE gate: an editor plugin (renderer or node entry) and a project platform
 * profile are both "code this project asked the editor to run". A platform profile
 * is in fact the more privileged of the two — it is imported into the MAIN process,
 * with full Node — so gating the plugin while leaving that open would have the
 * protection exactly backwards.
 *
 * Approval is keyed by `<id>@<version>` AND the folder it was approved from: a new
 * version re-asks, and so does a different folder claiming the same id. Deliberately
 * NOT keyed by a hash of the code — that would re-prompt on every save, which is
 * fatal to actually writing a plugin, and the threat model here is "code I did not
 * write", not "code I just edited".
 *
 * Pure Node apart from the userData path (injected), so it stays unit-testable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface TrustFile {
  /** `<id>@<version>` → the absolute folder it was approved from. */
  trusted: Record<string, string>;
  /** ids the user switched off (independent of trust). */
  disabled: string[];
}

const EMPTY: TrustFile = { trusted: {}, disabled: [] };

const trustFile = (userDataDir: string): string => path.join(userDataDir, 'estella-plugin-trust.json');

/** Approval identity. A profile with no version of its own passes `''`. */
const trustKey = (id: string, version: string): string => `${id}@${version}`;

function readTrust(userDataDir: string): TrustFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(trustFile(userDataDir), 'utf8'));
    const f = raw as Partial<TrustFile>;
    return {
      trusted: f.trusted && typeof f.trusted === 'object' ? f.trusted : {},
      disabled: Array.isArray(f.disabled) ? f.disabled : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeTrust(userDataDir: string, next: TrustFile): void {
  try {
    writeFileSync(trustFile(userDataDir), `${JSON.stringify(next, null, 2)}\n`);
  } catch {
    /* read-only profile — trust simply won't persist this session */
  }
}

/** Whether the user approved this id + version, from this folder. */
export function isTrusted(userDataDir: string, id: string, version: string, dir: string): boolean {
  return readTrust(userDataDir).trusted[trustKey(id, version)] === dir;
}

export function trustPlugin(userDataDir: string, id: string, version: string, dir: string): void {
  const f = readTrust(userDataDir);
  f.trusted[trustKey(id, version)] = dir;
  writeTrust(userDataDir, f);
}

/** Withdraw approval for every version of an id; it stops loading until re-approved. */
export function revokeTrust(userDataDir: string, id: string): void {
  const f = readTrust(userDataDir);
  for (const key of Object.keys(f.trusted)) {
    if (key.startsWith(`${id}@`)) delete f.trusted[key];
  }
  writeTrust(userDataDir, f);
}

export function isDisabled(userDataDir: string, id: string): boolean {
  return readTrust(userDataDir).disabled.includes(id);
}

export function setPluginEnabled(userDataDir: string, id: string, enabled: boolean): void {
  const f = readTrust(userDataDir);
  const set = new Set(f.disabled);
  if (enabled) set.delete(id);
  else set.add(id);
  f.disabled = [...set].sort();
  writeTrust(userDataDir, f);
}
