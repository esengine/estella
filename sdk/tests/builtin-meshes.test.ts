// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The stock primitives a `builtin:<id>` mesh ref names.
 *
 * What matters about generated geometry is not that it exists but which way it
 * faces: a primitive whose winding disagrees with its normals is invisible under
 * `cullBackfaces` and lit from the inside under `lit`, and neither reads as a
 * geometry bug when you meet it.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_MESH_TEMPLATES, builtinMeshTemplate, isBuiltinMeshRef } from '../src/asset/builtinMeshes';
import { MeshChannel, MeshChannelType, type MeshData } from '../src/asset/meshFormat';

interface Vec { x: number; y: number; z: number }

function readVertex(mesh: MeshData, index: number): { p: Vec; n: Vec } {
  const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const at = index * mesh.vertexStride;
  const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!;
  const nrm = mesh.channels.find((c) => c.semantic === MeshChannel.Normal)!;
  const read = (offset: number): Vec => ({
    x: view.getFloat32(at + offset, true),
    y: view.getFloat32(at + offset + 4, true),
    z: view.getFloat32(at + offset + 8, true),
  });
  return { p: read(pos.offset), n: read(nrm.offset) };
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

describe('built-in meshes', () => {
  it('offers every primitive under a builtin: ref', () => {
    expect(BUILTIN_MESH_TEMPLATES.map((t) => t.id).sort())
      .toEqual(['capsule', 'cone', 'cube', 'cylinder', 'plane', 'quad', 'sphere']);
    for (const t of BUILTIN_MESH_TEMPLATES) {
      expect(t.ref).toBe(`builtin:${t.id}`);
      expect(isBuiltinMeshRef(t.ref)).toBe(true);
      expect(builtinMeshTemplate(t.ref)).toBe(t);
    }
  });

  // A misspelled built-in must stay a path, so the loader 404s it by name rather
  // than the ref quietly resolving to nothing at all.
  it('does not claim a ref it cannot build', () => {
    expect(isBuiltinMeshRef('builtin:teapot')).toBe(false);
    expect(isBuiltinMeshRef('assets/models/hero.esmesh')).toBe(false);
    expect(builtinMeshTemplate('builtin:teapot')).toBeUndefined();
  });

  it('writes the channel layout the model import writes', () => {
    for (const t of BUILTIN_MESH_TEMPLATES) {
      const mesh = t.build();
      expect(mesh.channels.map((c) => c.semantic)).toEqual([
        MeshChannel.Position, MeshChannel.TexCoord0, MeshChannel.Color, MeshChannel.Normal,
      ]);
      expect(mesh.channels.find((c) => c.semantic === MeshChannel.Color)!.type)
        .toBe(MeshChannelType.UNorm8);
      expect(mesh.vertexCount).toBeGreaterThan(0);
      expect(mesh.indices.length % 3).toBe(0);
      expect(mesh.inverseBindMatrices).toBeUndefined();
      for (const i of mesh.indices) expect(i).toBeLessThan(mesh.vertexCount);
    }
  });

  it('winds every triangle to agree with its own normals', () => {
    for (const t of BUILTIN_MESH_TEMPLATES) {
      const mesh = t.build();
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = readVertex(mesh, mesh.indices[i]!);
        const b = readVertex(mesh, mesh.indices[i + 1]!);
        const c = readVertex(mesh, mesh.indices[i + 2]!);
        const face = cross(sub(b.p, a.p), sub(c.p, a.p));
        const shaded = { x: a.n.x + b.n.x + c.n.x, y: a.n.y + b.n.y + c.n.y, z: a.n.z + b.n.z + c.n.z };
        expect(`${t.id}#${i / 3}: ${dot(face, shaded) > 0}`).toBe(`${t.id}#${i / 3}: true`);
      }
    }
  });

  // "Outward" only means something for geometry enclosing a volume, which is the
  // same distinction `closed` makes for depth and back-face culling.
  it('points a closed primitive\'s normals away from its middle', () => {
    const closed = BUILTIN_MESH_TEMPLATES.filter((t) => t.closed);
    expect(closed.length).toBe(5);
    for (const t of closed) {
      const mesh = t.build();
      for (let i = 0; i < mesh.vertexCount; i++) {
        const { p, n } = readVertex(mesh, i);
        expect(`${t.id}#${i}: ${dot(p, n) > 0}`).toBe(`${t.id}#${i}: true`);
      }
    }
  });

  it('builds each primitive 100 units across, centred on the origin', () => {
    for (const t of BUILTIN_MESH_TEMPLATES) {
      const mesh = t.build();
      for (let k = 0; k < 3; k++) {
        expect(mesh.aabbMin[k]).toBeCloseTo(-mesh.aabbMax[k]!, 4);
        expect(mesh.aabbMax[k]).toBeLessThanOrEqual(50.0001);
      }
      const size = Math.max(...mesh.aabbMax.map((v, k) => v - mesh.aabbMin[k]!));
      expect(size).toBeCloseTo(100, 4);
    }
  });
});
