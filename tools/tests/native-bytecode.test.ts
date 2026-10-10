// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { bytecodeMatchesBundle } from '../lib/nativeBytecode.mjs';

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
