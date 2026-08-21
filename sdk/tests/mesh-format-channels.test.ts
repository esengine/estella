// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What `decodeMesh` refuses in a channel table, and why it has to be here.
 *
 * A channel's semantic IS the shader location the engine binds it to, and the
 * per-object instance block starts at location 8. An id outside the vocabulary
 * therefore collides with that block instead of failing: WebGPU rejects the
 * pipeline with nothing naming the mesh, GL binds it and draws a wrong frame.
 * The decoder is the one reader that can see the table as a table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  encodeMesh, decodeMesh, packChannels, MeshChannel, MeshChannelType,
} from '../src/asset/meshFormat';

/** A one-vertex mesh whose channel table is then edited in place. */
function mesh(): Uint8Array {
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
  ]);
  return encodeMesh({
    channels,
    vertexStride,
    vertexCount: 1,
    vertices: new Uint8Array(vertexStride),
    indices: Uint32Array.from([0, 0, 0]),
    aabbMin: [0, 0, 0],
    aabbMax: [0, 0, 0],
  });
}

/** Where the channel table starts: the v2 header is 48 bytes. */
const TABLE = 48;

describe('decodeMesh channel table', () => {
  it('refuses a semantic the format does not define', () => {
    const bytes = mesh();
    // 9 lands inside the instance block's locations (8..12), which is the case
    // that reaches a backend as an unattributable pipeline error.
    bytes[TABLE] = 9;
    expect(() => decodeMesh(bytes)).toThrow(/semantic 9/);
  });

  it('refuses more channels than the vocabulary has', () => {
    const bytes = mesh();
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(6, 64, true);
    expect(() => decodeMesh(bytes)).toThrow(/64 channels/);
  });

  it('reads every .esmesh committed to the repo', () => {
    // The guard is only worth having if it admits what the importers actually
    // write; these are their output, cooked by the shipping pipeline.
    const dir = path.resolve(__dirname, '../../fixtures/scenes');
    const files = readdirSync(dir).filter((f) => f.endsWith('.esmesh'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(() => decodeMesh(new Uint8Array(readFileSync(path.join(dir, f)))), f).not.toThrow();
    }
  });
});
