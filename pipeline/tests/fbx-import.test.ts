// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FBX import: what the products say, from geometry to bind pose to clip.
 *
 * The claims here are the ones a format conversion gets wrong quietly — units,
 * the uv origin, which matrix is the bind pose, which entity a track drives —
 * so each is asserted against a fixture whose numbers are written out in
 * `scripts/lib/fbxFixtures.mjs` rather than hidden in a binary.
 */
import { describe, it, expect } from 'vitest';
import { importFbxMeshes } from '../src/assets/fbxImport';
import { assembleModelPrefab, materialProducts,
         type ImportedMesh, type ImportedNode } from '../src/assets/modelImport';
import { MeshChannel } from 'esengine';
import { texturedTriangle, skinnedBar } from './fixtures/fbxFixtures.mjs';

/** One channel's floats for vertex `index`, read back out of the packed buffer. */
function attribute(mesh: ImportedMesh, semantic: number, index: number, comps: number): number[] {
  const channel = mesh.data.channels.find(c => c.semantic === semantic)!;
  const view = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
  const at = index * mesh.data.vertexStride + channel.offset;
  return Array.from({ length: comps }, (_, c) => view.getFloat32(at + c * 4, true));
}

/** Every node of the tree, flattened, so a test can find one by name. */
function flatten(nodes: ImportedNode[]): ImportedNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}

describe('fbx geometry', () => {
  it('keeps the source units — a metre stays a world unit', async () => {
    const { meshes, warnings } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    expect(warnings).toEqual([]);
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0]!;
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
    // The fixture's UnitScaleFactor is 100 (centimetres to a metre), so the
    // vertices arrive as authored rather than a hundredth of that.
    expect(mesh.data.aabbMin).toEqual([0, 0, 0]);
    expect(mesh.data.aabbMax).toEqual([2, 2, 0]);
  });

  it('reads uvs with the origin FBX puts them in', async () => {
    const { meshes } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    const mesh = meshes[0]!;
    // (0,0), (1,0), (0,1) as authored. A glTF would arrive flipped in v — its
    // origin is the image's top left — and flipping these too would put the
    // texture on upside down.
    const uvs = [0, 1, 2].map(i => attribute(mesh, MeshChannel.TexCoord0, i, 2));
    const corner = (u: number, v: number): number[] | undefined =>
      uvs.find(([a, b]) => Math.abs(a! - u) < 1e-6 && Math.abs(b! - v) < 1e-6);
    expect(corner(0, 0)).toBeDefined();
    expect(corner(1, 0)).toBeDefined();
    expect(corner(0, 1)).toBeDefined();
  });

  it('carries the normals the source declares', async () => {
    const { meshes } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    expect(attribute(meshes[0]!, MeshChannel.Normal, 0, 3)).toEqual([0, 0, 1]);
  });

  it('triangulates a quad', async () => {
    const { meshes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    expect(meshes[0]!.triangleCount).toBe(2);
    expect(meshes[0]!.vertexCount).toBe(4);
  });
});

