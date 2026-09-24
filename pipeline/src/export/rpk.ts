// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The quick-game package (`.rpk`): a zip with an APK-v2-style signing
 *        block ("RPK Sig Block 42") inserted before its central directory.
 *
 * The format is the 快游戏联盟's (vivo / OPPO / Xiaomi / Honor share it), written
 * here from the vendor CLI's own signer (@quick-game/cli, lib/bundle.js) and the
 * hapjs runtime's verifier (SignatureVerifier / FileListSignatureVerifier), so a
 * package needs neither the CLI nor its dependencies to be built. The byte layout
 * is checked against an independent verifier in rpk.test.ts.
 */
import { createHash, createPublicKey, sign } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

export interface RpkEntry {
  /** Package-relative path, `/`-separated. ASCII only: the runtime keys the file
   *  list by a CRC of the name's UTF-8 bytes and the vendor CLI by its low bytes,
   *  and the two agree only for ASCII. */
  readonly name: string;
  readonly data: Uint8Array;
}

export interface RpkSigningKey {
  readonly privateKeyPem: string;
  readonly certificatePem: string;
}

/**
 * The order the vendor CLI writes entries in: the entry script first, then the
 * other scripts, then `manifest.json`, then the icon, then everything else. The
 * engine starts running script as soon as it has streamed the manifest, so what
 * it needs must already be in front of it.
 */
export function orderRpkEntries<T extends { name: string }>(entries: readonly T[], iconPath: string): T[] {
  const rank = (n: string): number => (n === 'main.js' || n === 'game.js') ? 0
    : n.endsWith('.js') ? 1 : n === 'manifest.json' ? 2 : n === iconPath ? 3 : 4;
  return [...entries].sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00 in DOS time: a fixed stamp, so the same content packs to the same bytes. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A plain zip: DEFLATE entries, sizes in the local headers (no data descriptor),
 *  no directory entries, first local header at offset 0 — what the signer needs. */
export function writeZip(entries: readonly RpkEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`rpk entry "${name}" is not ASCII`);
    const nameBytes = Buffer.from(name, 'ascii');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const RSA_PKCS1_SHA256 = 0x0103;
const BLOCK_SIGNER = 0x01000101;
const BLOCK_FILE_LIST = 0x01000201;
const MAGIC = Buffer.from('RPK Sig Block 42', 'ascii');

const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const lp = (b: Buffer): Buffer => Buffer.concat([u32(b.length), b]);
const sha256 = (...parts: Buffer[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

function pemToDer(pem: string): Buffer {
  const m = /-----BEGIN [^-]+-----([A-Za-z0-9+/=\s]+)-----END [^-]+-----/.exec(pem);
  if (!m) throw new Error('certificate is not PEM');
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
}

/**
 * Insert the signing block into `zip`, whose entries are `entries` in the same
 * order. Each of the three zip sections is digested whole (no 1MB chunking — the
 * runtime's block 0x01000101 uses one chunk per section), and the end record's
 * central-directory offset is moved past the inserted block.
 */
export function signRpk(zip: Buffer, entries: readonly RpkEntry[], key: RpkSigningKey): Buffer {
  let eocd = -1;
  for (let o = zip.length - 22; o >= 0; o--) if (zip.readUInt32LE(o) === 0x06054b50) { eocd = o; break; }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const cd = zip.readUInt32LE(eocd + 16);
  const sections = [zip.subarray(0, cd), zip.subarray(cd, eocd), zip.subarray(eocd)];
  const chunkDigests = sections.map((s) => sha256(Buffer.from([0xa5]), u32(s.length), s));
  const contentDigest = sha256(Buffer.from([0x5a]), u32(sections.length), ...chunkDigests);

  const certDer = pemToDer(key.certificatePem);
  const spki = createPublicKey(key.certificatePem).export({ type: 'spki', format: 'der' });
  const signedData = Buffer.concat([
    lp(lp(Buffer.concat([u32(RSA_PKCS1_SHA256), lp(contentDigest)]))),
    lp(lp(certDer)),
    u32(0),
  ]);
  const signature = sign('sha256', signedData, key.privateKeyPem);
  const signer = Buffer.concat([
    lp(signedData),
    lp(lp(Buffer.concat([u32(RSA_PKCS1_SHA256), lp(signature)]))),
    lp(spki),
  ]);

  const digestList = Buffer.concat([
    u32(RSA_PKCS1_SHA256),
    ...entries.map(({ name, data }) => {
      const head = Buffer.alloc(6);
      head.writeUInt32LE(crc32(Buffer.from(name, 'utf8')));
      head.writeUInt16LE(32, 4);
      return Buffer.concat([head, sha256(Buffer.from(data))]);
    }),
  ]);
  const listSignature = sign('sha256', digestList, key.privateKeyPem);

  const pair = (id: number, value: Buffer): Buffer => Buffer.concat([u64(4 + value.length), u32(id), value]);
  const pairs = Buffer.concat([
    pair(BLOCK_SIGNER, lp(lp(signer))),
    pair(BLOCK_FILE_LIST, lp(Buffer.concat([lp(digestList), lp(Buffer.concat([u32(RSA_PKCS1_SHA256), lp(listSignature)]))]))),
  ]);
  const blockSize = pairs.length + 8 + MAGIC.length;
  const block = Buffer.concat([u64(blockSize), pairs, u64(blockSize), MAGIC]);

  const end = Buffer.from(sections[2]);
  end.writeUInt32LE(cd + block.length, 16);
  return Buffer.concat([sections[0], block, sections[1], end]);
}

/** Zip and sign a package whose files are `entries`. */
export function packRpk(entries: readonly RpkEntry[], iconPath: string, key: RpkSigningKey): Buffer {
  const ordered = orderRpkEntries(entries, iconPath);
  return signRpk(writeZip(ordered), ordered, key);
}

/**
 * A project's release key, read from the two PEM paths its packaging names.
 * Null when it names none; a named file that is missing is an error, because a
 * package silently signed with the debug key instead is one a store refuses.
 */
export async function readReleaseKey(
  root: string,
  paths: { privateKey: string; certificate: string } | undefined,
): Promise<RpkSigningKey | null> {
  if (!paths || (!paths.privateKey && !paths.certificate)) return null;
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try {
    return {
      privateKeyPem: await readFile(join(root, paths.privateKey), 'utf8'),
      certificatePem: await readFile(join(root, paths.certificate), 'utf8'),
    };
  } catch (e) {
    throw new Error(`the quick-game release key could not be read (${paths.privateKey}, ${paths.certificate}): ${(e as Error).message}`);
  }
}
