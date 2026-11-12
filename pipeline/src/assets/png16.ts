// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  png16.ts — a grey PNG of 16 bits a sample, read, shrunk and written at that depth.
 *
 * A heightmap is one. The cook's own image path decodes to 8 bits a channel, which is 256 steps of ground where the file
 * holds 65536; a size cap on a heightmap goes through here instead.
 */
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

export interface Grey16 { width: number; height: number; data: Uint16Array }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The image, or null when the file is not a non-interlaced grey PNG of 16 bits (anything else keeps to the 8-bit path, or ships as it is). */
export function decodeGrey16(png: Uint8Array): Grey16 | null {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (buf[24] !== 16 || buf[25] !== 0 || buf[28] !== 0) return null;
  const parts: Buffer[] = [];
  for (let at = 8; at + 12 <= buf.length;) {
    const length = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') parts.push(buf.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 2;
  if (raw.length < height * (stride + 1)) return null;
  const data = new Uint16Array(width * height);
  const line = Buffer.alloc(stride), above = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const left = i >= 2 ? line[i - 2]! : 0, up = above[i]!, corner = i >= 2 ? above[i - 2]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      line[i] = (line[i]! + predicted) & 255;
    }
    for (let x = 0; x < width; x++) data[y * width + x] = (line[x * 2]! << 8) | line[x * 2 + 1]!;
    line.copy(above);
  }
  return { width, height, data };
}

/** The image with its longer side at most @p maxDim, each sample the mean of the samples it covers. The same image when it already is. */
export function downscaleGrey16(image: Grey16, maxDim: number): Grey16 {
  const longest = Math.max(image.width, image.height);
  if (!(maxDim > 0) || longest <= maxDim) return image;
  const width = Math.max(1, Math.round((image.width * maxDim) / longest)), height = Math.max(1, Math.round((image.height * maxDim) / longest));
  const data = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * image.height) / height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * image.width) / width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      let sum = 0;
      for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) sum += image.data[v * image.width + u]!;
      data[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, data };
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

/** A grey PNG of 16 bits a sample. */
export function encodeGrey16(image: Grey16): Uint8Array {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  const rows = Buffer.alloc(height * (1 + width * 2));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 2);
    // Sub: a height field is smooth along a row, and the difference from the sample before deflates far better than the sample.
    rows[at] = 1;
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x]!, before = x > 0 ? data[y * width + x - 1]! : 0;
      rows[at + 1 + x * 2] = ((v >> 8) - (before >> 8)) & 255;
      rows[at + 2 + x * 2] = ((v & 255) - (before & 255)) & 255;
    }
  }
  return new Uint8Array(Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
