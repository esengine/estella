// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One triangle written two ways: plain, and meshopt-compressed.
 *
 * The compressed half is produced by the upstream encoder, so what it exercises
 * is this project's wiring — extension parsing, the fallback buffer, the decoded
 * bytes reaching an accessor — rather than a second reading of the codec. Shared
 * because the same pair is the claim in two places: a unit test on the importer,
 * and a check that the real editor's import door decodes it too.
 */
import { MeshoptEncoder } from 'meshoptimizer/encoder';

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const UVS = new Float32Array([0, 0, 1, 0, 0, 1]);
const INDICES = new Uint16Array([0, 1, 2]);

const ACCESSORS = [
  { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
  { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
  { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
];
const MESHES = [{
  name: 'Tri',
  primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4 }],
}];

const raw = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const encode = (doc) => new TextEncoder().encode(JSON.stringify(doc));

/** The triangle with its bytes as they are — what any exporter writes by default. */
export function plainTriangle() {
  const bytes = Buffer.concat([Buffer.from(raw(POSITIONS)), Buffer.from(raw(UVS)), Buffer.from(raw(INDICES))]);
  return encode({
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: ACCESSORS,
    meshes: MESHES,
  });
}

/** The same triangle as gltfpack writes it: every bufferView meshopt-compressed. */
export async function meshoptTriangle() {
  await MeshoptEncoder.ready;
  const parts = [
    { packed: MeshoptEncoder.encodeVertexBuffer(raw(POSITIONS), 3, 12), stride: 12, count: 3, mode: 'ATTRIBUTES', length: 36 },
    { packed: MeshoptEncoder.encodeVertexBuffer(raw(UVS), 3, 8), stride: 8, count: 3, mode: 'ATTRIBUTES', length: 24 },
    { packed: MeshoptEncoder.encodeIndexBuffer(raw(INDICES), 3, 2), stride: 2, count: 3, mode: 'TRIANGLES', length: 6 },
  ];
  const compressed = Buffer.concat(parts.map((p) => Buffer.from(p.packed)));
  let packedAt = 0;
  let plainAt = 0;
  const bufferViews = parts.map((p) => {
    // A compressed view names the FALLBACK buffer and the size it decodes to;
    // the bytes themselves are in the extension, in the compressed buffer.
    const view = {
      buffer: 1, byteOffset: plainAt, byteLength: p.length, byteStride: p.stride,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0, byteOffset: packedAt, byteLength: p.packed.length,
          byteStride: p.stride, count: p.count, mode: p.mode,
        },
      },
    };
    packedAt += p.packed.length;
    plainAt += p.length;
    return view;
  });
  return encode({
    asset: { version: '2.0' },
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [
      { byteLength: compressed.length, uri: `data:application/octet-stream;base64,${compressed.toString('base64')}` },
      { byteLength: 66, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews,
    accessors: ACCESSORS,
    meshes: MESHES,
  });
}

/**
 * The same triangle Draco-compressed — what Blender writes when its glTF export
 * has compression on, and the only compression Blender offers.
 *
 * Draco reorders vertices to compress them, so a product built from this is
 * geometrically the same triangle rather than the same bytes.
 */
export async function dracoTriangle() {
  const { createEncoderModule } = await import('draco3dgltf');
  const draco = await createEncoderModule();
  const mesh = new draco.Mesh();
  const builder = new draco.MeshBuilder();
  builder.AddFacesToMesh(mesh, 1, new Uint32Array(INDICES));
  const position = builder.AddFloatAttributeToMesh(mesh, draco.POSITION, 3, 3, POSITIONS);
  const texCoord = builder.AddFloatAttributeToMesh(mesh, draco.TEX_COORD, 3, 2, UVS);

  const encoder = new draco.Encoder();
  const encoded = new draco.DracoInt8Array();
  const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
  const blob = new Uint8Array(length);
  for (let i = 0; i < length; i++) blob[i] = encoded.GetValue(i) & 0xff;
  for (const handle of [encoded, encoder, mesh, builder]) draco.destroy(handle);

  return encode({
    asset: { version: '2.0' },
    extensionsRequired: ['KHR_draco_mesh_compression'],
    buffers: [{ byteLength: blob.length, uri: `data:application/octet-stream;base64,${Buffer.from(blob).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: blob.length }],
    // The accessors keep saying what the data MEANS — count and type — while
    // Draco holds the data itself. That is the shape the spec asks for.
    accessors: ACCESSORS.map(a => ({ ...a, bufferView: undefined })),
    meshes: [{
      name: 'Tri',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4,
        extensions: {
          KHR_draco_mesh_compression: {
            bufferView: 0, attributes: { POSITION: position, TEXCOORD_0: texCoord },
          },
        },
      }],
    }],
  });
}
