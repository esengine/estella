// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The bind pose a skinned `.esmesh` carries, and the older files it must
 *        keep reading.
 *
 * The joint channel indexes the matrices in the same file, so the two travel
 * together; what this pins is that they survive the round trip intact and that
 * a mesh written before skinning existed still decodes.
 */
import { describe, it, expect } from 'vitest';
import { encodeMesh, decodeMesh, packChannels, MeshChannel, MeshChannelType } from '../src/asset/meshFormat';

/** Channels a skinned import writes, plus one vertex bound to joints 1 and 2. */
function skinnedMesh(): Uint8Array {
  const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
    { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
    { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
  ]);
  const vertices = new Uint8Array(3 * vertexStride);
  const dv = new DataView(vertices.buffer);
  const joints = channels[3]!;
  const weights = channels[4]!;
  dv.setUint16(joints.offset, 1, true);
  dv.setUint16(joints.offset + 2, 2, true);
  dv.setFloat32(weights.offset, 0.25, true);
  dv.setFloat32(weights.offset + 4, 0.75, true);

  // Two joints, the second offset 5 along x — a bind pose that is not identity.
  const bind = new Float32Array(32);
  for (let j = 0; j < 2; j++) for (let c = 0; c < 4; c++) bind[j * 16 + c * 5] = 1;
  bind[16 + 12] = 5;

  return encodeMesh({
    channels, vertexStride, vertexCount: 3, vertices,
    indices: Uint32Array.from([0, 1, 2]),
    aabbMin: [0, 0, 0], aabbMax: [1, 1, 0],
    inverseBindMatrices: bind,
  });
}

describe('.esmesh skinning', () => {
  it('round-trips the joint channel and the bind pose', () => {
    const mesh = decodeMesh(skinnedMesh());

    const joints = mesh.channels.find((c) => c.semantic === MeshChannel.Joints);
    expect(joints).toMatchObject({ components: 4, type: MeshChannelType.UInt16 });
    // Two bytes per index, not four: a stride that assumed floats would put
    // every later channel of every vertex at the wrong offset.
    const weights = mesh.channels.find((c) => c.semantic === MeshChannel.Weights)!;
    expect(weights.offset - joints!.offset).toBe(8);

    const dv = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    expect(dv.getUint16(joints!.offset, true)).toBe(1);
    expect(dv.getUint16(joints!.offset + 2, true)).toBe(2);
    expect(dv.getFloat32(weights.offset + 4, true)).toBeCloseTo(0.75, 6);

    expect(mesh.inverseBindMatrices).toHaveLength(32);
    expect(mesh.inverseBindMatrices![16 + 12]).toBe(5);
  });

  it('leaves geometry that is not skinned without a bind pose', () => {
    const { channels, vertexStride } = packChannels([
      { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    ]);
    const mesh = decodeMesh(encodeMesh({
      channels, vertexStride, vertexCount: 3,
      vertices: new Uint8Array(3 * vertexStride),
      indices: Uint32Array.from([0, 1, 2]),
      aabbMin: [0, 0, 0], aabbMax: [1, 1, 0],
    }));
    expect(mesh.inverseBindMatrices).toBeUndefined();
  });

  it('reads a file written before the bind pose section existed', () => {
    // A v1 file byte for byte: the 44-byte header has no joint count, so the
    // channel table starts four bytes earlier than it does today.
    const stride = 12;
    const header = new ArrayBuffer(44 + 8 + 3 * stride + 3 * 4);
    const dv = new DataView(header);
    dv.setUint32(0, 0x484d5345, true);
    dv.setUint16(4, 1, true);          // version 1
    dv.setUint16(6, 1, true);          // one channel
    dv.setUint32(8, stride, true);
    dv.setUint32(12, 3, true);         // three vertices
    dv.setUint32(16, 3, true);         // three indices
    dv.setFloat32(32, 1, true);        // aabbMax.x
    dv.setUint8(44, MeshChannel.Position);
    dv.setUint8(45, 3);
    dv.setUint8(46, MeshChannelType.Float32);
    for (let i = 0; i < 3; i++) dv.setUint32(44 + 8 + 3 * stride + i * 4, i, true);

    const mesh = decodeMesh(new Uint8Array(header));
    expect(mesh.channels).toHaveLength(1);
    expect(mesh.vertexCount).toBe(3);
    expect([...mesh.indices]).toEqual([0, 1, 2]);
    expect(mesh.inverseBindMatrices).toBeUndefined();
  });
});