describe('fbx hierarchy', () => {
  it('places geometry by its node, not by the geometry', async () => {
    const { nodes, meshes } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    expect(nodes).toHaveLength(1);
    const node = nodes[0]!;
    expect(node.name).toBe('Tri');
    expect(node.translation).toEqual([1, 2, 3]);
    expect(node.meshes).toEqual([0]);
    // The vertices themselves stay at the origin: moving them AND the node
    // would place the triangle twice.
    expect(meshes[0]!.data.aabbMin).toEqual([0, 0, 0]);
  });

  it('drops the scene root, which is ufbx\'s and not the artist\'s', async () => {
    const { nodes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    expect(nodes.map(n => n.name)).toEqual(['Bar', 'Bone1']);
    expect(flatten(nodes).map(n => n.name)).toContain('Bone2');
  });
});

describe('fbx materials', () => {
  it('reads a Phong material as the engine\'s own terms', async () => {
    const { meshes } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    const material = meshes[0]!.material!;
    expect(material.baseColor).toEqual([1, 0, 0, 1]);
    expect(material.emissive).toEqual([0, 0.5, 0]);
    // A Phong material has no metalness; reporting one would invent a surface.
    expect(material.metallic).toBe(0);
    // Its roughness IS derived, from the specular exponent the fixture sets.
    expect(material.roughness).toBeGreaterThan(0);
    expect(material.roughness).toBeLessThan(1);
    expect(material.opaque).toBe(true);
  });

  it('references an image beside the source instead of copying it', async () => {
    const { meshes, textures, externalFiles } = await importFbxMeshes(
      texturedTriangle(), 'tri', 'tri.fbx');
    const image = meshes[0]!.material!.baseColorTexture!;
    expect(image).toMatchObject({ file: 'textures/brick.png', external: true });
    // Windows-authored paths reach the project with the separators every other
    // reader here resolves.
    expect(image.file).not.toContain('\\');
    expect(textures).toEqual([]);
    expect(externalFiles).toEqual(['textures/brick.png']);
  });

  it('writes an .esmaterial for what a MeshRenderer cannot say', async () => {
    const { meshes } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    const products = materialProducts(meshes, 'tri');
    expect(products).toHaveLength(1);
    expect(products[0]!.data.properties).toMatchObject({
      u_metallic: 0,
      u_emissive: { r: 0, g: 0.5, b: 0, a: 1 },
    });
  });
});

describe('fbx skinning', () => {
  it('binds the mesh to the bone entities the prefab will hold', async () => {
    const { meshes, nodes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    const mesh = meshes[0]!;
    const named = new Map(flatten(nodes).map(n => [n.name, n.index]));
    expect(mesh.skinJoints).toEqual([named.get('Bone1'), named.get('Bone2')]);

    const prefab = assembleModelPrefab('bar', meshes, { nodes });
    const skin = prefab.entities.flatMap(e => e.components)
      .find(c => c.type === 'MeshSkin')!;
    const joints = (skin.data as { joints: string[] }).joints;
    const ids = new Set(prefab.entities.map(e => e.prefabEntityId));
    // Every joint names an entity this same prefab defines; a joint pointing at
    // nothing is a mesh that collapses to the origin at runtime.
    for (const joint of joints) expect(ids.has(joint)).toBe(true);
  });

  it('carries the bind pose as the inverse of where the bone was', async () => {
    const { meshes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    const matrices = meshes[0]!.data.inverseBindMatrices!;
    expect(matrices).toHaveLength(32);
    // Bone1 is bound at the origin, Bone2 one unit up — so undoing the bind
    // pose is identity for the first and a step DOWN for the second.
    expect([...matrices.slice(12, 15)]).toEqual([0, 0, 0]);
    expect([...matrices.slice(28, 31)].map(v => Math.round(v))).toEqual([0, -1, 0]);
  });

  it('normalizes the weights it keeps', async () => {
    const { meshes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    const mesh = meshes[0]!;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const sum = attribute(mesh, MeshChannel.Weights, i, 4).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

describe('fbx animation', () => {
  it('bakes the euler curves into a clip the runtime can play', async () => {
    const { animations, nodes } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    expect(animations).toHaveLength(1);
    const clip = animations[0]!;
    expect(clip.name).toBe('bar_Take_001');
    const doc = clip.document as {
      duration: number;
      tracks: { name: string; childPath: string; component: string;
                channels: { property: string; keyframes: { time: number; value: number }[] }[] }[];
    };
    expect(doc.duration).toBeCloseTo(1, 6);
    expect(doc.tracks).toHaveLength(1);
    const track = doc.tracks[0]!;
    expect(track.name).toBe('Bone2');
    expect(track.component).toBe('Transform');
    // The path the clip addresses has to be the one the prefab builds, or the
    // track resolves to nothing and the model stands still.
    const prefab = assembleModelPrefab('bar', [], { nodes });
    const byId = new Map(prefab.entities.map(e => [e.prefabEntityId, e]));
    let entity = byId.get(prefab.rootEntityId)!;
    for (const step of track.childPath.split('/')) {
      entity = entity.children.map(id => byId.get(id)!).find(e => e.name === step)!;
      expect(entity).toBeDefined();
    }
    expect(entity.name).toBe('Bone2');
  });

  it('turns a quarter circle about Z, as the source says', async () => {
    const { animations } = await importFbxMeshes(skinnedBar(), 'bar', 'bar.fbx');
    const doc = animations[0]!.document as {
      tracks: { channels: { property: string; keyframes: { time: number; value: number }[] }[] }[];
    };
    const channels = new Map(doc.tracks[0]!.channels.map(c => [c.property, c.keyframes]));
    const last = (property: string): number => {
      const keys = channels.get(property)!;
      return keys[keys.length - 1]!.value;
    };
    // 90° about Z is (0, 0, sin45, cos45) — the components a Transform holds.
    expect(last('rotation.x')).toBeCloseTo(0, 5);
    expect(last('rotation.y')).toBeCloseTo(0, 5);
    expect(Math.abs(last('rotation.z'))).toBeCloseTo(Math.SQRT1_2, 4);
    expect(Math.abs(last('rotation.w'))).toBeCloseTo(Math.SQRT1_2, 4);
    // Every keyframe is a unit quaternion; a track that drifts off the unit
    // sphere scales the model as it turns.
    const keys = channels.get('rotation.x')!.length;
    for (let k = 0; k < keys; k++) {
      const q = ['x', 'y', 'z', 'w'].map(a => channels.get(`rotation.${a}`)![k]!.value);
      expect(Math.hypot(...q)).toBeCloseTo(1, 5);
    }
  });
});

describe('fbx reporting', () => {
  it('says what a file carries that this import has no place for', async () => {
    const { warnings } = await importFbxMeshes(texturedTriangle(), 'tri', 'tri.fbx');
    // The fixture is entirely importable; a warning here would mean the reader
    // is complaining about something it did in fact carry.
    expect(warnings).toEqual([]);
  });

  it('refuses a file that is not an FBX at all', async () => {
    await expect(importFbxMeshes(new TextEncoder().encode('not an fbx'), 'x', 'x.fbx'))
      .rejects.toThrow();
  });
});
