// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    build-town.mjs
 * @brief   Writes the town this example streams: its meshes, textures, materials, prefabs and scene.
 *
 * @details Generated rather than modelled so the example stays small in the repository and every piece of it has a reason a far
 *          proxy has to answer for: prefab houses with nested chimneys and see-through windows, trees whose rounded crowns are
 *          what simplification has to keep, a clock tower built as a rotated and scaled hierarchy, carts on dynamic bodies, a
 *          ferry on a kinematic one, windmill sails a script turns, disabled scaffolding, and cells with nothing static at all.
 *          Seeded, so running it again writes the same files.
 *
 *          node examples/far-proxy-town/scripts/build-town.mjs   (from the repository root, after `pnpm --filter ./sdk build`)
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..');
const root = path.resolve(project, '../..');
const { builtinMeshTemplate, mergeMeshes, encodeMesh, composeTRS } =
    await import(pathToFileURL(path.join(root, 'sdk/dist/index.node.js')).href);
const { PNG } = createRequire(path.join(root, 'pipeline/package.json'))('pngjs');

/** The town's grid: GRID by GRID cells of CELL world units, the cook's cell size. */
export const GRID = 12;
export const CELL = 80;

// ---------------------------------------------------------------------------------------------------------------------------
// Determinism

function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = random(20261118);
const pick = (list) => list[Math.floor(rng() * list.length)];
const between = (lo, hi) => lo + rng() * (hi - lo);

