// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  meshSummary.ts — what a `.esmesh` is, in the words the inspector shows.
 *
 * A mesh is the one asset whose file says everything about it and whose panel
 * said nothing: an import writes several, named by index, and the only way to
 * tell a body from a banner was to draw them. The file is self-describing —
 * channel table, vertex count, bounds — so this reads it rather than guessing
 * from a thumbnail.
 */
import { decodeMesh, MeshChannel } from 'esengine';

export interface MeshSummary {
  vertices: number;
  triangles: number;
  /** Local-space size, `w × h` (× d when the geometry has depth). */
  extent: string;
  /** The channels the file declares, in its own order: `position, uv, normal`. */
  channels: string;
  /** Whether it carries normals — geometry authored to be shaded. */
  hasNormals: boolean;
}

const CHANNEL_NAMES: Record<number, string> = {
  [MeshChannel.Position]: 'position',
  [MeshChannel.TexCoord0]: 'uv',
  [MeshChannel.Color]: 'color',
  [MeshChannel.Normal]: 'normal',
  [MeshChannel.Tangent]: 'tangent',
  [MeshChannel.Joints]: 'joints',
  [MeshChannel.Weights]: 'weights',
};

/** Trim a measurement to something readable without lying about a small one. */
function num(v: number): string {
  return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
}

/** Describe the mesh in `bytes`, or null when they are not a `.esmesh`. */
export function summarizeMesh(bytes: Uint8Array): MeshSummary | null {
  let mesh;
  try {
    mesh = decodeMesh(bytes);
  } catch {
    return null;
  }
  const size = mesh.aabbMax.map((v, i) => v - (mesh.aabbMin[i] ?? 0));
  const flat = Math.abs(size[2] ?? 0) < 1e-6;
  return {
    vertices: mesh.vertexCount,
    triangles: Math.floor(mesh.indices.length / 3),
    extent: (flat ? size.slice(0, 2) : size).map(num).join(' × '),
    channels: mesh.channels
      .map((c) => CHANNEL_NAMES[c.semantic] ?? `#${c.semantic}`)
      .join(', '),
    hasNormals: mesh.channels.some((c) => c.semantic === MeshChannel.Normal),
  };
}

/** Read and describe the mesh at a project path; null if it cannot be read. */
export async function readMeshSummary(path: string): Promise<MeshSummary | null> {
  try {
    const res = await fetch(`estella://project/${path}`);
    if (!res.ok) return null;
    return summarizeMesh(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
