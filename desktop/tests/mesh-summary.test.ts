// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  mesh-summary.test.ts — a `.esmesh` describing itself to the inspector.
 *
 * The file is the authority (its channel table is written out per mesh), so the
 * summary is read from the bytes rather than inferred from the import that made
 * them — a hand-authored mesh has to read the same way.
 */
import { describe, it, expect } from 'vitest';
import { encodeMesh, packChannels, MeshChannel, MeshChannelType } from 'esengine';
import { summarizeMesh } from '@/engine/meshSummary';

/** One quad, 200 x 100, with the channels a lit import writes. */
function quad(withNormals: boolean): Uint8Array {
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
    ...(withNormals
      ? [{ semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 }] : []),
  ]);
  return encodeMesh({
    channels,
    vertexStride,
    vertexCount: 4,
    vertices: new Uint8Array(4 * vertexStride),
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
    aabbMin: [-100, -50, 0],
    aabbMax: [100, 50, 0],
  });
}

describe('summarizeMesh', () => {
  it('reads the counts, the size and the channels the file declares', () => {
    expect(summarizeMesh(quad(true))).toEqual({
      vertices: 4,
      triangles: 2,
      extent: '200 × 100',   // flat: the depth is not a dimension worth a column
      channels: 'position, uv, color, normal',
    });
  });

  it('says which channels are absent by not naming them', () => {
    expect(summarizeMesh(quad(false))?.channels).toBe('position, uv, color');
  });

  it('reports depth when the geometry has some', () => {
    const { channels, vertexStride } = packChannels([
      { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    ]);
    const box = encodeMesh({
      channels, vertexStride, vertexCount: 3,
      vertices: new Uint8Array(3 * vertexStride),
      indices: Uint32Array.from([0, 1, 2]),
      aabbMin: [0, 0, 0], aabbMax: [1.5, 2, 3],
    });
    expect(summarizeMesh(box)?.extent).toBe('1.5 × 2 × 3');
  });

  it('answers null for bytes that are not a mesh', () => {
    expect(summarizeMesh(new TextEncoder().encode('not a mesh at all'))).toBeNull();
  });
});