function uuidOf(name) {
    const h = createHash('sha1').update(`far-proxy-town:${name}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function write(relative, content, type, importer = {}) {
    const file = path.join(project, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    writeFileSync(`${file}.meta`, JSON.stringify({ uuid: uuidOf(relative), version: '2.0', type, importer }, null, 2) + '\n');
    return relative;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry: built-in shapes placed and merged. A built-in is 100 units, so a size in metres is that over 100.

const UNIT = 100;
const quatY = (deg) => { const r = (deg * Math.PI) / 360; return { x: 0, y: Math.sin(r), z: 0, w: Math.cos(r) }; };
const quatZ = (deg) => { const r = (deg * Math.PI) / 360; return { x: 0, y: 0, z: Math.sin(r), w: Math.cos(r) }; };
const quatX = (deg) => { const r = (deg * Math.PI) / 360; return { x: Math.sin(r), y: 0, z: 0, w: Math.cos(r) }; };

/** One built-in shape `size` metres across, its centre at `at`, turned by `q`. */
function part(shape, at, size, q = { x: 0, y: 0, z: 0, w: 1 }) {
    return {
        mesh: builtinMeshTemplate(`builtin:${shape}`).build(),
        world: composeTRS({ x: at[0], y: at[1], z: at[2] }, q, { x: size[0] / UNIT, y: size[1] / UNIT, z: size[2] / UNIT }),
    };
}

function mesh(name, parts) {
    return write(`assets/meshes/${name}.esmesh`, encodeMesh(mergeMeshes(parts)), 'mesh');
}

/** A gable roof over a w by d footprint, its eaves at height 0. */
function gable(w, d, pitch, overhang = 0.4) {
    const run = w / 2 + overhang;
    const slope = run / Math.cos((pitch * Math.PI) / 180);
    const rise = Math.tan((pitch * Math.PI) / 180) * (w / 2);
    return [
        part('cube', [-w / 4 - overhang / 2, rise / 2, 0], [slope, 0.25, d + overhang * 2], quatZ(pitch)),
        part('cube', [w / 4 + overhang / 2, rise / 2, 0], [slope, 0.25, d + overhang * 2], quatZ(-pitch)),
        part('cube', [0, rise, 0], [0.35, 0.35, d + overhang * 2]),
    ];
}

/** A crown of overlapping spheres, rounded enough that simplification has something to keep. */
function crown(seed, radius) {
    const r = random(seed);
    const parts = [part('sphere', [0, radius, 0], [radius * 2, radius * 1.8, radius * 2])];
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r();
        const s = radius * (0.8 + r() * 0.5);
        parts.push(part('sphere', [Math.cos(a) * radius * 0.7, radius * (0.8 + r() * 0.6), Math.sin(a) * radius * 0.7], [s, s * 0.9, s]));
    }
    return parts;
}

const meshes = {
    houseA: mesh('house-a-walls', [part('cube', [0, 2.5, 0], [8, 5, 6]), part('cube', [0, 0.2, 3.4], [2.4, 0.4, 0.9])]),
    houseARoof: mesh('house-a-roof', gable(8, 6, 32).map((p) => ({ ...p, world: shift(p.world, 0, 5, 0) }))),
    houseB: mesh('house-b-walls', [part('cube', [0, 3.5, 0], [10, 7, 7]), part('cube', [0, 3.6, 0], [10.3, 0.3, 7.3]),
        part('cube', [3.2, 1.2, 4.1], [2.6, 2.4, 1.2])]),
    houseBRoof: mesh('house-b-roof', gable(10, 7, 28).map((p) => ({ ...p, world: shift(p.world, 0, 7, 0) }))),
    houseC: mesh('house-c-walls', [part('cube', [0, 4.5, 0], [6, 9, 6]), part('cube', [0, 9.2, 0], [6.6, 0.4, 6.6])]),
    houseCRoof: mesh('house-c-roof', [part('cone', [0, 11.5, 0], [7, 4.6, 7])]),
    door: mesh('door', [part('cube', [0, 1.1, 0], [1.2, 2.2, 0.15]), part('cube', [0, 2.3, 0], [1.5, 0.2, 0.25])]),
    window: mesh('window', [part('cube', [0, 0, 0], [1.2, 1.4, 0.08])]),
    frame: mesh('window-frame', [part('cube', [0, 0.75, 0], [1.5, 0.12, 0.2]), part('cube', [0, -0.75, 0], [1.5, 0.12, 0.2]),
        part('cube', [0.66, 0, 0], [0.12, 1.5, 0.2]), part('cube', [-0.66, 0, 0], [0.12, 1.5, 0.2])]),
    chimney: mesh('chimney', [part('cube', [0, 1.2, 0], [0.9, 2.4, 0.9]), part('cube', [0, 2.5, 0], [1.1, 0.25, 1.1])]),
    trunk: mesh('tree-trunk', [part('cylinder', [0, 1.6, 0], [0.6, 3.2, 0.6]), part('cylinder', [0.4, 2.6, 0], [0.25, 1.4, 0.25], quatZ(-35))]),
    crownRound: mesh('tree-crown-round', crown(1, 2.4).map((p) => ({ ...p, world: shift(p.world, 0, 2.6, 0) }))),
    crownTall: mesh('tree-crown-tall', [part('cone', [0, 3.5, 0], [3.6, 5, 3.6]), part('cone', [0, 5.6, 0], [2.8, 4, 2.8]),
        part('cone', [0, 7.4, 0], [1.9, 3, 1.9])]),
    lampPole: mesh('lamp-pole', [part('cylinder', [0, 2, 0], [0.18, 4, 0.18]), part('cube', [0.35, 3.95, 0], [0.8, 0.1, 0.1]),
        part('cylinder', [0, 0.1, 0], [0.5, 0.2, 0.5])]),
    lampHead: mesh('lamp-head', [part('sphere', [0.7, 3.7, 0], [0.45, 0.45, 0.45])]),
    fence: mesh('fence', [0, 2, 4, 6, 8].map((x) => part('cube', [x - 4, 0.6, 0], [0.18, 1.2, 0.18]))
        .concat([part('cube', [0, 0.9, 0], [8.2, 0.12, 0.08]), part('cube', [0, 0.45, 0], [8.2, 0.12, 0.08])])),
    stall: mesh('stall-table', [part('cube', [0, 0.85, 0], [3, 0.12, 1.6]), ...[[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]
        .map(([x, z]) => part('cylinder', [x, 1.25, z], [0.12, 2.5, 0.12]))]),
    canopy: mesh('stall-canopy', [part('cube', [0, 2.55, 0], [3.4, 0.08, 2]), part('cube', [0, 2.25, 1], [3.4, 0.6, 0.06])]),
    towerShaft: mesh('tower-shaft', [part('cube', [0, 9, 0], [6, 18, 6]), part('cube', [0, 18.3, 0], [7, 0.6, 7]),
        ...[[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]].map(([x, z]) => part('cube', [x, 9, z], [1, 18.2, 1]))]),
    towerRoof: mesh('tower-roof', [part('cone', [0, 22, 0], [7.4, 7.2, 7.4]), part('cylinder', [0, 26.2, 0], [0.2, 1.6, 0.2])]),
    clock: mesh('clock-face', [part('cylinder', [0, 0, 0], [3.2, 0.25, 3.2], quatX(90))]),
    millBody: mesh('mill-body', [part('cylinder', [0, 5, 0], [5, 10, 5]), part('cone', [0, 11.5, 0], [6, 3.4, 6])]),
    sails: mesh('mill-sails', [0, 90].map((deg) => part('cube', [0, 0, 0], [0.5, 12, 0.12], quatZ(deg)))
        .concat([part('cube', [0, 3.5, -0.1], [1.8, 5, 0.05]), part('cube', [0, -3.5, -0.1], [1.8, 5, 0.05]),
            part('cube', [3.5, 0, -0.1], [5, 1.8, 0.05]), part('cube', [-3.5, 0, -0.1], [5, 1.8, 0.05])])),
    deck: mesh('bridge-deck', [part('cube', [0, 2.2, 0], [5, 0.5, 18]), part('cube', [2.4, 2.9, 0], [0.2, 1, 18]),
        part('cube', [-2.4, 2.9, 0], [0.2, 1, 18]), ...[-6, 0, 6].map((z) => part('cylinder', [0, 0.9, z], [1.4, 2.6, 1.4]))]),
    road: mesh('road', [part('cube', [0, 0.04, 0], [CELL, 0.08, 7])]),
    cart: mesh('cart', [part('cube', [0, 0.9, 0], [2.6, 0.9, 1.5]), ...[[-0.9, 0.8], [0.9, 0.8], [-0.9, -0.8], [0.9, -0.8]]
        .map(([x, z]) => part('cylinder', [x, 0.45, z], [0.9, 0.2, 0.9], quatX(90)))]),
    hull: mesh('ferry', [part('cube', [0, 0.6, 0], [4, 1.2, 9]), part('cube', [0, 1.8, -1.5], [3, 1.2, 3])]),
    scaffold: mesh('scaffold', [part('cube', [0, 4, 0], [0.2, 8, 0.2]), part('cube', [3, 4, 0], [0.2, 8, 0.2]),
        part('cube', [1.5, 4, 0], [3.2, 0.15, 1.2])]),
};

/** `m` moved by (x, y, z). */
function shift(m, x, y, z) {
    const out = Array.from(m);
    out[12] += x; out[13] += y; out[14] += z;
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Textures: small tiles drawn here, each a different surface.

function texture(name, draw) {
    const png = new PNG({ width: 64, height: 64 });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) png.data.set([...draw(x, y), 255], (y * 64 + x) * 4);
    return write(`assets/textures/${name}.png`, PNG.sync.write(png), 'texture',
        { maxSize: 64, mipmaps: true, filterMode: 'linear', wrapMode: 'repeat', sRGB: true });
}
const noise = (x, y, s) => { const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return n - Math.floor(n); };
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
const textures = {
    brick: texture('brick', (x, y) => {
        const row = Math.floor(y / 8), off = row % 2 ? 8 : 0;
        const mortar = y % 8 === 0 || (x + off) % 16 === 0;
        return mortar ? [196, 188, 172] : shade([168, 82, 58], 0.85 + noise(Math.floor((x + off) / 16), row, 1) * 0.3);
    }),
    plaster: texture('plaster', (x, y) => shade([232, 222, 198], 0.92 + noise(x, y, 2) * 0.12)),
    roof: texture('roof-tiles', (x, y) => {
        const edge = y % 10 < 2 || (x + (Math.floor(y / 10) % 2) * 5) % 10 === 0;
        return shade([150, 62, 44], edge ? 0.6 : 0.9 + noise(x >> 2, y >> 2, 3) * 0.2);
    }),
    slate: texture('slate', (x, y) => shade([86, 94, 108], y % 8 < 1 ? 0.7 : 0.9 + noise(x >> 3, y >> 3, 4) * 0.2)),
    wood: texture('wood', (x, y) => shade([132, 92, 58], 0.8 + Math.sin(x * 0.5 + Math.sin(y * 0.2) * 2) * 0.12 + noise(x, y, 5) * 0.08)),
    stone: texture('stone', (x, y) => shade([150, 146, 138], 0.78 + noise(x >> 2, y >> 2, 6) * 0.3)),
    cobble: texture('cobble', (x, y) => {
        const cx = (x % 12) - 6, cy = (y % 12) - 6;
        return shade([112, 108, 100], cx * cx + cy * cy > 30 ? 0.55 : 0.85 + noise(x >> 3, y >> 3, 7) * 0.25);
    }),
    grass: texture('grass', (x, y) => shade([86, 128, 62], 0.8 + noise(x, y, 8) * 0.35)),
    leaves: texture('leaves', (x, y) => shade([70, 118, 56], 0.7 + noise(x >> 1, y >> 1, 9) * 0.5)),
    water: texture('water', (x, y) => shade([52, 98, 128], 0.9 + Math.sin(x * 0.4 + y * 0.15) * 0.08)),
    cloth: texture('cloth', (x, y) => ((x >> 3) % 2 ? [236, 236, 228] : [214, 214, 206])),
};

// ---------------------------------------------------------------------------------------------------------------------------
// Materials: the built-in model shader with its own roughness and metalness, one per kind of surface.

function material(name, properties) {
    return write(`assets/materials/${name}.esmaterial`, JSON.stringify({
        version: '1.0', type: 'material', shader: 'builtin:model', blendMode: 0,
        depthTest: true, depthWrite: true, cull: 1, properties,
    }, null, 2) + '\n', 'material');
}
const materials = {
    masonry: material('masonry', { u_metallic: 0, u_roughness: 0.92 }),
    roof: material('roof', { u_metallic: 0, u_roughness: 0.7 }),
    wood: material('wood', { u_metallic: 0, u_roughness: 0.8 }),
    foliage: material('foliage', { u_metallic: 0, u_roughness: 0.95 }),
    ground: material('ground', { u_metallic: 0, u_roughness: 1 }),
    metal: material('metal', { u_metallic: 0.8, u_roughness: 0.35 }),
    lamp: material('lamp-glow', { u_metallic: 0, u_roughness: 0.4, u_emissive: { r: 2.2, g: 1.7, b: 0.9, a: 1 } }),
    glass: material('glass', { u_metallic: 0.1, u_roughness: 0.05 }),
    water: material('water', { u_metallic: 0.2, u_roughness: 0.15 }),
};

// ---------------------------------------------------------------------------------------------------------------------------
// Prefabs

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const renderer = (meshRef, tex, mat, color = WHITE, extra = {}) => ({ type: 'MeshRenderer', data: {
    mesh: meshRef, texture: tex ?? '', material: mat, color, lit: true, opaque: true, castShadows: true, cullBackfaces: true,
    enabled: true, ...extra } });
const tf = (p = [0, 0, 0], q, s) => ({ type: 'Transform', data: {
    position: { x: p[0], y: p[1], z: p[2] }, ...(q ? { rotation: q } : {}), ...(s ? { scale: { x: s[0], y: s[1], z: s[2] } } : {}) } });

function prefab(name, entities) {
    const byId = new Map(entities.map((e) => [e.prefabEntityId, e]));
    for (const e of entities) e.children = entities.filter((c) => c.parent === e.prefabEntityId).map((c) => c.prefabEntityId);
    void byId;
    return write(`assets/prefabs/${name}.esprefab`, JSON.stringify({ version: '2', name, rootEntityId: 'root', entities }, null, 2) + '\n',
        'prefab');
}
const node = (id, name, parent, components, extra = {}) => ({ prefabEntityId: id, name, parent, children: [], visible: true, components, ...extra });

const chimneyPrefab = prefab('chimney', [node('root', 'Chimney', null, [tf(), renderer(meshes.chimney, textures.brick, materials.masonry)])]);

/** A house: walls, a roof, a door, windows (see-through, so no proxy carries them) and, for some, a nested chimney. */
function housePrefab(name, walls, roof, wallTex, roofTex, w, d, floors, chimneyAt) {
    const parts = [
        node('root', name, null, [tf()]),
        node('walls', 'Walls', 'root', [tf(), renderer(walls, wallTex, materials.masonry)]),
        node('roof', 'Roof', 'root', [tf(), renderer(roof, roofTex, materials.roof)]),
        node('door', 'Door', 'root', [tf([0, 0, d / 2 + 0.05]), renderer(meshes.door, textures.wood, materials.wood)]),
    ];
    let i = 0;
    for (let f = 0; f < floors; f++) {
        for (const side of [-1, 1]) {
            for (const x of [-w / 3, w / 3]) {
                if (f === 0 && side === 1 && Math.abs(x) < 1.5) continue;
                const at = [x, 1.8 + f * 3, side * (d / 2 + 0.06)];
                parts.push(node(`frame${i}`, `Frame ${i}`, 'root', [tf(at), renderer(meshes.frame, textures.wood, materials.wood)]));
                parts.push(node(`glass${i}`, `Window ${i}`, 'root', [tf(at),
                    renderer(meshes.window, '', materials.glass, { r: 0.55, g: 0.7, b: 0.85, a: 0.45 }, { opaque: false, castShadows: false })]));
                i++;
            }
        }
    }
    if (chimneyAt) parts.push(node('chimney', 'Chimney', 'root', [tf(chimneyAt)], { nestedPrefab: { prefabPath: chimneyPrefab, overrides: [] } }));
    return prefab(name, parts);
}

const prefabs = {
    houseA: housePrefab('house-a', meshes.houseA, meshes.houseARoof, textures.plaster, textures.roof, 8, 6, 1, [2, 5.4, 1]),
    houseB: housePrefab('house-b', meshes.houseB, meshes.houseBRoof, textures.brick, textures.slate, 10, 7, 2, [-3, 7.5, -1.5]),
    houseC: housePrefab('house-c', meshes.houseC, meshes.houseCRoof, textures.stone, textures.slate, 6, 6, 3, null),
    treeRound: prefab('tree-round', [node('root', 'Tree', null, [tf()]),
        node('trunk', 'Trunk', 'root', [tf(), renderer(meshes.trunk, textures.wood, materials.wood)]),
        node('crown', 'Crown', 'root', [tf(), renderer(meshes.crownRound, textures.leaves, materials.foliage)])]),
    treeTall: prefab('tree-tall', [node('root', 'Pine', null, [tf()]),
        node('trunk', 'Trunk', 'root', [tf([0, 0, 0], undefined, [0.8, 0.9, 0.8]), renderer(meshes.trunk, textures.wood, materials.wood)]),
        node('crown', 'Crown', 'root', [tf(), renderer(meshes.crownTall, textures.leaves, materials.foliage, { r: 0.75, g: 0.9, b: 0.8, a: 1 })])]),
    lamp: prefab('lamp', [node('root', 'Lamp', null, [tf()]),
        node('pole', 'Pole', 'root', [tf(), renderer(meshes.lampPole, '', materials.metal, { r: 0.18, g: 0.2, b: 0.22, a: 1 })]),
        node('head', 'Head', 'root', [tf(), renderer(meshes.lampHead, '', materials.lamp, { r: 1, g: 0.9, b: 0.7, a: 1 }, { castShadows: false })])]),
    stall: prefab('stall', [node('root', 'Stall', null, [tf()]),
        node('table', 'Table', 'root', [tf(), renderer(meshes.stall, textures.wood, materials.wood)]),
        node('canopy', 'Canopy', 'root', [tf(), renderer(meshes.canopy, textures.cloth, materials.wood)])]),
};

// ---------------------------------------------------------------------------------------------------------------------------
// The scene

let nextId = 1;
const entities = [];
const comp = (type, data = {}) => ({ type, data });
function add(name, components, parent = null) {
    const id = nextId++;
    entities.push({ id, name, parent, children: [], visible: true, components });
    if (parent !== null) entities.find((e) => e.id === parent).children.push(id);
    return id;
}
/** A prefab instance placed at `at`, turned `deg` about y; `ref` by path or by uuid, both of which a scene can carry. */
function instance(name, prefabPath, at, deg = 0, scale = 1, extra = [], byUuid = false) {
    const id = nextId++;
    entities.push({ id, name, parent: null, prefab: byUuid ? `@uuid:${uuidOf(prefabPath)}` : prefabPath, overrides: [
        { type: 'property', prefabEntityId: 'root', componentType: 'Transform', propertyName: 'position', value: { x: at[0], y: at[1], z: at[2] } },
        { type: 'property', prefabEntityId: 'root', componentType: 'Transform', propertyName: 'rotation', value: quatY(deg) },
        ...(scale !== 1 ? [{ type: 'property', prefabEntityId: 'root', componentType: 'Transform', propertyName: 'scale',
            value: { x: scale, y: scale, z: scale } }] : []),
        ...extra,
    ], added: [], removed: [] });
    return id;
}
const tint = (entityId, color) => ({ type: 'property', prefabEntityId: entityId, componentType: 'MeshRenderer', propertyName: 'color', value: color });
const persistent = comp('WorldPersistent');

const CANAL = 6;               // the row of cells the canal runs through
const PLAZA = [5, 6, 3, 4];    // x0, x1, z0, z1: the square at the centre
const FOREST = (x, z) => x >= 9 && z <= 3;
const FIELDS = (x, z) => x <= 2 && z >= 9;

add('World', [comp('StreamedWorld', { cellSize: CELL, farProxies: true, farDistance: 1400, proxyError: 0.5 }), persistent]);
add('Sun', [tf([0, 0, 0], { x: -0.42, y: 0.28, z: 0.14, w: 0.85 }),
    comp('Light', { type: 1, intensity: 2.4, color: { r: 1, g: 0.95, b: 0.86, a: 1 }, meshShadows: true }), persistent]);
add('Sky light', [tf(), comp('Light', { type: 2, intensity: 0.55, color: { r: 0.62, g: 0.72, b: 0.9, a: 1 } }), persistent]);
add('Flyer', [tf([CELL * 1.5, 30, CELL * 1.5]),
    comp('WorldStreamingSource', { loadRadius: 90, unloadRadius: 150, prefetchRadius: 200, enabled: true }), persistent]);
add('Camera', [tf([CELL * 1.5, 30, CELL * 1.5]), comp('Camera', { isActive: true, projectionType: 0, fov: 60, nearPlane: 0.3, farPlane: 2400,
    backgroundColor: { r: 0.62, g: 0.76, b: 0.92, a: 1 } }), persistent]);
// A second source kept over the mill: the cells there stay resident whatever the flyer does, which is the union to keep.
add('Miller', [tf([CELL * 10.5, 2, CELL * 10.5]),
    comp('WorldStreamingSource', { loadRadius: 40, unloadRadius: 90, prefetchRadius: 60, enabled: true }), persistent]);

for (let cz = 0; cz < GRID; cz++) {
    for (let cx = 0; cx < GRID; cx++) {
        const x0 = cx * CELL, z0 = cz * CELL, mid = [x0 + CELL / 2, 0, z0 + CELL / 2];
        const canal = cz === CANAL;
        const plaza = cx >= PLAZA[0] && cx <= PLAZA[1] && cz >= PLAZA[2] && cz <= PLAZA[3];
        add(`Ground ${cx},${cz}`, [tf([mid[0], 0, mid[2]], undefined, [CELL / UNIT, 1, CELL / UNIT]),
            renderer('builtin:plane', canal ? textures.water : plaza ? textures.cobble : textures.grass,
                canal ? materials.water : materials.ground, WHITE, { castShadows: false })]);
        if (canal) {
            if (cx % 4 === 2) {
                const bridge = add(`Bridge ${cx}`, [tf([mid[0], 0, mid[2]], quatY(cx % 8 === 2 ? 0 : 8))]);
                add('Deck', [tf(), renderer(meshes.deck, textures.stone, materials.masonry)], bridge);
            }
            if (cx === 7) {
                // The ferry rides a kinematic body: it moves, so no proxy may carry it.
                add('Ferry', [tf([mid[0], 0.2, mid[2]], quatY(90)), renderer(meshes.hull, textures.wood, materials.wood),
                    comp('RigidBody3D', { bodyType: 1 }), comp('BoxCollider3D', { halfExtents: { x: 2, y: 0.6, z: 4.5 } })]);
            }
            continue;
        }
        // Roads along the cell's west and south edges, so the town is a grid of streets.
        add(`Road ${cx},${cz} S`, [tf([mid[0], 0, z0 + 3.5]), renderer(meshes.road, textures.cobble, materials.ground, WHITE, { castShadows: false })]);
        add(`Road ${cx},${cz} W`, [tf([x0 + 3.5, 0, mid[2]], quatY(90)),
            renderer(meshes.road, textures.cobble, materials.ground, WHITE, { castShadows: false })]);

        if (cx === 5 && cz === 3) {
            // The clock tower: a hierarchy turned and scaled at its root, so a proxy has to compose the whole chain.
            const tower = add('Clock tower', [tf([x0 + CELL, 0, z0 + CELL], quatY(30), [1.25, 1.25, 1.25])]);
            add('Shaft', [tf(), renderer(meshes.towerShaft, textures.stone, materials.masonry)], tower);
            add('Spire', [tf(), renderer(meshes.towerRoof, textures.slate, materials.roof)], tower);
            const face = add('Clock', [tf([0, 15, 3.05], undefined, [0.9, 0.9, 0.9])], tower);
            add('Dial', [tf(), renderer(meshes.clock, '', materials.metal, { r: 0.93, g: 0.9, b: 0.8, a: 1 })], face);
        }
        if (plaza) {
            for (let i = 0; i < 6; i++) {
                const colour = pick([{ r: 0.85, g: 0.25, b: 0.2, a: 1 }, { r: 0.2, g: 0.45, b: 0.8, a: 1 }, { r: 0.95, g: 0.75, b: 0.2, a: 1 },
                    { r: 0.3, g: 0.65, b: 0.35, a: 1 }]);
                instance(`Stall ${cx},${cz}.${i}`, prefabs.stall, [x0 + 18 + (i % 3) * 18, 0, z0 + 25 + Math.floor(i / 3) * 24],
                    between(-20, 20), 1, [tint('canopy', colour)]);
            }
            continue;
        }
        if (cx === 10 && cz === 10) {
            // The mill: its sails are turned by the game's own system, with no body to say so.
            const mill = add('Windmill', [tf([mid[0], 0, mid[2]], quatY(-25))]);
            add('Tower', [tf(), renderer(meshes.millBody, textures.plaster, materials.masonry)], mill);
            const hub = add('Hub', [tf([0, 8.5, 3.2])], mill);
            add('Sails', [tf(), renderer(meshes.sails, textures.cloth, materials.wood)], hub);
            continue;
        }
        if (cx === 0 && cz === 0) continue;  // the flyer's take-off field: bare ground
        if (cx === 11 && cz === 6 - 1) {
            // Carts on dynamic bodies, and nothing else static but the ground: this cell's proxy is ground and road only.
            for (let i = 0; i < 4; i++) {
                add(`Cart ${i}`, [tf([x0 + 15 + i * 14, 0.2, z0 + 10]), renderer(meshes.cart, textures.wood, materials.wood),
                    comp('RigidBody3D', { bodyType: 2 }), comp('BoxCollider3D', { halfExtents: { x: 1.3, y: 0.7, z: 0.8 } })]);
            }
            continue;
        }
        if (FOREST(cx, cz) || FIELDS(cx, cz)) {
            const count = FOREST(cx, cz) ? 26 : 6;
            for (let i = 0; i < count; i++) {
                const tall = FOREST(cx, cz) ? rng() < 0.6 : rng() < 0.2;
                instance(`Tree ${cx},${cz}.${i}`, tall ? prefabs.treeTall : prefabs.treeRound,
                    [x0 + between(10, CELL - 4), 0, z0 + between(10, CELL - 4)], between(0, 360), between(0.8, 1.4),
                    tall ? [] : [tint('crown', { r: between(0.7, 1), g: 1, b: between(0.7, 0.95), a: 1 })], i % 2 === 1);
            }
            if (FIELDS(cx, cz)) {
                for (let i = 0; i < 4; i++) {
                    const f = add(`Fence ${cx},${cz}.${i}`, [tf([x0 + 20 + (i % 2) * 40, 0, z0 + 20 + Math.floor(i / 2) * 40], quatY(i * 90))]);
                    add('Rails', [tf(), renderer(meshes.fence, textures.wood, materials.wood)], f);
                }
            }
            continue;
        }
        // Houses along the streets, trees and lamps between them.
        const lots = [[22, 22], [56, 22], [22, 56], [56, 56]];
        for (const [i, [lx, lz]] of lots.entries()) {
            if (rng() < 0.15) continue;
            const kind = pick([prefabs.houseA, prefabs.houseA, prefabs.houseB, prefabs.houseC]);
            instance(`House ${cx},${cz}.${i}`, kind, [x0 + lx + between(-3, 3), 0, z0 + lz + between(-3, 3)],
                pick([0, 90, 180, 270]) + between(-6, 6), 1, rng() < 0.3 ? [tint('walls', { r: between(0.8, 1), g: between(0.8, 1), b: between(0.75, 0.95), a: 1 })] : [],
                i % 2 === 1);
        }
        for (let i = 0; i < 3; i++) instance(`Tree ${cx},${cz}.${i}`, rng() < 0.3 ? prefabs.treeTall : prefabs.treeRound,
            [x0 + between(8, CELL - 8), 0, z0 + between(8, CELL - 8)], between(0, 360), between(0.7, 1.1));
        instance(`Lamp ${cx},${cz}`, prefabs.lamp, [x0 + 8, 0, z0 + 8], 45);
        if (rng() < 0.12) {
            // Scaffolding taken down for now: disabled, so no proxy draws it either.
            add(`Scaffold ${cx},${cz}`, [tf([x0 + 40, 0, z0 + 40]), renderer(meshes.scaffold, textures.wood, materials.wood, WHITE, { enabled: false })]);
        }
    }
}

rmSync(path.join(project, 'assets/scenes'), { recursive: true, force: true });
write('assets/scenes/main.esscene', JSON.stringify({ version: 4, name: 'Far Proxy Town', entities }, null, 1) + '\n', 'scene');
console.log(`far-proxy-town: ${entities.length} scene entries, ${Object.keys(meshes).length} meshes, ${Object.keys(textures).length} textures,`
    + ` ${Object.keys(prefabs).length + 1} prefabs`);
