// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The shapes a morphable `.esmesh` carries, beside the pose it may also
 *        carry, and the older files that have neither.
 *
 * A delta is addressed by (target, vertex), so what this pins is that the two
 * indices come back meaning the same thing they went in meaning — a stride read
 * one target off is geometry that deforms into the wrong shape.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeMesh, decodeMesh, packChannels, MeshChannel, MeshChannelType, type MeshData,
} from '../src/asset/meshFormat';

const POSITION_ONLY = packChannels([
  { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
]);

/** Three vertices and whatever the caller morphs or poses them by. */
function mesh(extra: Partial<MeshData>): MeshData {
  return {
    ...POSITION_ONLY, vertexCount: 3,
    vertices: new Uint8Array(3 * POSITION_ONLY.vertexStride),
    indices: Uint32Array.from([0, 1, 2]),
    aabbMin: [0, 0, 0], aabbMax: [1, 1, 0],
    ...extra,
  };
}

/** Two targets over three vertices: the first lifts vertex 1, the second vertex 2. */
function twoTargets(): Float32Array {
  const deltas = new Float32Array(2 * 3 * 3);
  deltas[1 * 3 + 1] = 4;          // target 0, vertex 1, y
  deltas[9 + 2 * 3 + 1] = 7;      // target 1, vertex 2, y
  return deltas;
}

describe('.esmesh morph targets', () => {
  it('round-trips the names and the deltas each one addresses', () => {
    const decoded = decodeMesh(encodeMesh(mesh({
      morph: { names: ['Smile', 'Blink'], hasNormals: false, deltas: twoTargets() },
    })));

    expect(decoded.morph?.names).toEqual(['Smile', 'Blink']);
    expect(decoded.morph?.hasNormals).toBe(false);
    expect(decoded.morph?.deltas).toHaveLength(18);
    expect(decoded.morph!.deltas[1 * 3 + 1]).toBe(4);
    expect(decoded.morph!.deltas[9 + 2 * 3 + 1]).toBe(7);
    // The rest is untouched geometry: a target says nothing where it is zero.
    expect([...decoded.morph!.deltas].filter((d) => d !== 0)).toHaveLength(2);
  });

  it('carries a normal delta behind each position delta when the targets have one', () => {
    const deltas = new Float32Array(1 * 3 * 6);
    deltas[0] = 1;                 // vertex 0, position.x
    deltas[3] = -1;                // vertex 0, normal.x
    deltas[6 + 4] = 0.5;           // vertex 1, normal.y
    const decoded = decodeMesh(encodeMesh(mesh({
      morph: { names: ['Pucker'], hasNormals: true, deltas },
    })));

    expect(decoded.morph?.hasNormals).toBe(true);
    // Six floats per vertex, not three: the stride is what tells a reader which
    // vertex a delta belongs to, and it is the flag above that sets it.
    expect(decoded.morph?.deltas).toHaveLength(18);
    expect(decoded.morph!.deltas[3]).toBe(-1);
    expect(decoded.morph!.deltas[10]).toBe(0.5);
  });

  it('keeps the bind pose and the shapes apart when a mesh has both', () => {
    const bind = new Float32Array(16);
    for (let c = 0; c < 4; c++) bind[c * 5] = 1;
    bind[12] = 9;
    const decoded = decodeMesh(encodeMesh(mesh({
      inverseBindMatrices: bind,
      morph: { names: ['Jaw'], hasNormals: false, deltas: Float32Array.from(
        { length: 9 }, (_, i) => i + 1) },
    })));

    expect(decoded.inverseBindMatrices![12]).toBe(9);
    expect([...decoded.morph!.deltas]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('leaves geometry with no shapes without a morph section', () => {
    expect(decodeMesh(encodeMesh(mesh({}))).morph).toBeUndefined();
  });

  it('reads a file written before the morph section existed', () => {
    const bytes = encodeMesh(mesh({}));
    // The same file as a v2 writer would have produced: a 48-byte header that
    // ends at the joint count, so the channel table starts eight bytes earlier.
    const older = new Uint8Array(bytes.byteLength - 8);
    older.set(bytes.subarray(0, 48));
    older.set(bytes.subarray(56), 48);
    new DataView(older.buffer).setUint16(4, 2, true);

    const decoded = decodeMesh(older);
    expect(decoded.vertexCount).toBe(3);
    expect([...decoded.indices]).toEqual([0, 1, 2]);
    expect(decoded.morph).toBeUndefined();
  });

  it('refuses a name that runs past the section it lives in', () => {
    const bytes = encodeMesh(mesh({
      morph: { names: ['Smile'], hasNormals: false, deltas: new Float32Array(9) },
    }));
    // The name length alone, raised past the section: the bytes behind it are
    // deltas, and a reader that took them would hand back a target name made of
    // float bits — a shape the mesh does not have, under a name nothing wrote.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const nameAt = bytes.byteLength - 8 - 9 * 4;
    view.setUint16(nameAt, 40, true);

    expect(() => decodeMesh(bytes)).toThrow(/runs past the name section/);
  });
});
