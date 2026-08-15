// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  glTF material/image/node import: what the products say about each other.
 *
 * The pixel gates prove the chain end to end, but only for the files they draw.
 * These cover the shapes those are not: an image in a GLB chunk, an image
 * already on disk, a node given as a matrix, a file with no node tree at all.
 */
import { describe, it, expect } from 'vitest';
import {
  importGltfMeshes, assembleGltfPrefab, type ImportedMesh, type PrefabAssembly,
} from '../../pipeline/src/assets/gltfImport';
import { MeshChannel } from 'esengine';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** POSITION x3 (VEC3) + TEXCOORD_0 x3 (VEC2) + 3 indices, as one data-uri buffer. */
function geometryBuffer(): { uri: string; views: unknown[]; accessors: unknown[] } {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const bytes = Buffer.concat([
    Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer),
  ]);
  return {
    uri: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
    views: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
}

function gltf(extra: Record<string, unknown>, primitives?: unknown[]): Uint8Array {
  const geo = geometryBuffer();
  const doc = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 66, uri: geo.uri }],
    bufferViews: geo.views,
    accessors: geo.accessors,
    meshes: [{
      name: 'Tri',
      primitives: primitives ?? [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4,
      }],
    }],
    ...extra,
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

/** The material every case below varies from: one baseColor image, one factor. */
function withInlineImage(): Record<string, unknown> {
  return {
    images: [{ mimeType: 'image/png', uri: `data:image/png;base64,${PNG_1PX}` }],
    textures: [{ source: 0 }],
    materials: [{
      name: 'Base',
      pbrMetallicRoughness: {
        baseColorFactor: [0.25, 0.5, 0.75, 1], baseColorTexture: { index: 0 },
        metallicFactor: 0,
      },
    }],
  };
}

function texCoords(mesh: ImportedMesh): number[] {
  const channel = mesh.data.channels.find(c => c.semantic === MeshChannel.TexCoord0)!;
  const view = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
  const out: number[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    const at = i * mesh.data.vertexStride + channel.offset;
    out.push(view.getFloat32(at, true), view.getFloat32(at + 4, true));
  }
  return out;
}

