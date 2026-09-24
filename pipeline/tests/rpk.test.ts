// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The quick-game package, held to two things this repo did not write:
 *
 *        - the vendor CLI's signer. RSA PKCS#1 v1.5 is deterministic, so signing
 *          the same zip with the same key must give the same bytes; GOLDEN is the
 *          SHA-256 @quick-game/cli 1.9.0 (lib/bundle.js signZip) produced for the
 *          fixture below.
 *        - the runtime's verifier: `verify` follows hapjs SignatureVerifier /
 *          FileListSignatureVerifier, the code a device runs on install.
 */
import { describe, it, expect } from 'vitest';
import { createHash, createPublicKey, verify as verifySig, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { orderRpkEntries, packRpk, signRpk, writeZip, crc32, type RpkEntry } from '../src/export/rpk';
import { RPK_DEBUG_KEY } from '../src/export/rpkDebugKey';

const GOLDEN = 'ea286e46259f3c8e41b2cb9d30814dd63a5886eaa81ae59fdda64a93530a764d';

function fixture(): RpkEntry[] {
  const big = Buffer.alloc(2 * 1024 * 1024 + 17);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
  return [
    { name: 'assets/big.bin', data: big },
    { name: 'manifest.json', data: Buffer.from('{"package":"com.estella.test.minigame","icon":"/icon.png"}') },
    { name: 'icon.png', data: Buffer.from('not really a png') },
    { name: 'game.js', data: Buffer.from('require("./game-bundle.js");') },
    { name: 'game-bundle.js', data: Buffer.from('module.exports = {};') },
  ];
}

const sha256 = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** The install-time check, after hapjs: magic and sizes, the signer's signature
 *  over SignedData, the key matching the certificate, the content digest over
 *  the three zip sections, and the per-file digest list. */
function verify(rpk: Buffer, entries: readonly RpkEntry[]): void {
  let eocd = -1;
  for (let o = rpk.length - 22; o >= 0; o--) if (rpk.readUInt32LE(o) === 0x06054b50) { eocd = o; break; }
  const cd = rpk.readUInt32LE(eocd + 16);
  if (rpk.subarray(cd - 16, cd).toString('ascii') !== 'RPK Sig Block 42') throw new Error('magic');
  const size = Number(rpk.readBigUInt64LE(cd - 24));
  const blockOff = cd - (size + 8);
  if (Number(rpk.readBigUInt64LE(blockOff)) !== size) throw new Error('block size');
  const pairs = new Map<number, Buffer>();
  for (let p = blockOff + 8; p < cd - 24;) {
    const len = Number(rpk.readBigUInt64LE(p));
    pairs.set(rpk.readUInt32LE(p + 8), rpk.subarray(p + 12, p + 8 + len));
    p += 8 + len;
  }
  const rd = (b: Buffer, o: number): [Buffer, number] => { const n = b.readUInt32LE(o); return [b.subarray(o + 4, o + 4 + n), o + 4 + n]; };
  const [signers] = rd(pairs.get(0x01000101)!, 0);
  const [signer] = rd(signers, 0);
  const [signedData, o1] = rd(signer, 0);
  const [sigs, o2] = rd(signer, o1);
  const [pub] = rd(signer, o2);
  const [sigRec] = rd(sigs, 0);
  const [sigBytes] = rd(sigRec, 4);
  const key = createPublicKey({ key: pub, format: 'der', type: 'spki' });
  if (sigRec.readUInt32LE(0) !== 0x0103 || !verifySig('sha256', signedData, key, sigBytes)) throw new Error('signer signature');
  const [digests, o3] = rd(signedData, 0);
  const [digestRec] = rd(digests, 0);
  const [expected] = rd(digestRec, 4);
  const [certs] = rd(signedData, o3);
  const [certDer] = rd(certs, 0);
  const certKey = new X509Certificate(certDer).publicKey.export({ type: 'spki', format: 'der' });
  if (!certKey.equals(pub)) throw new Error('key does not match certificate');
  const end = Buffer.from(rpk.subarray(eocd));
  end.writeUInt32LE(blockOff, 16);
  const sections = [rpk.subarray(0, blockOff), rpk.subarray(cd, eocd), end];
  const actual = sha256(Buffer.concat([Buffer.from([0x5a]), u32(3),
    ...sections.map((s) => sha256(Buffer.concat([Buffer.from([0xa5]), u32(s.length), s])))]));
  if (!actual.equals(expected)) throw new Error('content digest');
  const [outer] = rd(pairs.get(0x01000201)!, 0);
  const [list, o4] = rd(outer, 0);
  const [listSig] = rd(outer, o4);
  const [listSigBytes] = rd(listSig, 4);
  if (!verifySig('sha256', list, key, listSigBytes)) throw new Error('file list signature');
  const byCrc = new Map<number, Buffer>();
  for (let q = 4; q < list.length;) {
    byCrc.set(list.readUInt32LE(q), list.subarray(q + 6, q + 6 + list.readUInt16LE(q + 4)));
    q += 6 + list.readUInt16LE(q + 4);
  }
  for (const e of entries) {
    if (!byCrc.get(crc32(Buffer.from(e.name, 'utf8')))?.equals(sha256(e.data))) throw new Error(`file digest ${e.name}`);
  }
}

/** Every entry, read back through the local headers the way an unzip does. */
function unzip(rpk: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let o = 0; rpk.readUInt32LE(o) === 0x04034b50;) {
    const size = rpk.readUInt32LE(o + 18);
    const nameLen = rpk.readUInt16LE(o + 26);
    const name = rpk.toString('ascii', o + 30, o + 30 + nameLen);
    const start = o + 30 + nameLen + rpk.readUInt16LE(o + 28);
    out.set(name, inflateRawSync(rpk.subarray(start, start + size)));
    o = start + size;
  }
  return out;
}

describe('the quick-game package', () => {
  it('signs byte for byte as the vendor CLI does', () => {
    const entries = orderRpkEntries(fixture(), 'icon.png');
    const rpk = signRpk(writeZip(entries), entries, RPK_DEBUG_KEY);
    expect(createHash('sha256').update(rpk).digest('hex')).toBe(GOLDEN);
  });

  it('passes the check a device runs on install, and fails it once a byte changes', () => {
    const entries = fixture();
    const rpk = packRpk(entries, 'icon.png', RPK_DEBUG_KEY);
    expect(() => verify(rpk, entries)).not.toThrow();
    const tampered = Buffer.from(rpk);
    tampered[100] ^= 0xff;
    expect(() => verify(tampered, entries)).toThrow('content digest');
  });

  it('is an ordinary zip underneath, every file intact', () => {
    const entries = fixture();
    const files = unzip(packRpk(entries, 'icon.png', RPK_DEBUG_KEY));
    for (const e of entries) expect(files.get(e.name)?.equals(Buffer.from(e.data))).toBe(true);
  });

  it('puts the entry script first and the manifest before the assets, as the engine streams it', () => {
    const names = [...unzip(packRpk(fixture(), 'icon.png', RPK_DEBUG_KEY)).keys()];
    expect(names).toEqual(['game.js', 'game-bundle.js', 'manifest.json', 'icon.png', 'assets/big.bin']);
  });

  it('refuses a name the runtime and the vendor tools would key differently', () => {
    expect(() => writeZip([{ name: 'assets/精灵.png', data: new Uint8Array(1) }])).toThrow('not ASCII');
  });
});
