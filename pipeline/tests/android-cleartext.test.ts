// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A shipping Android build is held to https; the export says so when the
 *        project's CDN is plain http, rather than letting it fail on the phone.
 */
import { describe, it, expect } from 'vitest';
import { cleartextWarning } from '../src/export/exportGame';

describe('a plain-http CDN', () => {
  it('is named in a shipping Android build', () => {
    expect(cleartextWarning('android', true, 'http://192.168.1.5:8080/cdn')).toMatch(/http:\/\/192\.168\.1\.5:8080\/cdn.*https/);
  });

  it('is fine in a development build, on other targets, and over https', () => {
    expect(cleartextWarning('android', false, 'http://lan/cdn')).toBeNull();
    expect(cleartextWarning('ios', true, 'http://lan/cdn')).toBeNull();
    expect(cleartextWarning('android', true, 'https://cdn.example.com')).toBeNull();
    expect(cleartextWarning('android', true)).toBeNull();
  });
});
