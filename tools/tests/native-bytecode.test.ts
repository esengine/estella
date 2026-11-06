// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundleIdentityHex, bytecodeMatchesBundle, templateEmbedsBundle } from '../lib/nativeBytecode.mjs';

describe('native bytecode source identity', () => {
  // mkbc's 64-bit source header for the newline-prefixed UTF-8 bundle below.
  const bytecode = Buffer.from('4efef755917e96b8010203', 'hex');
  const bundle = Buffer.from('globalThis.ESEngine = {};');
  it('accepts the matching SDK independent of when files were copied or rebuilt', () => {
    expect(bytecodeMatchesBundle(bytecode, bundle)).toBe(true);
    expect(bytecodeMatchesBundle(Buffer.from(bytecode), Buffer.from(bundle))).toBe(true);
  });
  it('rejects changed SDK bytes and malformed bytecode', () => {
    expect(bytecodeMatchesBundle(bytecode, Buffer.from('globalThis.ESEngine = {changed: true};'))).toBe(false);
    expect(bytecodeMatchesBundle(bytecode.subarray(0, 8), bundle)).toBe(false);
    const corrupt = Buffer.from(bytecode); corrupt[0] ^= 1;
    expect(bytecodeMatchesBundle(corrupt, bundle)).toBe(false);
  });
});

describe('which SDK a template embeds, whichever engine it runs', () => {
  const bundle = Buffer.from('globalThis.ESEngine = {};');
  let dir: string | null = null;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); dir = null; });
  const template = (files: Record<string, string | Buffer>) => {
    dir = mkdtempSync(path.join(tmpdir(), 'es-embeds-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return dir;
  };

  it('is the identity the bytecode header carries', () => {
    expect(bundleIdentityHex(bundle)).toBe('b8967e9155f7fe4e');
  });
  it('reads a V8 template off its manifest, which has no bytecode to read', () => {
    const at = template({ 'template.json': JSON.stringify({ jsEngine: 'v8', sdkBundle: bundleIdentityHex(bundle) }) });
    expect(templateEmbedsBundle(at, bundle)).toBe(true);
    expect(templateEmbedsBundle(at, Buffer.from('globalThis.ESEngine = {changed: true};'))).toBe(false);
  });
  it('falls back to the bytecode of a template that predates the manifest field', () => {
    const at = template({ 'template.json': '{}', 'esengine.native.qjsbc': Buffer.from('4efef755917e96b8010203', 'hex') });
    expect(templateEmbedsBundle(at, bundle)).toBe(true);
  });
  it('cannot say for a template with neither', () => {
    expect(templateEmbedsBundle(template({ 'template.json': '{}' }), bundle)).toBeNull();
  });
});
