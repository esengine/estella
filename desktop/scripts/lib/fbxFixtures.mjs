// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FBX sources written by hand, in the format's own ASCII dialect.
 *
 * An FBX fixture is normally a binary blob nobody can read or edit, which makes
 * a failing test a mystery. These are text: the vertices, the bind matrices and
 * the keyframes a test asserts on are visible in the file that produced them.
 * ufbx reads ASCII and binary through the same parser, so what they exercise is
 * this project's reading of a scene, not one particular container.
 *
 * Shared because the same models are the claim in two places: a unit test on the
 * importer, and a check that the real editor's import door reads them too.
 */

/** FBX stores time in ticks; this many are one second. */
const TICKS_PER_SECOND = 46186158000;

/** Keyframe interpolation flags (ufbxi_key_flags): linear, no tangents. */
const KEY_LINEAR = 4;

const header = (creator) => `; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "${creator}"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",100
\t}
}
`;

/** An FBX array literal: `*<count> { a: ... }`, indented to sit inside a node. */
function array(name, values, indent) {
  const pad = '\t'.repeat(indent);
  return `${pad}${name}: *${values.length} {\n${pad}\ta: ${values.join(',')}\n${pad}}\n`;
}

/**
 * A polygon's vertex indices as FBX spells them: the last index of each face is
 * bit-flipped, which is how a reader finds the face boundary in a flat array.
 */
function polygons(faces) {
  return faces.flatMap((face) => face.map((ix, i) => (i === face.length - 1 ? ~ix : ix)));
}

/**
 * A mesh geometry with normals and UVs, both per polygon-vertex — the mapping
 * an exporter uses when a vertex can carry different values per face.
 */
function geometry(id, name, { vertices, faces, normals, uvs, materials }) {
  const corners = faces.flat().length;
  return `\tGeometry: ${id}, "Geometry::${name}", "Mesh" {
${array('Vertices', vertices, 2)}${array('PolygonVertexIndex', polygons(faces), 2)}\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 102
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
${array('Normals', normals, 3)}\t\t}
\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVMap"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
${array('UV', uvs, 3)}${array('UVIndex', Array.from({ length: corners }, (_, i) => i), 3)}\t\t}
${materials === undefined ? '' : `\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygon"
\t\t\tReferenceInformationType: "IndexToDirect"
${array('Materials', materials, 3)}\t\t}
`}\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementNormal"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementUV"
\t\t\t\tTypedIndex: 0
\t\t\t}
${materials === undefined ? '' : `\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
`}\t\t}
\t}
`;
}

/** A scene node. `kind` is "Mesh", "LimbNode" or "Null" — what FBX calls it. */
function model(id, name, kind, { translation, rotation, scale } = {}) {
  const props = [
    translation && `\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${translation.join(',')}`,
    rotation && `\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",${rotation.join(',')}`,
    scale && `\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",${scale.join(',')}`,
  ].filter(Boolean);
  return `\tModel: ${id}, "Model::${name}", "${kind}" {
\t\tVersion: 232
\t\tProperties70:  {
${props.join('\n')}${props.length ? '\n' : ''}\t\t}
\t}
`;
}

/**
 * A Phong material — what the overwhelming majority of FBX files carry, and the
 * shading model ufbx derives roughness from (out of the specular exponent).
 */
function material(id, name, { diffuse = [0.8, 0.8, 0.8], emissive, shininess = 20, opacity = 1 } = {}) {
  return `\tMaterial: ${id}, "Material::${name}", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",${diffuse.join(',')}
\t\t\tP: "ShininessExponent", "double", "Number", "",${shininess}
\t\t\tP: "Opacity", "double", "Number", "",${opacity}
${emissive ? `\t\t\tP: "EmissiveColor", "Color", "", "A",${emissive.join(',')}
\t\t\tP: "EmissiveFactor", "double", "Number", "",1
` : ''}\t\t}
\t}
`;
}

/** A file texture. `relative` is the path as the FBX stores it. */
function texture(id, name, relative) {
  return `\tTexture: ${id}, "Texture::${name}", "" {
\t\tType: "TextureVideoClip"
\t\tVersion: 202
\t\tTextureName: "Texture::${name}"
\t\tFileName: "C:/art/${relative}"
\t\tRelativeFilename: "${relative.split('/').join('\\')}"
\t\tModelUVTranslation: 0,0
\t\tModelUVScaling: 1,1
\t\tTexture_Alpha_Source: "None"
\t\tCropping: 0,0,0,0
\t}
`;
}

/**
 * One animation curve. The flag/attribute arrays are run-length encoded against
 * `KeyAttrRefCount`, so one entry covering every key is a whole curve of linear
 * keyframes.
 */
function animCurve(id, times, values) {
  return `\tAnimationCurve: ${id}, "AnimCurve::", "" {
\t\tDefault: ${values[0] ?? 0}
\t\tKeyVer: 4009
${array('KeyTime', times.map((t) => Math.round(t * TICKS_PER_SECOND)), 2)}${array('KeyValueFloat', values, 2)}${array('KeyAttrFlags', [KEY_LINEAR], 2)}${array('KeyAttrDataFloat', [0, 0, 0, 0], 2)}${array('KeyAttrRefCount', [times.length], 2)}\t}
`;
}

