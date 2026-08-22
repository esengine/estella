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
import { importGltfMeshes } from '../src/assets/gltfImport';
import {
  assembleModelPrefab, materialProducts,
  type ImportedMesh, type PrefabAssembly, type ProductRefs,
} from '../src/assets/modelImport';
import { BlendMode, CullMode, MESH_MAX_BONES, MeshChannel } from 'esengine';
import { plainTriangle, meshoptTriangle, dracoTriangle } from './fixtures/gltfFixtures.mjs';

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
    const { meshes, warnings } = await importGltfMeshes(gltf(doc), 'model');
    const line = warnings.join('\n');
    expect(line).toContain('normal-map scale 0.4');
    expect(line).toContain('KHR_materials_clearcoat');
    // The channels that DO reach a shader are products, not warnings — metal and
    // roughness among them now that the lighting model has a view direction.
    expect(line).not.toContain('metallic-roughness');
    expect(line).not.toContain('emissive');
    expect(line).not.toContain('alpha cutoff');
    expect(materialProducts(meshes, 'model')[0]!.data.properties)
      .toMatchObject({ u_metallic: 1, u_roughness: 0.3 });
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

  it('reports deformation it cannot carry: morph targets, and joints nothing binds', async () => {
    const doc = {
      ...withInlineImage(),
      skins: [{}],
      nodes: [{ mesh: 0, skin: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    };
    const { warnings } = await importGltfMeshes(gltf(doc, [{
      attributes: { POSITION: 0, TEXCOORD_0: 1, JOINTS_0: 1 }, indices: 2, material: 0, mode: 4,
      targets: [{}, {}],
    }]), 'model');
    const line = warnings.join('\n');
    expect(line).toContain('2 morph target(s) not imported');
    expect(line).toContain('a skin naming joints');
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

describe('glTF material products', () => {
  const shaded = (extra: Record<string, unknown>): Record<string, unknown> => {
    const doc = withInlineImage();
    doc.materials = [{ name: 'Shaded', ...extra }];
    return doc;
  };
  const productsOf = async (doc: Record<string, unknown>, refs: ProductRefs = {}) => {
    const { meshes } = await importGltfMeshes(gltf(doc), 'model');
    return { meshes, products: materialProducts(meshes, 'model', refs) };
  };

  it('writes nothing for a material a Mesh2D already carries whole', async () => {
    // baseColor is the component's own texture x colour, so a material here
    // would be a second file saying what the first one says.
    const { products } = await productsOf(withInlineImage());
    expect(products).toEqual([]);
  });

  it('carries the channels a component has no room for', async () => {
    const { products } = await productsOf(shaded({
      emissiveFactor: [1, 0.5, 0], emissiveTexture: { index: 0 },
      occlusionTexture: { index: 0, strength: 0.25 },
      alphaMode: 'MASK', alphaCutoff: 0.4,
    }), { prefix: 'assets/models/' });
    expect(products).toHaveLength(1);
    expect(products[0]!.name).toBe('model_m0');
    expect(products[0]!.data.shader).toBe('builtin:model');
    // A material with no pbrMetallicRoughness block is glTF's default: fully
    // metallic, fully rough. Written out, since the engine's own default is not.
    expect(products[0]!.data.properties).toEqual({
      u_emissive: { r: 1, g: 0.5, b: 0, a: 1 },
      u_emissiveMap: 'model_0.png',
      u_occlusionMap: 'model_0.png',
      u_occlusionStrength: 0.25,
      u_alphaCutoff: 0.4,
      u_metallic: 1,
      u_roughness: 1,
    });
  });

  it('takes the normal map WITH it, off the component', async () => {
    // A material shader samples its own units; a map left on the component
    // would be one nothing reads.
    const { meshes, products } = await productsOf(
      shaded({ normalTexture: { index: 0 }, emissiveFactor: [1, 1, 1] }),
      { prefix: 'assets/models/' });
    expect(products[0]!.data.properties.u_normalMap).toBe('model_0.png');
    const prefab = assembleModelPrefab('model', meshes, { refs: { prefix: 'assets/models/' } });
    const mesh2d = prefab.entities[1]!.components[1]!.data;
    expect(mesh2d.material).toBe('assets/models/model_m0.esmaterial');
    expect(mesh2d.normalMap).toBeUndefined();
  });

  it('says the render state the draw would otherwise have said itself', async () => {
    // A material REPLACES the draw's blend/depth/cull, so a model told to
    // occlude itself must keep saying so through the material.
    const opaque = await productsOf(shaded({ emissiveFactor: [1, 1, 1] }));
    expect(opaque.products[0]!.data).toMatchObject({
      blendMode: BlendMode.None, depthTest: true, depthWrite: true, cull: CullMode.Back,
    });
    const blended = await productsOf(shaded({
      emissiveFactor: [1, 1, 1], alphaMode: 'BLEND', doubleSided: true,
    }));
    expect(blended.products[0]!.data).toMatchObject({
      blendMode: BlendMode.Normal, depthTest: false, depthWrite: false, cull: CullMode.None,
    });
  });

  it('writes one product for a material several primitives share', async () => {
    const doc = shaded({ emissiveFactor: [0, 0, 1] });
    const { meshes } = await importGltfMeshes(gltf(doc, [
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 },
      { attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4 },
    ]), 'model');
    const refs = { prefix: 'assets/models/' };
    expect(materialProducts(meshes, 'model', refs)).toHaveLength(1);
    const prefab = assembleModelPrefab('model', meshes, { refs });
    const refsUsed = prefab.entities.flatMap(e => e.components
      .filter(c => c.type === 'Mesh2D').map(c => c.data.material));
    expect(refsUsed).toEqual(['assets/models/model_m0.esmaterial',
                              'assets/models/model_m0.esmaterial']);
  });

  it('spells an image already in the project as a logical path', async () => {
    // A material resolves a relative ref against its own directory, and this one
    // is not beside it.
    const doc = shaded({ emissiveTexture: { index: 0 } });
    doc.images = [{ uri: 'shared/glow.png' }];
    const inAssets = await productsOf(doc, {
      prefix: 'assets/models/', external: (uri) => `assets/${uri}`,
    });
    expect(inAssets.products[0]!.data.properties.u_emissiveMap).toBe('assets/shared/glow.png');
    const elsewhere = await productsOf(doc, {
      prefix: 'models/', external: (uri) => `art/${uri}`,
    });
    expect(elsewhere.products[0]!.data.properties.u_emissiveMap).toBe('/art/shared/glow.png');
  });
});

describe('glTF prefab assembly', () => {
  const assemble = async (bytes: Uint8Array, options: Partial<PrefabAssembly> = {}) => {
    const { meshes, nodes } = await importGltfMeshes(bytes, 'model');
    return assembleModelPrefab('model', meshes, { nodes, ...options });
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

  it('points the root at a clip, stopped', async () => {
    const prefab = await assemble(gltf({ ...withInlineImage(), ...oneNode }),
                                  { timeline: 'assets/models/model_Spin.estimeline' });
    // Stopped: the products say what the model HAS. Playing it is the scene's.
    expect(prefab.entities[0]!.components.at(-1)).toEqual({
      type: 'TimelinePlayer',
      data: { timeline: 'assets/models/model_Spin.estimeline', playing: false },
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

/**
 * A glTF whose animation sampler data is appended to the geometry buffer.
 * Accessors 0-2 are the triangle; 3 is the sampler input, 4 its output.
 */
function animatedGltf(opts: {
  times: number[]; values: number[]; components: number;
  path?: string; interpolation?: string;
  nodes?: unknown[]; targetNode?: number; skins?: unknown[];
}): Uint8Array {
  const geo = geometryBuffer();
  const geoBytes = Buffer.from(geo.uri.split(',')[1]!, 'base64');
  const pad = Buffer.alloc((4 - (geoBytes.length % 4)) % 4);
  const times = Buffer.from(new Float32Array(opts.times).buffer);
  const values = Buffer.from(new Float32Array(opts.values).buffer);
  const bytes = Buffer.concat([geoBytes, pad, times, values]);
  const timesAt = geoBytes.length + pad.length;
  const type = ['SCALAR', '', 'VEC2', 'VEC3', 'VEC4'][opts.components]!;

  const doc = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      ...(geo.views as Record<string, unknown>[]),
      { buffer: 0, byteOffset: timesAt, byteLength: times.length },
      { buffer: 0, byteOffset: timesAt + times.length, byteLength: values.length },
    ],
    accessors: [
      ...(geo.accessors as Record<string, unknown>[]),
      { bufferView: 3, componentType: 5126, count: opts.times.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: opts.values.length / opts.components, type },
    ],
    meshes: [{ name: 'Tri', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4 }] }],
    nodes: opts.nodes ?? [{ name: 'Root', children: [1] }, { name: 'Spinner', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...(opts.skins ? { skins: opts.skins } : {}),
    animations: [{
      name: 'Spin',
      channels: [{ sampler: 0, target: { node: opts.targetNode ?? 1, path: opts.path ?? 'rotation' } }],
      samplers: [{ input: 3, output: 4, interpolation: opts.interpolation ?? 'LINEAR' }],
    }],
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

describe('glTF animation import', () => {
  const HALF = Math.SQRT1_2;

  it('turns a rotation channel into four component channels on the target node', async () => {
    const result = await importGltfMeshes(animatedGltf({
      times: [0, 1], values: [0, 0, 0, 1, 0, HALF, 0, HALF], components: 4,
    }), 'robot');

    expect(result.animations).toHaveLength(1);
    const doc = result.animations[0]!.document as any;
    expect(result.animations[0]!.name).toBe('robot_Spin');
    expect(doc.duration).toBe(1);
    expect(doc.tracks).toHaveLength(1);
    // The lone root IS the prefab root, so its child is addressed by its name.
    expect(doc.tracks[0].childPath).toBe('Spinner');
    expect(doc.tracks[0].component).toBe('Transform');
    expect(doc.tracks[0].channels.map((c: any) => c.property))
      .toEqual(['rotation.x', 'rotation.y', 'rotation.z', 'rotation.w']);
    const y = doc.tracks[0].channels[1].keyframes;
    expect(y[0]).toMatchObject({ time: 0, value: 0, interpolation: 'linear' });
    expect(y[1].value).toBeCloseTo(HALF, 6);
  });

  it('carries a CUBICSPLINE tangent into the keyframe it belongs to', async () => {
    // Per key: [inTangent, value, outTangent] — one scalar-per-component triple.
    const result = await importGltfMeshes(animatedGltf({
      times: [0, 1], components: 3, path: 'translation', interpolation: 'CUBICSPLINE',
      values: [
        0, 0, 0, /* v0 */ 0, 0, 0, /* out */ 2, 0, 0,
        3, 0, 0, /* v1 */ 10, 0, 0, /* out */ 0, 0, 0,
      ],
    }), 'robot');

    const x = (result.animations[0]!.document as any).tracks[0].channels[0].keyframes;
    expect(x[0]).toMatchObject({ value: 0, inTangent: 0, outTangent: 2, interpolation: 'hermite' });
    expect(x[1]).toMatchObject({ value: 10, inTangent: 3, outTangent: 0 });
  });

  it('flips a quaternion keyframe that would interpolate the long way round', async () => {
    // 170° about Y, then the SAME rotation written negated: component-wise that
    // is a 190° turn backwards unless the sign is aligned.
    const s = Math.sin((170 * Math.PI) / 180 / 2);
    const c = Math.cos((170 * Math.PI) / 180 / 2);
    const result = await importGltfMeshes(animatedGltf({
      times: [0, 1], components: 4, values: [0, s, 0, c, -0, -s, -0, -c],
    }), 'robot');

    const ch = (result.animations[0]!.document as any).tracks[0].channels;
    const yEnd = ch[1].keyframes[1].value;
    const wEnd = ch[3].keyframes[1].value;
    expect(yEnd).toBeCloseTo(s, 6);
    expect(wEnd).toBeCloseTo(c, 6);
  });

  it('gives two siblings of the same name distinct paths', async () => {
    const result = await importGltfMeshes(animatedGltf({
      times: [0], components: 3, path: 'translation', values: [1, 2, 3], targetNode: 2,
      nodes: [
        { name: 'Root', children: [1, 2] },
        { name: 'Arm', mesh: 0 },
        { name: 'Arm' },
      ],
    }), 'robot');

    const paths = result.nodes[0]!.children.map(n => n.name);
    expect(paths).toEqual(['Arm', 'Arm_2']);
    expect((result.animations[0]!.document as any).tracks[0].childPath).toBe('Arm_2');
  });

  it('says a channel aimed at a skinned mesh node moves nothing', async () => {
    const result = await importGltfMeshes(animatedGltf({
      times: [0, 1], components: 4, values: [0, 0, 0, 1, 0, HALF, 0, HALF],
      skins: [{ joints: [1] }],
      nodes: [{ name: 'Root', children: [1] }, { name: 'Spinner', mesh: 0, skin: 0 }],
    }), 'robot');

    expect(result.animations).toHaveLength(1);
    expect(result.warnings.some(w => /moves nothing/.test(w))).toBe(true);
  });

  it('reports a morph-weight channel rather than dropping it', async () => {
    const result = await importGltfMeshes(animatedGltf({
      times: [0, 1], components: 1, path: 'weights', values: [0, 1],
    }), 'robot');

    expect(result.animations).toHaveLength(0);
    expect(result.warnings.some(w => /weights/.test(w))).toBe(true);
  });
});

/**
 * The triangle bound to two joints. Accessors 3/4 are JOINTS_0 (u16) and
 * WEIGHTS_0; 5 is the skin's inverse bind matrices unless the caller drops it.
 */
function skinnedGltf(opts: {
  noBindMatrices?: boolean; skinOnNode?: boolean; weights?: boolean; extraJoints?: number;
} = {}): Uint8Array {
  const geo = geometryBuffer();
  const geoBytes = Buffer.from(geo.uri.split(',')[1]!, 'base64');
  const pad = Buffer.alloc((4 - (geoBytes.length % 4)) % 4);
  const joints = Buffer.from(new Uint16Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]).buffer);
  const weights = Buffer.from(new Float32Array([
    0.75, 0.25, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0,
  ]).buffer);
  // Joint 1's bind pose sits 30 along x; joint 0's is identity.
  const bind = new Float32Array(32);
  for (let j = 0; j < 2; j++) for (let c = 0; c < 4; c++) bind[j * 16 + c * 5] = 1;
  bind[16 + 12] = 30;
  const parts = [geoBytes, pad, joints, weights, Buffer.from(bind.buffer)];
  const bytes = Buffer.concat(parts);
  let at = geoBytes.length + pad.length;
  const views: Record<string, unknown>[] = [];
  for (const p of [joints, weights, Buffer.from(bind.buffer)]) {
    views.push({ buffer: 0, byteOffset: at, byteLength: p.length });
    at += p.length;
  }

  const extra = Array.from({ length: opts.extraJoints ?? 0 });
  const doc: Record<string, unknown> = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [...(geo.views as Record<string, unknown>[]), ...views],
    accessors: [
      ...(geo.accessors as Record<string, unknown>[]),
      { bufferView: 3, componentType: 5123, count: 3, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'MAT4' },
    ],
    meshes: [{
      name: 'Tri',
      primitives: [{
        attributes: {
          POSITION: 0, TEXCOORD_0: 1, JOINTS_0: 3,
          ...(opts.weights === false ? {} : { WEIGHTS_0: 4 }),
        },
        indices: 2, mode: 4,
      }],
    }],
    nodes: [
      { name: 'Rig', children: [1, 2, 3, ...extra.map((_, i) => 4 + i)] },
      { name: 'Hip' },
      { name: 'Knee', translation: [30, 0, 0] },
      { name: 'Body', mesh: 0, ...(opts.skinOnNode === false ? {} : { skin: 0 }) },
      ...extra.map((_, i) => ({ name: `Spare${i}` })),
    ],
    scenes: [{ nodes: [0] }],
    scene: 0,
    skins: [{
      joints: [1, 2, ...extra.map((_, i) => 4 + i)],
      // A longer joint list than the accessor has matrices for is its own
      // (already covered) warning, so drop the accessor when the list grows.
      ...(opts.noBindMatrices || extra.length > 0 ? {} : { inverseBindMatrices: 5 }),
    }],
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

describe('glTF skinning import', () => {
  it('carries the joint channel, the weights and the bind pose', async () => {
    const { meshes, warnings } = await importGltfMeshes(skinnedGltf(), 'rig');
    const mesh = meshes[0]!;

    const joints = mesh.data.channels.find((c) => c.semantic === MeshChannel.Joints);
    const weights = mesh.data.channels.find((c) => c.semantic === MeshChannel.Weights);
    expect(joints).toMatchObject({ components: 4, type: 2 /* UInt16 */ });
    expect(weights).toMatchObject({ components: 4, type: 0 /* Float32 */ });

    const dv = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
    expect(dv.getUint16(joints!.offset + 2, true)).toBe(1);
    expect(dv.getFloat32(weights!.offset, true)).toBeCloseTo(0.75, 6);

    // The bind pose comes from the SKIN, and the joints are its node list.
    expect(mesh.data.inverseBindMatrices).toHaveLength(32);
    expect(mesh.data.inverseBindMatrices![16 + 12]).toBe(30);
    expect(mesh.skinJoints).toEqual([1, 2]);
    expect(warnings.filter((w) => /skin/i.test(w))).toEqual([]);
  });

  it('treats a missing bind accessor as an identity bind pose', async () => {
    const { meshes } = await importGltfMeshes(skinnedGltf({ noBindMatrices: true }), 'rig');
    const bind = meshes[0]!.data.inverseBindMatrices!;
    expect(bind[0]).toBe(1);
    expect(bind[16 + 12]).toBe(0);
  });

  it('imports static, and says so, when nothing binds the joints', async () => {
    for (const opts of [{ skinOnNode: false }, { weights: false }]) {
      const { meshes, warnings } = await importGltfMeshes(skinnedGltf(opts), 'rig');
      expect(meshes[0]!.data.channels.some((c) => c.semantic === MeshChannel.Joints)).toBe(false);
      expect(meshes[0]!.skinJoints).toBeUndefined();
      expect(warnings.some((w) => /JOINTS_0 without/.test(w))).toBe(true);
    }
  });

  it('imports static, and says the budget, when a skin binds more joints than a draw can pose', async () => {
    // The joint indices in the vertices index the SKIN's list, so a list longer
    // than the pose block means indices no uploaded matrix answers to. Drawn
    // wrong, the vertices go somewhere arbitrary; this is the file saying so.
    const over = MESH_MAX_BONES + 1;
    const { meshes, warnings } = await importGltfMeshes(
      skinnedGltf({ extraJoints: over - 2 }), 'rig');
    expect(meshes[0]!.data.channels.some((c) => c.semantic === MeshChannel.Joints)).toBe(false);
    expect(meshes[0]!.data.inverseBindMatrices).toBeUndefined();
    expect(meshes[0]!.skinJoints).toBeUndefined();
    expect(warnings.some((w) => w.includes(`binds ${over} joints`)
      && w.includes(`${MESH_MAX_BONES}`) && /imported static/.test(w))).toBe(true);
  });

  it('poses a skin that fills the budget exactly', async () => {
    // The boundary itself, so the check cannot be an off-by-one that quietly
    // costs a rig its last bone.
    const { meshes, warnings } = await importGltfMeshes(
      skinnedGltf({ extraJoints: MESH_MAX_BONES - 2 }), 'rig');
    expect(meshes[0]!.skinJoints).toHaveLength(MESH_MAX_BONES);
    expect(warnings.some((w) => /imported static/.test(w))).toBe(false);
  });

  it('names the joint entities the prefab gives those nodes', async () => {
    const { meshes, nodes } = await importGltfMeshes(skinnedGltf(), 'rig');
    const prefab = assembleModelPrefab('rig', meshes, { nodes });
    const body = prefab.entities.find((e) => e.name === 'Body')!;
    const skin = body.components.find((c) => c.type === 'MeshSkin');
    expect(skin?.data).toEqual({ joints: ['n1', 'n2'] });
    // Those ids are entities the same prefab carries — a joint list pointing
    // outside it would resolve to nothing at instantiation.
    const ids = prefab.entities.map((e) => e.prefabEntityId);
    expect(ids).toEqual(expect.arrayContaining(['n1', 'n2']));
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
