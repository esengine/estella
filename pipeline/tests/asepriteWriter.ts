// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A minimal Aseprite writer for tests: the chunks the import reads, and
 *        nothing else.
 *
 *        Fixtures are encoded rather than checked in as binaries, for the reason
 *        the PSD test writes its own — a blob would make every expectation a
 *        number nobody could check. It states the layout independently of the
 *        reader (it shares no constant with it), so a reader that drifts off the
 *        published format cannot drag the fixture along with it.
 */
import { deflateSync } from 'node:zlib';

class Bytes {
  private parts: number[] = [];
  u8(v: number): this { this.parts.push(v & 0xff); return this; }
  u16(v: number): this { return this.u8(v).u8(v >> 8); }
  i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number): this { return this.u16(v).u16(v >>> 16); }
  i32(v: number): this { return this.u32(v < 0 ? v + 0x100000000 : v); }
  zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
  str(s: string): this {
    const b = Buffer.from(s, 'utf8');
    this.u16(b.length);
    for (const v of b) this.u8(v);
    return this;
  }
  raw(bytes: Uint8Array | Buffer): this { for (const v of bytes) this.u8(v); return this; }
  get length(): number { return this.parts.length; }
  toBuffer(): Buffer { return Buffer.from(this.parts); }
}

function chunk(type: number, body: Bytes): Bytes {
  return new Bytes().u32(body.length + 6).u16(type).raw(body.toBuffer());
}

export interface LayerSpec {
  name: string;
  visible?: boolean;
  group?: boolean;
  childLevel?: number;
  opacity?: number;
  blend?: number;
  background?: boolean;
  tilemap?: boolean;
}

export interface CelSpec {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** RGBA quadruples for depth 32, palette indices for depth 8. */
  pixels: number[];
  opacity?: number;
  zIndex?: number;
  /** Frame this cel takes its pixels from, instead of carrying its own. */
  linkTo?: number;
}

export interface FrameSpec { duration: number; cels: CelSpec[] }

export interface TagSpec { name: string; from: number; to: number; direction: number; repeat?: number }

export interface SliceSpec {
  name: string;
  x: number; y: number; w: number; h: number;
  pivot?: { x: number; y: number };
  center?: { x: number; y: number; w: number; h: number };
}

export interface DocSpec {
  width: number;
  height: number;
  depth?: 32 | 16 | 8;
  transparentIndex?: number;
  palette?: number[][];
  layers: LayerSpec[];
  frames: FrameSpec[];
  tags?: TagSpec[];
  slices?: SliceSpec[];
}

export function writeAseprite(doc: DocSpec): Uint8Array {
  const depth = doc.depth ?? 32;
  const body = new Bytes();

  for (const [index, frame] of doc.frames.entries()) {
    const chunks: Bytes[] = [];

    if (index === 0) {
      if (doc.palette) {
        const p = new Bytes().u32(doc.palette.length).u32(0).u32(doc.palette.length - 1).zeros(8);
        for (const [r, g, b, a] of doc.palette) p.u16(0).u8(r!).u8(g!).u8(b!).u8(a ?? 255);
        chunks.push(chunk(0x2019, p));
      }
      for (const layer of doc.layers) {
        chunks.push(chunk(0x2004, new Bytes()
          .u16((layer.visible === false ? 0 : 1) | (layer.background === true ? 8 : 0))
          .u16(layer.group === true ? 1 : layer.tilemap === true ? 2 : 0)
          .u16(layer.childLevel ?? 0)
          .u16(0).u16(0)
          .u16(layer.blend ?? 0)
          .u8(layer.opacity ?? 255)
          .zeros(3)
          .str(layer.name)));
      }
      for (const tag of doc.tags ?? []) {
        const t = new Bytes().u16(1).zeros(8)
          .u16(tag.from).u16(tag.to).u8(tag.direction).u16(tag.repeat ?? 0)
          .zeros(6).zeros(3).u8(0).str(tag.name);
        chunks.push(chunk(0x2018, t));
      }
      for (const slice of doc.slices ?? []) {
        const flags = (slice.center ? 1 : 0) | (slice.pivot ? 2 : 0);
        const s = new Bytes().u32(1).u32(flags).u32(0).str(slice.name)
          .u32(0).i32(slice.x).i32(slice.y).u32(slice.w).u32(slice.h);
        if (slice.center) s.i32(slice.center.x).i32(slice.center.y).u32(slice.center.w).u32(slice.center.h);
        if (slice.pivot) s.i32(slice.pivot.x).i32(slice.pivot.y);
        chunks.push(chunk(0x2022, s));
      }
    }

    for (const cel of frame.cels) {
      const head = new Bytes()
        .u16(cel.layer).i16(cel.x).i16(cel.y).u8(cel.opacity ?? 255)
        .u16(cel.linkTo !== undefined ? 1 : 2)
        .i16(cel.zIndex ?? 0).zeros(5);
      if (cel.linkTo !== undefined) {
        head.u16(cel.linkTo);
      } else {
        head.u16(cel.w).u16(cel.h).raw(deflateSync(Buffer.from(cel.pixels)));
      }
      chunks.push(chunk(0x2005, head));
    }

    const payload = new Bytes();
    for (const c of chunks) payload.raw(c.toBuffer());
    body
      .u32(payload.length + 16).u16(0xf1fa).u16(0).u16(frame.duration).zeros(2).u32(chunks.length)
      .raw(payload.toBuffer());
  }

  const header = new Bytes()
    .u32(body.length + 128).u16(0xa5e0).u16(doc.frames.length)
    .u16(doc.width).u16(doc.height).u16(depth)
    .u32(1).u16(100).u32(0).u32(0)
    .u8(doc.transparentIndex ?? 0).zeros(3)
    .u16(doc.palette?.length ?? 0)
    .u8(1).u8(1)
    .i16(0).i16(0).u16(16).u16(16)
    .zeros(84);
  if (header.length !== 128) throw new Error(`header is ${header.length} bytes, not 128`);

  return new Uint8Array(Buffer.concat([header.toBuffer(), body.toBuffer()]));
}

/** RGBA pixels of a `w`x`h` block, one colour. */
export const fill = (w: number, h: number, rgba: number[]): number[] =>
  Array.from({ length: w * h }, () => rgba).flat();