const connect = (child, parent) => `\tC: "OO",${child},${parent}\n`;
const connectProp = (child, parent, property) => `\tC: "OP",${child},${parent}, "${property}"\n`;

const encode = (text) => new TextEncoder().encode(text);

/**
 * A right triangle at the origin, drawn with a red Phong material that samples
 * an image beside the FBX. The node carrying it is moved to (1,2,3), so a test
 * can tell geometry from placement; the uvs are the unit corners in FBX's own
 * convention, where (0,0) is the image's BOTTOM left.
 */
export function texturedTriangle() {
  const objects = [
    geometry(1000, 'tri', {
      vertices: [0, 0, 0, 2, 0, 0, 0, 2, 0],
      faces: [[0, 1, 2]],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      materials: [0],
    }),
    model(2000, 'Tri', 'Mesh', { translation: [1, 2, 3] }),
    material(3000, 'Red', { diffuse: [1, 0, 0], emissive: [0, 0.5, 0] }),
    texture(4000, 'Brick', 'textures/brick.png'),
  ].join('');
  const connections = [
    connect(2000, 0),
    connect(1000, 2000),
    connect(3000, 2000),
    connectProp(4000, 3000, 'DiffuseColor'),
  ].join('');
  return encode(`${header('estella fbxFixtures')}Objects:  {\n${objects}}\nConnections:  {\n${connections}}\n`);
}

/**
 * Two bones and a quad bound to them, the upper bone turning a quarter circle
 * about Z over one second. The bind pose is deliberately plain — mesh and lower
 * bone at the origin, upper bone one unit up — so the inverse bind matrix a test
 * reads back is a translation it can check by eye.
 */
export function skinnedBar() {
  const objects = [
    geometry(1000, 'bar', {
      vertices: [-1, 0, 0, 1, 0, 0, 1, 2, 0, -1, 2, 0],
      faces: [[0, 1, 2, 3]],
      normals: Array.from({ length: 4 }, () => [0, 0, 1]).flat(),
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    }),
    model(2000, 'Bar', 'Mesh'),
    model(2100, 'Bone1', 'LimbNode'),
    model(2200, 'Bone2', 'LimbNode', { translation: [0, 1, 0] }),
    `\tDeformer: 5000, "Deformer::Skin", "Skin" {
\t\tVersion: 101
\t\tLink_DeformAcuracy: 50
\t}
`,
    // Transform is the mesh-node-to-bone matrix — the bind pose, already
    // inverted — and TransformLink is where the bone stood when it was bound.
    cluster(5100, 'Bone1', [0, 1], [1, 1], IDENTITY, IDENTITY),
    cluster(5200, 'Bone2', [2, 3], [1, 1], translation(0, -1, 0), translation(0, 1, 0)),
    // Both ends of the range: a reader takes the pair or neither.
    `\tAnimationStack: 6000, "AnimStack::Take 001", "" {
\t\tProperties70:  {
\t\t\tP: "LocalStart", "KTime", "Time", "",0
\t\t\tP: "LocalStop", "KTime", "Time", "",${TICKS_PER_SECOND}
\t\t\tP: "ReferenceStart", "KTime", "Time", "",0
\t\t\tP: "ReferenceStop", "KTime", "Time", "",${TICKS_PER_SECOND}
\t\t}
\t}
`,
    `\tAnimationLayer: 6100, "AnimLayer::BaseLayer", "" {
\t}
`,
    `\tAnimationCurveNode: 6200, "AnimCurveNode::R", "" {
\t\tProperties70:  {
\t\t\tP: "d", "Compound", "", ""
\t\t\tP: "d|X", "Number", "", "A",0
\t\t\tP: "d|Y", "Number", "", "A",0
\t\t\tP: "d|Z", "Number", "", "A",0
\t\t}
\t}
`,
    animCurve(6300, [0, 1], [0, 90]),
  ].join('');
  const connections = [
    connect(2000, 0),
    connect(2100, 0),
    connect(2200, 2100),
    connect(1000, 2000),
    connect(5000, 1000),
    connect(5100, 5000),
    connect(5200, 5000),
    connect(2100, 5100),
    connect(2200, 5200),
    connect(6100, 6000),
    connect(6200, 6100),
    connectProp(6200, 2200, 'Lcl Rotation'),
    connectProp(6300, 6200, 'd|Z'),
  ].join('');
  return encode(`${header('estella fbxFixtures')}Objects:  {\n${objects}}\nConnections:  {\n${connections}}\n`);
}

/** A 4x4 matrix as FBX writes one: sixteen numbers, translation in the last row. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

function cluster(id, bone, indexes, weights, transform, transformLink) {
  return `\tDeformer: ${id}, "SubDeformer::Cluster ${bone}", "Cluster" {
\t\tVersion: 100
\t\tUserData: "", ""
${array('Indexes', indexes, 2)}${array('Weights', weights, 2)}${array('Transform', transform, 2)}${array('TransformLink', transformLink, 2)}\t}
`;
}
