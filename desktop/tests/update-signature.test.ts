// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Whether a Windows update can install here, decided BEFORE the download.
 *
 * The case that forced this: a release signed the Windows installer with the
 * project's macOS Developer ID certificate, so those installs pin a publisher
 * Windows can never report Valid ("a certificate chain could not be built to a
 * trusted root authority"). electron-updater refuses such an update only after
 * downloading it in full, and every one of those installs is refused forever.
 */
import { describe, it, expect } from 'vitest';
import { publisherNameIn, signatureSatisfies } from '../electron/updateSignature';

const APPLE_DN =
  'C=CN, O=huahui yu, OU=2S2W4BZFKM, CN=Developer ID Application: huahui yu (2S2W4BZFKM), OID.0.9.2342.19200300.100.1.1=2S2W4BZFKM';

// Verbatim from the 0.35.0 Windows install that could not update: electron-builder
// writes the pin as a LIST, from the certificate the Windows CI leg was handed.
const SHIPPED_YML = [
  'owner: esengine',
  'repo: estella',
  'provider: github',
  'releaseType: draft',
  "updaterCacheDirName: '@estellaeditor-updater'",
  'publisherName:',
  "  - 'Developer ID Application: huahui yu (2S2W4BZFKM)'",
  '',
].join('\n');

describe('publisherNameIn', () => {
  it('reads the pin electron-builder wrote into the build that could not update', () => {
    expect(publisherNameIn(SHIPPED_YML)).toBe('Developer ID Application: huahui yu (2S2W4BZFKM)');
  });

  it('reads a scalar pin too (electron-builder writes either shape)', () => {
    expect(publisherNameIn('provider: github\npublisherName: Acme Inc\n')).toBe('Acme Inc');
  });

  it('is null for an unsigned build — nothing pinned, nothing to verify', () => {
    expect(publisherNameIn('provider: github\nowner: esengine\nrepo: estella\n')).toBeNull();
  });

  it('reads a quoted scalar and a list pin', () => {
    expect(publisherNameIn("publisherName: 'Acme, Inc.'\n")).toBe('Acme, Inc.');
    expect(publisherNameIn('publisherName:\n  - Acme Inc\n  - Acme Ltd\n')).toBe('Acme Inc');
  });
});

describe('signatureSatisfies', () => {
  it('passes when nothing is pinned (the updater skips verification entirely)', () => {
    expect(signatureSatisfies(null, { Status: 2 })).toBe(true);
    expect(signatureSatisfies(null, null)).toBe(true);
  });

  it('passes when Windows could not be asked — never stricter than the check it stands in for', () => {
    expect(signatureSatisfies('Acme Inc', null)).toBe(true);
  });

  // Measured on the 0.35.0 install: the pinned name matches the signer exactly, and
  // Windows still refuses to vouch for the chain — which is the whole failure. A
  // check that compared only names would have called this install updatable.
  it('REFUSES an untrusted chain even though the name matches — the shipped bug', () => {
    expect(signatureSatisfies(publisherNameIn(SHIPPED_YML), {
      Status: 1,
      StatusMessage: 'A certificate chain could not be built to a trusted root authority',
      SignerCertificate: { Subject: APPLE_DN },
    })).toBe(false);
  });

  it('refuses an unsigned executable against a pin', () => {
    expect(signatureSatisfies('Acme Inc', { Status: 2, SignerCertificate: null })).toBe(false);
  });

  it('passes a valid signature whose common name matches the pin', () => {
    expect(signatureSatisfies('Acme Inc', {
      Status: 0,
      SignerCertificate: { Subject: 'C=US, O=Acme Inc, CN=Acme Inc' },
    })).toBe(true);
  });

  it('refuses a valid signature by someone else', () => {
    expect(signatureSatisfies('Acme Inc', {
      Status: 0,
      SignerCertificate: { Subject: 'C=US, O=Other, CN=Other Corp' },
    })).toBe(false);
  });

  it('compares every field a full-DN pin names', () => {
    const probe = { Status: 0, SignerCertificate: { Subject: 'C=US, O=Acme Inc, CN=Acme Inc' } };
    expect(signatureSatisfies('CN=Acme Inc, O=Acme Inc', probe)).toBe(true);
    expect(signatureSatisfies('CN=Acme Inc, O=Other', probe)).toBe(false);
  });
});