describe('glTF material import', () => {
  it('extracts an inline image and names it in the material', () => {
    const { meshes, textures, warnings } = importGltfMeshes(gltf(withInlineImage()), 'model');
    expect(warnings).toEqual([]);
    expect(textures).toHaveLength(1);
    expect(textures[0]!.name).toBe('model_0.png');
    expect(textures[0]!.bytes.length).toBeGreaterThan(0);
    expect(meshes[0]!.material).toMatchObject({
      baseColor: [0.25, 0.5, 0.75, 1],
      baseColorTexture: { file: 'model_0.png', external: false },
    });
  });

  it('references an image already on disk instead of copying it', () => {
    const doc = withInlineImage();
    doc.images = [{ uri: 'textures/diffuse%20map.png' }];
    const { meshes, textures } = importGltfMeshes(gltf(doc), 'model');
    expect(textures).toEqual([]);
    expect(meshes[0]!.material?.baseColorTexture)
      .toEqual({ file: 'textures/diffuse map.png', external: true });
  });

  it('reads an image out of a GLB binary chunk', () => {
    const png = Buffer.from(PNG_1PX, 'base64');
    const geo = geometryBuffer();
    const bin = Buffer.concat([Buffer.from(geo.uri.split(',')[1]!, 'base64'), png]);
    const json = Buffer.from(JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        ...(geo.views as { byteLength: number }[]),
        { buffer: 0, byteOffset: 66, byteLength: png.length },
      ],
      accessors: geo.accessors,
      images: [{ mimeType: 'image/png', bufferView: 3 }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4,
      }] }],
    }));
    const pad = (b: Buffer, fill: number) =>
      Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
    const jsonChunk = pad(json, 0x20);
    const binChunk = pad(bin, 0);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
    const chunk = (body: Buffer, kind: number) => {
      const head = Buffer.alloc(8);
      head.writeUInt32LE(body.length, 0);
      head.writeUInt32LE(kind, 4);
      return Buffer.concat([head, body]);
    };
    const glb = Buffer.concat([
      header, chunk(jsonChunk, 0x4e4f534a), chunk(binChunk, 0x004e4942),
    ]);

    const { meshes, textures } = importGltfMeshes(new Uint8Array(glb), 'robot');
    expect(textures).toHaveLength(1);
    expect(textures[0]!.name).toBe('robot_0.png');
    expect(Buffer.from(textures[0]!.bytes).equals(png)).toBe(true);
    expect(meshes[0]!.material?.baseColorTexture?.file).toBe('robot_0.png');
  });

  it('reports the PBR channels it cannot draw rather than dropping them', () => {
    const doc = withInlineImage();
    doc.materials = [{
      name: 'Metal',
      pbrMetallicRoughness: { metallicFactor: 1, roughnessFactor: 0.3 },
      normalTexture: { index: 0, scale: 0.4 }, emissiveFactor: [1, 0, 0],
      alphaMode: 'MASK', alphaCutoff: 0.4, doubleSided: false,
      extensions: { KHR_materials_clearcoat: {} },
    }];
    const { warnings } = importGltfMeshes(gltf(doc), 'model');
    const line = warnings.join('\n');
    expect(line).toContain('metallic-roughness');
    expect(line).toContain('normal-map scale 0.4');
    expect(line).toContain('emissive');
    expect(line).toContain('alpha cutoff 0.4');
    expect(line).toContain('backfaces are not culled');
    expect(line).toContain('KHR_materials_clearcoat');
  });

  it('carries a normal map, extracting its image like any other', () => {
    const doc = withInlineImage();
    doc.images = [
      { mimeType: 'image/png', uri: `data:image/png;base64,${PNG_1PX}` },
      { uri: 'bump.png' },
    ];
    doc.textures = [{ source: 0 }, { source: 1 }];
    (doc.materials as { normalTexture?: unknown }[])[0]!.normalTexture = { index: 1 };
    const { meshes, warnings } = importGltfMeshes(gltf(doc), 'model');
    expect(warnings).toEqual([]);
    expect(meshes[0]!.material?.normalTexture)
      .toEqual({ file: 'bump.png', external: true });
  });

  it('skips a Draco-compressed primitive rather than reading zeroes', () => {
    const doc = {
      ...withInlineImage(),
      // Draco holds the geometry itself, so the accessors point at nothing.
      accessors: [
        { componentType: 5126, count: 3, type: 'VEC3' },
        { componentType: 5126, count: 3, type: 'VEC2' },
        { componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const { meshes, warnings } = importGltfMeshes(gltf(doc, [{
      attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4,
      extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } },
    }]), 'model');
    expect(meshes).toEqual([]);
    expect(warnings.join('\n')).toContain('Draco-compressed');
    expect(warnings.join('\n')).toContain('re-export without compression');
  });

  it('skips a primitive whose POSITION carries no data', () => {
    const doc = {
      ...withInlineImage(),
      accessors: [
        { componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const { meshes, warnings } = importGltfMeshes(gltf(doc), 'model');
    expect(meshes).toEqual([]);
    expect(warnings.join('\n')).toContain('POSITION has no data');
  });

  it('applies a sparse accessor, which is the geometry it actually has', () => {
    // Replaces vertex 1's position; the base view is the ordinary one.
    const target = Buffer.alloc(2);
    target.writeUInt16LE(1, 0);
    const value = Buffer.from(new Float32Array([9, 9, 9]).buffer);
    const extra = Buffer.concat([target, value]);
    const geo = geometryBuffer();
    const base = Buffer.from(geo.uri.split(',')[1]!, 'base64');
    const bytes = Buffer.concat([base, extra]);
    const doc = {
      ...withInlineImage(),
      buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
      bufferViews: [
        ...(geo.views as unknown[]),
        { buffer: 0, byteOffset: 66, byteLength: 2 },
        { buffer: 0, byteOffset: 68, byteLength: 12 },
      ],
      accessors: [
        {
          bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
          sparse: {
            count: 1,
            indices: { bufferView: 3, componentType: 5123 },
            values: { bufferView: 4 },
          },
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const { meshes } = importGltfMeshes(gltf(doc), 'model');
    expect(meshes[0]!.data.aabbMax).toEqual([9, 9, 9]);
  });

  it("flips V, because glTF's uv origin is the image's top-left", () => {
    const { meshes } = importGltfMeshes(gltf(withInlineImage()), 'model');
    expect(texCoords(meshes[0]!)).toEqual([0, 1, 1, 1, 0, 0]);
  });
});

describe('glTF prefab assembly', () => {
  const assemble = (bytes: Uint8Array, options: Partial<PrefabAssembly> = {}) => {
    const { meshes, nodes } = importGltfMeshes(bytes, 'model');
    return assembleGltfPrefab('model', meshes, { nodes, ...options });
  };
  const oneNode = { nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };

  it('draws a single-primitive node from the node itself', () => {
    const prefab = assemble(gltf({ ...withInlineImage(), ...oneNode }),
                            { refs: { prefix: 'assets/models/' } });
    expect(prefab.entities).toHaveLength(1);
    expect(prefab.rootEntityId).toBe('n0');
    expect(prefab.entities[0]!.components[1]).toEqual({
      type: 'Mesh2D',
      data: {
        mesh: 'assets/models/model.esmesh',
        texture: 'assets/models/model_0.png',
        color: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
        enabled: true,
      },
    });
  });

  it('hangs a node’s further primitives off it', () => {
    const two = [
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 },
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4 },
    ];
    const prefab = assemble(gltf({ ...withInlineImage(), ...oneNode }, two));
    expect(prefab.entities.map(e => e.prefabEntityId)).toEqual(['n0', 'n0_p0', 'n0_p1']);
    expect(prefab.entities[0]!.children).toEqual(['n0_p0', 'n0_p1']);
    expect(prefab.entities[1]!.parent).toBe('n0');
    // The second primitive names no material: no texture, no tint, engine defaults.
    expect(prefab.entities[2]!.components[1]!.data).toEqual({
      mesh: 'model_0_1.esmesh', enabled: true,
    });
  });

  it('places each node where the source puts it, parents included', () => {
    const doc = {
      ...withInlineImage(),
      nodes: [
        { name: 'Model', translation: [40, 0, 0], children: [1, 2] },
        { name: 'Left', mesh: 0, translation: [-120, 60, 0] },
        { name: 'Right', mesh: 0, scale: [0.5, 0.5, 1] },
      ],
      scenes: [{ nodes: [0] }], scene: 0,
    };
    const prefab = assemble(gltf(doc));
    expect(prefab.entities.map(e => e.name)).toEqual(['Model', 'Left', 'Right']);
    expect(prefab.entities[0]!.components[0]!.data)
      .toEqual({ position: { x: 40, y: 0, z: 0 } });
    expect(prefab.entities[1]!.components[0]!.data)
      .toEqual({ position: { x: -120, y: 60, z: 0 } });
    expect(prefab.entities[2]!.components[0]!.data)
      .toEqual({ scale: { x: 0.5, y: 0.5, z: 1 } });
    // One mesh drawn by two nodes is one product referenced twice.
    expect(prefab.entities[1]!.components[1]!.data.mesh)
      .toBe(prefab.entities[2]!.components[1]!.data.mesh);
  });

  it('decomposes a node given as a matrix', () => {
    const doc = {
      ...withInlineImage(),
      // 90° about Z, scaled 2, moved to (10, 20, 30) — column-major.
      nodes: [{ mesh: 0, matrix: [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1] }],
      scenes: [{ nodes: [0] }], scene: 0,
    };
    const data = assemble(gltf(doc)).entities[0]!.components[0]!.data as {
      position: { x: number }; rotation: { z: number; w: number }; scale: { x: number };
    };
    expect(data.position).toEqual({ x: 10, y: 20, z: 30 });
    expect(data.scale.x).toBeCloseTo(2);
    expect(data.rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(data.rotation.w).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves out a normal map the geometry has no normals for', () => {
    const doc = withInlineImage();
    doc.images = [
      { mimeType: 'image/png', uri: `data:image/png;base64,${PNG_1PX}` },
      { uri: 'bump.png' },
    ];
    doc.textures = [{ source: 0 }, { source: 1 }];
    (doc.materials as { normalTexture?: unknown }[])[0]!.normalTexture = { index: 1 };
    // The fixture's primitive declares no NORMAL, so the engine draws it unlit —
    // a normal map there would be a ref to something nothing reads.
    const prefab = assemble(gltf({ ...doc, ...oneNode }));
    expect(prefab.entities[0]!.components[1]!.data.normalMap).toBeUndefined();
  });

  it('scales the root, since a glTF is in metres', () => {
    const prefab = assemble(gltf({ ...withInlineImage(), ...oneNode }), { scale: 32 });
    expect(prefab.entities[0]!.components[0]!.data)
      .toEqual({ scale: { x: 32, y: 32, z: 32 } });
  });

  it('lays the meshes under a holder when the file has no nodes', () => {
    const prefab = assemble(gltf(withInlineImage()));
    expect(prefab.entities.map(e => e.prefabEntityId)).toEqual(['root', 'm0']);
    expect(prefab.entities[1]!.parent).toBe('root');
  });

  it('spells an external image through the project resolver', () => {
    const doc = withInlineImage();
    doc.images = [{ uri: '../textures/skin.png' }];
    const prefab = assemble(gltf({ ...doc, ...oneNode }), {
      refs: {
        prefix: 'assets/models/',
        external: uri => `assets/${uri.replace('../', '')}`,
      },
    });
    expect(prefab.entities[0]!.components[1]!.data.texture).toBe('assets/textures/skin.png');
  });
});
