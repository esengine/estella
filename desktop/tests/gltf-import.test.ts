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
import { plainTriangle, meshoptTriangle, dracoTriangle } from '../scripts/lib/gltfFixtures.mjs';

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
  it('extracts an inline image and names it in the material', async () => {
    const { meshes, textures, warnings } = await importGltfMeshes(gltf(withInlineImage()), 'model');
    expect(warnings).toEqual([]);
    expect(textures).toHaveLength(1);
    expect(textures[0]!.name).toBe('model_0.png');
    expect(textures[0]!.bytes.length).toBeGreaterThan(0);
    expect(meshes[0]!.material).toMatchObject({
      baseColor: [0.25, 0.5, 0.75, 1],
      baseColorTexture: { file: 'model_0.png', external: false },
    });
  });

  it('references an image already on disk instead of copying it', async () => {
    const doc = withInlineImage();
    doc.images = [{ uri: 'textures/diffuse%20map.png' }];
    const { meshes, textures } = await importGltfMeshes(gltf(doc), 'model');
    expect(textures).toEqual([]);
    expect(meshes[0]!.material?.baseColorTexture)
      .toEqual({ file: 'textures/diffuse map.png', external: true });
  });

  it('reads an image out of a GLB binary chunk', async () => {
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

    const { meshes, textures } = await importGltfMeshes(new Uint8Array(glb), 'robot');
    expect(textures).toHaveLength(1);
    expect(textures[0]!.name).toBe('robot_0.png');
    expect(Buffer.from(textures[0]!.bytes).equals(png)).toBe(true);
    expect(meshes[0]!.material?.baseColorTexture?.file).toBe('robot_0.png');
  });

  it('reports the PBR channels it cannot draw rather than dropping them', async () => {
    const doc = withInlineImage();
    doc.materials = [{
      name: 'Metal',
      pbrMetallicRoughness: { metallicFactor: 1, roughnessFactor: 0.3 },
      normalTexture: { index: 0, scale: 0.4 }, emissiveFactor: [1, 0, 0],
      alphaMode: 'MASK', alphaCutoff: 0.4, doubleSided: false,
      extensions: { KHR_materials_clearcoat: {} },
    }];
    const { warnings } = await importGltfMeshes(gltf(doc), 'model');
    const line = warnings.join('\n');
    expect(line).toContain('metallic-roughness');
    expect(line).toContain('normal-map scale 0.4');
    expect(line).toContain('emissive');
    expect(line).toContain('alpha cutoff 0.4');
    expect(line).toContain('KHR_materials_clearcoat');
  });

  it('is opaque and single-sided unless the source says otherwise', async () => {
    // Both are the glTF's own defaults, so a model arrives occluding itself the
    // way it was authored rather than as a stack of blended planes.
    const plain = (await importGltfMeshes(gltf(withInlineImage()), 'model')).meshes[0]!;
    expect(plain.material).toMatchObject({ opaque: true, cullBackfaces: true });

    const doc = withInlineImage();
    (doc.materials as Record<string, unknown>[])[0]!.alphaMode = 'BLEND';
    (doc.materials as Record<string, unknown>[])[0]!.doubleSided = true;
    const blended = (await importGltfMeshes(gltf(doc), 'model')).meshes[0]!;
    expect(blended.material).toMatchObject({ opaque: false, cullBackfaces: false });
  });

  it('carries a normal map, extracting its image like any other', async () => {
    const doc = withInlineImage();
    doc.images = [
      { mimeType: 'image/png', uri: `data:image/png;base64,${PNG_1PX}` },
      { uri: 'bump.png' },
    ];
    doc.textures = [{ source: 0 }, { source: 1 }];
    (doc.materials as { normalTexture?: unknown }[])[0]!.normalTexture = { index: 1 };
    const { meshes, warnings } = await importGltfMeshes(gltf(doc), 'model');
    expect(warnings).toEqual([]);
    expect(meshes[0]!.material?.normalTexture)
      .toEqual({ file: 'bump.png', external: true });
  });

  it('says so when a Draco blob will not decode, rather than reading zeroes', async () => {
    // The accessors of a Draco primitive point at nothing by design, so a blob
    // that fails to decode has to be reported: read as ordinary accessors, the
    // very same file is a mesh of vertices on the origin.
    const doc = {
      ...withInlineImage(),
      accessors: [
        { componentType: 5126, count: 3, type: 'VEC3' },
        { componentType: 5126, count: 3, type: 'VEC2' },
        { componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const { meshes, warnings } = await importGltfMeshes(gltf(doc, [{
      attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4,
      extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } },
    }]), 'model');
    expect(meshes).toEqual([]);
    expect(warnings.join('\n')).toContain('Draco decode failed');
  });

  it('skips a primitive whose POSITION carries no data', async () => {
    const doc = {
      ...withInlineImage(),
      accessors: [
        { componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    };
    const { meshes, warnings } = await importGltfMeshes(gltf(doc), 'model');
    expect(meshes).toEqual([]);
    expect(warnings.join('\n')).toContain('POSITION has no data');
  });

  it('applies a sparse accessor, which is the geometry it actually has', async () => {
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
    const { meshes } = await importGltfMeshes(gltf(doc), 'model');
    expect(meshes[0]!.data.aabbMax).toEqual([9, 9, 9]);
  });

  it("carries a sampler's filter and wrap as import settings", async () => {
    const doc = withInlineImage();
    doc.samplers = [{ magFilter: 9728, wrapS: 33071, wrapT: 33071 }];
    (doc.textures as { sampler?: number }[])[0]!.sampler = 0;
    const { meshes, warnings } = await importGltfMeshes(gltf(doc), 'model');
    expect(warnings).toEqual([]);
    expect(meshes[0]!.material?.baseColorTexture?.settings)
      .toEqual({ filterMode: 'nearest', wrapMode: 'clamp' });
  });

  it('says which wrap it kept when the source addresses u and v differently', async () => {
    const doc = withInlineImage();
    doc.samplers = [{ wrapS: 33071, wrapT: 10497 }];
    (doc.textures as { sampler?: number }[])[0]!.sampler = 0;
    const { meshes, warnings } = await importGltfMeshes(gltf(doc), 'model');
    expect(warnings.join('\n')).toContain('wrapS and wrapT differ');
    expect(meshes[0]!.material?.baseColorTexture?.settings?.wrapMode).toBe('clamp');
  });

  it('reports deformation it cannot carry: skins, morph targets, animations', async () => {
    const doc = {
      ...withInlineImage(),
      skins: [{}], animations: [{}],
      nodes: [{ mesh: 0, skin: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    };
    const { warnings } = await importGltfMeshes(gltf(doc, [{
      attributes: { POSITION: 0, TEXCOORD_0: 1, JOINTS_0: 1 }, indices: 2, material: 0, mode: 4,
      targets: [{}, {}],
    }]), 'model');
    const line = warnings.join('\n');
    expect(line).toContain('2 morph target(s) not imported');
    expect(line).toContain('skinning is not imported');
    expect(line).toContain('1 skin(s) not imported');
    expect(line).toContain('1 animation(s) not imported');
  });

  it('reports a uv rewrite it does not apply', async () => {
    const doc = withInlineImage();
    (doc.materials as { pbrMetallicRoughness: { baseColorTexture: Record<string, unknown> } }[])[0]!
      .pbrMetallicRoughness.baseColorTexture.extensions = { KHR_texture_transform: { scale: [2, 2] } };
    const { warnings } = await importGltfMeshes(gltf(doc), 'model');
    expect(warnings.join('\n')).toContain('KHR_texture_transform not imported');
  });

  it("flips V, because glTF's uv origin is the image's top-left", async () => {
    const { meshes } = await importGltfMeshes(gltf(withInlineImage()), 'model');
    expect(texCoords(meshes[0]!)).toEqual([0, 1, 1, 1, 0, 0]);
  });
});

describe('glTF prefab assembly', () => {
  const assemble = async (bytes: Uint8Array, options: Partial<PrefabAssembly> = {}) => {
    const { meshes, nodes } = await importGltfMeshes(bytes, 'model');
    return assembleGltfPrefab('model', meshes, { nodes, ...options });
  };
  const oneNode = { nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };

  it('draws a single-primitive node from the node itself', async () => {
    const prefab = await assemble(gltf({ ...withInlineImage(), ...oneNode }),
                            { refs: { prefix: 'assets/models/' } });
    expect(prefab.entities).toHaveLength(1);
    expect(prefab.rootEntityId).toBe('n0');
    expect(prefab.entities[0]!.components[1]).toEqual({
      type: 'Mesh2D',
      data: {
        mesh: 'assets/models/model.esmesh',
        texture: 'assets/models/model_0.png',
        color: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
        opaque: true,
        cullBackfaces: true,
        enabled: true,
      },
    });
  });

  it('hangs a node’s further primitives off it', async () => {
    const two = [
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 },
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4 },
    ];
    const prefab = await assemble(gltf({ ...withInlineImage(), ...oneNode }, two));
    expect(prefab.entities.map(e => e.prefabEntityId)).toEqual(['n0', 'n0_p0', 'n0_p1']);
    expect(prefab.entities[0]!.children).toEqual(['n0_p0', 'n0_p1']);
    expect(prefab.entities[1]!.parent).toBe('n0');
    // The second primitive names no material: no texture, no tint, engine defaults.
    expect(prefab.entities[2]!.components[1]!.data).toEqual({
      mesh: 'model_0_1.esmesh', enabled: true,
    });  // no material named: engine defaults, blended and two-sided
  });

  it('places each node where the source puts it, parents included', async () => {
    const doc = {
      ...withInlineImage(),
      nodes: [
        { name: 'Model', translation: [40, 0, 0], children: [1, 2] },
        { name: 'Left', mesh: 0, translation: [-120, 60, 0] },
        { name: 'Right', mesh: 0, scale: [0.5, 0.5, 1] },
      ],
      scenes: [{ nodes: [0] }], scene: 0,
    };
    const prefab = await assemble(gltf(doc));
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

  it('decomposes a node given as a matrix', async () => {
    const doc = {
      ...withInlineImage(),
      // 90° about Z, scaled 2, moved to (10, 20, 30) — column-major.
      nodes: [{ mesh: 0, matrix: [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1] }],
      scenes: [{ nodes: [0] }], scene: 0,
    };
    const data = (await assemble(gltf(doc))).entities[0]!.components[0]!.data as {
      position: { x: number }; rotation: { z: number; w: number }; scale: { x: number };
    };
    expect(data.position).toEqual({ x: 10, y: 20, z: 30 });
    expect(data.scale.x).toBeCloseTo(2);
    expect(data.rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(data.rotation.w).toBeCloseTo(Math.SQRT1_2);
  });

  it('leaves out a normal map the geometry has no normals for', async () => {
    const doc = withInlineImage();
    doc.images = [
      { mimeType: 'image/png', uri: `data:image/png;base64,${PNG_1PX}` },
      { uri: 'bump.png' },
    ];
    doc.textures = [{ source: 0 }, { source: 1 }];
    (doc.materials as { normalTexture?: unknown }[])[0]!.normalTexture = { index: 1 };
    // The fixture's primitive declares no NORMAL, so the engine draws it unlit —
    // a normal map there would be a ref to something nothing reads.
    const prefab = await assemble(gltf({ ...doc, ...oneNode }));
    expect(prefab.entities[0]!.components[1]!.data.normalMap).toBeUndefined();
  });

  it('scales the root, since a glTF is in metres', async () => {
    const prefab = await assemble(gltf({ ...withInlineImage(), ...oneNode }), { scale: 32 });
    expect(prefab.entities[0]!.components[0]!.data)
      .toEqual({ scale: { x: 32, y: 32, z: 32 } });
  });

  it('lays the meshes under a holder when the file has no nodes', async () => {
    const prefab = await assemble(gltf(withInlineImage()));
    expect(prefab.entities.map(e => e.prefabEntityId)).toEqual(['root', 'm0']);
    expect(prefab.entities[1]!.parent).toBe('root');
  });

  it('spells an external image through the project resolver', async () => {
    const doc = withInlineImage();
    doc.images = [{ uri: '../textures/skin.png' }];
    const prefab = await assemble(gltf({ ...doc, ...oneNode }), {
      refs: {
        prefix: 'assets/models/',
        external: uri => `assets/${uri.replace('../', '')}`,
      },
    });
    expect(prefab.entities[0]!.components[1]!.data.texture).toBe('assets/textures/skin.png');
  });
});

describe('meshopt-compressed geometry', () => {
  it('imports to the very same mesh the uncompressed file does', async () => {
    // The claim is not what the codec does — it is that compression is invisible
    // above the bufferView, which is the whole reason it can be decoded there.
    const plain = (await importGltfMeshes(plainTriangle(), 'model')).meshes[0]!;
    const packed = (await importGltfMeshes(await meshoptTriangle(), 'model')).meshes[0]!;
    expect(packed.vertexCount).toBe(plain.vertexCount);
    expect(packed.triangleCount).toBe(plain.triangleCount);
    expect([...packed.data.vertices]).toEqual([...plain.data.vertices]);
    expect([...packed.data.indices]).toEqual([...plain.data.indices]);
    expect(packed.data.channels).toEqual(plain.data.channels);
  });

  it('says nothing about it — a fallback buffer is not a missing one', async () => {
    // It declares a length and no uri by design; reporting it as unreadable would
    // send a user looking for a file that is not supposed to exist.
    const { warnings } = await importGltfMeshes(await meshoptTriangle(), 'model');
    expect(warnings).toEqual([]);
  });
});

describe('Draco-compressed geometry', () => {
  /** Every vertex as one "x,y,z/u,v" string, sorted — Draco reorders vertices to
   *  compress them, so what survives is the set of them, not their order. */
  const vertexSet = (mesh: ImportedMesh): string[] => {
    const view = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
    const at = (semantic: number): number =>
      mesh.data.channels.find(c => c.semantic === semantic)!.offset;
    const out: string[] = [];
    for (let i = 0; i < mesh.vertexCount; i++) {
      const base = i * mesh.data.vertexStride;
      const read = (offset: number, n: number): string => Array.from({ length: n },
        (_, c) => view.getFloat32(base + offset + c * 4, true).toFixed(3)).join(',');
      out.push(`${read(at(MeshChannel.Position), 3)}/${read(at(MeshChannel.TexCoord0), 2)}`);
    }
    return out.sort();
  };

  it('imports to the same triangle the uncompressed file does', async () => {
    const plain = (await importGltfMeshes(plainTriangle(), 'model')).meshes[0]!;
    const packed = (await importGltfMeshes(await dracoTriangle(), 'model')).meshes[0]!;
    expect(packed.vertexCount).toBe(plain.vertexCount);
    expect(packed.triangleCount).toBe(plain.triangleCount);
    expect(vertexSet(packed)).toEqual(vertexSet(plain));
  });

  it('reads it without complaint, accessors and all', async () => {
    // A Draco accessor has no bufferView by spec. Read as an ordinary one it is
    // "no data" — the check that catches a genuinely empty POSITION.
    const { warnings, meshes } = await importGltfMeshes(await dracoTriangle(), 'model');
    expect(warnings).toEqual([]);
    expect(meshes).toHaveLength(1);
  });
});
