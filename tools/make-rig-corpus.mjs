// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  make-rig-corpus.mjs — the two rigs the animation capabilities are
 *        certified against, cut down from their CC0 sources.
 *
 * Three animation capabilities shipped in 0.66 with nothing in the corpus able
 * to show them, and all three were short of the same thing: a rig. A two-bone
 * solve needs a limb, a retarget needs a SECOND skeleton spelling its joints
 * differently, and a 2D blend needs motion answering to two parameters at once.
 * Hand-built fixtures could satisfy the letter of all three and none of the
 * point — a difference in bone names I invented is not the difference a creator
 * hits, which is that two artists named the same joint two ways.
 *
 * So both rigs come from real CC0 packs by different authors, and the naming
 * split between them is the one their authors actually made:
 *
 *   hero    Quaternius, Universal Animation Library (CC0 1.0) — a Rigify
 *           skeleton (`DEF-upper_arm.L`) with the clips authored on it.
 *           https://github.com/J-Ponzo/gltf-universal-animation-library
 *   knight  KayKit Adventurers 1.0 by Kay Lousberg (CC0 1.0) — its own naming
 *           (`upperarm.l`), stockier proportions, and NO clips of its own: what
 *           it plays is the hero's, which is what retargeting is for.
 *           https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
 *
 * The packs are tens of megabytes and the corpus needs a fraction, so this cuts
 * a subset rather than vendoring them: the skeleton entire (a skin names every
 * joint), the body meshes, and for the hero the five clips the blend plane's
 * corners need. Run it again to re-cut; the sources are not in the repo.
 *
 *   node tools/make-rig-corpus.mjs --src <dir with the downloaded packs>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'examples', 'character-rig', 'assets', 'models');

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * The corners of the blend plane, and the idle it rests at. Speed against
 * stance: crouch-walking is not the average of walking and crouching, which is
 * the whole reason this cannot be two 1D blends stacked.
 */
const HERO_CLIPS = [
    'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
];

/**
 * Props the pack parents to the hands. A rig demo carries no loadout.
 *
 * `bow` is anchored because this matches BONE names too, and an unanchored one
 * takes `elbowIK` with it — a control bone, silently, with nothing to notice.
 */
const KNIGHT_PROPS = /sword|shield|axe|dagger|staff|wand|mug|quiver|smokebomb|spellbook|crossbow|\bbow\b/i;

/**
 * The mannequin's joint balls — 60% of its vertices, drawn to show an artist
 * where the rig bends. What bends is the thing under test here, so they are
 * decoration this corpus pays for twice: once in the repo and once in a build.
 */
const HERO_DECORATION = /^M_Joints$/;

/**
 * Finger bones. A two-bone solve reaches with the arm, a blend plane is walked
 * with the legs, and a retarget maps neither — so thirty of the hero's
 * fifty-five joints animate nothing under test, at thirty keys a second each.
 * Their skin weights move to the hand, which is where they already sit.
 */
const HERO_FINGERS = /^DEF-(f_index|f_middle|f_pinky|f_ring|thumb)\./;

/**
 * A glTF is authored in metres and a world unit is a design pixel, so a
 * character arrives under two units tall without this. Both rigs take the same
 * one: what differs between them is meant to be their own proportions.
 */
const IMPORT_SCALE = 100;

function readSource(dir, file) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
    if (bytes.byteLength >= 4 && view(bytes).getUint32(0, true) === GLB_MAGIC) return parseGlb(bytes);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const bins = (json.buffers ?? []).map((b) => (b.uri && !b.uri.startsWith('data:')
        ? new Uint8Array(readFileSync(path.join(dir, decodeURIComponent(b.uri))))
        : dataUri(b.uri)));
    return { json, bins };
}

const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function dataUri(uri) {
    const comma = uri.indexOf(',');
    return new Uint8Array(Buffer.from(uri.slice(comma + 1), 'base64'));
}

function parseGlb(bytes) {
    const dv = view(bytes);
    let json = null; let bin = null;
    for (let off = 12; off + 8 <= bytes.byteLength;) {
        const len = dv.getUint32(off, true);
        const type = dv.getUint32(off + 4, true);
        const body = bytes.subarray(off + 8, off + 8 + len);
        if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
        else if (type === CHUNK_BIN) bin = body;
        off += 8 + len;
    }
    return { json, bins: [bin] };
}

/** An accessor's bytes, gathered as one tightly packed view. */
function accessorBytes(json, bins, index) {
    const acc = json.accessors[index];
    const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    const stride = COMPONENT[acc.componentType] * COUNT[acc.type];
    const out = new Uint8Array(stride * acc.count);
    if (acc.bufferView === undefined) return out;
    const bv = json.bufferViews[acc.bufferView];
    const src = bins[bv.buffer];
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const step = bv.byteStride ?? stride;
    for (let i = 0; i < acc.count; i++) {
        out.set(src.subarray(base + i * step, base + i * step + stride), i * stride);
    }
    return out;
}

function accessorInts(json, bins, index) {
    const acc = json.accessors[index];
    const bytes = accessorBytes(json, bins, index);
    if (acc.componentType === 5121) return bytes;
    if (acc.componentType === 5123) return new Uint16Array(bytes.buffer, 0, bytes.byteLength / 2);
    throw new Error(`JOINTS_0 has componentType ${acc.componentType}, which this does not read`);
}

const CONSTANT_EPS = 1e-5;

/**
 * How far a dropped key may pull its curve. Rotations are quaternion components
 * — 0.004 is about half a degree — and the rest are metres, this being what a
 * glTF is authored in.
 */
const SIMPLIFY_EPS = { rotation: 0.004, translation: 0.0005, scale: 0.0005 };
const REST = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

function accessorFloats(json, bins, index) {
    if (json.accessors[index].componentType !== 5126) return null;
    const bytes = accessorBytes(json, bins, index);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/**
 * A channel stating the joint's rest value for its whole length — an export
 * bakes all three onto every bone whether or not the animator touched it.
 * Dropped only when the constant IS the node's rest: a channel holding still
 * somewhere else is what puts the joint there.
 */
function saysNothing(json, bins, anim, channel) {
    const width = REST[channel.target.path]?.length;
    if (!width) return false;
    const values = accessorFloats(json, bins, anim.samplers[channel.sampler].output);
    if (!values || values.length % width !== 0) return false;
    const rest = json.nodes[channel.target.node][channel.target.path] ?? REST[channel.target.path];
    for (let i = 0; i < values.length; i++) {
        if (Math.abs(values[i] - values[i % width]) > CONSTANT_EPS) return false;
    }
    for (let i = 0; i < width; i++) {
        if (Math.abs(values[i] - rest[i]) > CONSTANT_EPS) return false;
    }
    return true;
}

/**
 * Cut `json` down to the nodes, meshes and animations asked for, rebuilding the
 * accessors and the one buffer that back them. Node indices are renumbered, so
 * every reference to one — children, joints, animation targets — is remapped
 * rather than left pointing at whatever now sits at that number.
 */
function subset(json, bins, { dropNode, dropPrimitive = () => false, keepAnimation, images }) {
    const keptNodes = json.nodes.map((n, i) => (dropNode(n, i) ? -1 : i)).filter((i) => i >= 0);
    const nodeMap = new Map(keptNodes.map((old, next) => [old, next]));

    const out = {
        asset: { version: '2.0', generator: 'estella tools/make-rig-corpus.mjs' },
        accessors: [], bufferViews: [], buffers: [],
    };
    const chunks = [];
    const pushAccessor = (spec, bytes) => {
        const offset = chunks.reduce((n, c) => n + c.byteLength, 0);
        chunks.push(bytes);
        out.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
        out.accessors.push({ bufferView: out.bufferViews.length - 1, ...spec });
        return out.accessors.length - 1;
    };
    const accMap = new Map();
    const takeAccessor = (index) => {
        if (index === undefined) return undefined;
        if (accMap.has(index)) return accMap.get(index);
        const src = json.accessors[index];
        const next = pushAccessor({
            componentType: src.componentType, count: src.count, type: src.type,
            ...(src.min ? { min: src.min } : {}), ...(src.max ? { max: src.max } : {}),
            ...(src.normalized ? { normalized: true } : {}),
        }, accessorBytes(json, bins, index));
        accMap.set(index, next);
        return next;
    };
    /** Selected rows of a fixed-width float accessor, in the order given. */
    const takeRows = (index, rows, width) => {
        const all = accessorFloats(json, bins, index);
        const picked = new Float32Array(rows.length * width);
        rows.forEach((row, i) => picked.set(all.subarray(row * width, row * width + width), i * width));
        return pushAccessor({ componentType: 5126, count: rows.length, type: json.accessors[index].type },
                            new Uint8Array(picked.buffer));
    };

    // A dropped joint hands its weight to the nearest surviving ancestor, so a
    // vertex bound to a finger stays on the hand it is part of rather than
    // collapsing to joint 0, which is the rig's origin.
    const parentOf = new Map();
    json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
    const survivor = (node) => {
        let at = node;
        while (at !== undefined && !nodeMap.has(at)) at = parentOf.get(at);
        return at;
    };
    const keptSlots = (json.skins ?? []).map(
        (s) => s.joints.map((_, slot) => slot).filter((slot) => nodeMap.has(s.joints[slot])));
    const skin = json.skins?.[0];
    let jointSlots = null;
    if (skin && keptSlots[0].length < skin.joints.length) {
        const slotOfNode = new Map(skin.joints.map((node, slot) => [node, slot]));
        const moved = new Map(keptSlots[0].map((slot, next) => [slot, next]));
        jointSlots = skin.joints.map((node, slot) => moved.get(slot)
            ?? moved.get(slotOfNode.get(survivor(node))) ?? 0);
    }
    /** The primitive's bindings, restated against the joints that survived. */
    const reskin = (p) => {
        const from = accessorInts(json, bins, p.attributes.JOINTS_0);
        const weights = accessorFloats(json, bins, p.attributes.WEIGHTS_0);
        const count = json.accessors[p.attributes.JOINTS_0].count;
        const toJoints = new Uint16Array(count * 4);
        const toWeights = new Float32Array(count * 4);
        for (let v = 0; v < count; v++) {
            const merged = new Map();
            for (let k = 0; k < 4; k++) {
                const weight = weights[v * 4 + k];
                if (weight <= 0) continue;
                const slot = jointSlots[from[v * 4 + k]];
                merged.set(slot, (merged.get(slot) ?? 0) + weight);
            }
            const top = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
            const total = top.reduce((n, [, weight]) => n + weight, 0) || 1;
            top.forEach(([slot, weight], k) => {
                toJoints[v * 4 + k] = slot;
                toWeights[v * 4 + k] = weight / total;
            });
        }
        return {
            JOINTS_0: pushAccessor({ componentType: 5123, count, type: 'VEC4' },
                                   new Uint8Array(toJoints.buffer)),
            WEIGHTS_0: pushAccessor({ componentType: 5126, count, type: 'VEC4' },
                                    new Uint8Array(toWeights.buffer)),
        };
    };

    const meshMap = new Map();
    const materialMap = new Map();
    const takeMaterial = (index) => {
        if (index === undefined) return undefined;
        if (materialMap.has(index)) return materialMap.get(index);
        const src = structuredClone(json.materials[index]);
        const pbr = src.pbrMetallicRoughness;
        // One texture, written beside the .gltf: the corpus keeps image bytes
        // out of the JSON, and a pack's atlas is the only one either rig has.
        if (pbr?.baseColorTexture) {
            const tex = json.textures[pbr.baseColorTexture.index];
            pbr.baseColorTexture = { index: 0 };
            out.textures = [{ source: 0, ...(tex.sampler !== undefined ? { sampler: 0 } : {}) }];
            out.images = [{ uri: images.uri }];
            if (tex.sampler !== undefined) out.samplers = [json.samplers[tex.sampler]];
            const image = json.images[tex.source];
            const bv = json.bufferViews[image.bufferView];
            images.write(bins[bv.buffer].subarray(bv.byteOffset ?? 0,
                                                 (bv.byteOffset ?? 0) + bv.byteLength));
        }
        const next = (out.materials ??= []).push(src) - 1;
        materialMap.set(index, next);
        return next;
    };
    const takeMesh = (index) => {
        if (meshMap.has(index)) return meshMap.get(index);
        const src = json.meshes[index];
        const mesh = {
            name: src.name,
            primitives: src.primitives.filter((p) => !dropPrimitive(p, json)).map((p) => {
                const rebind = jointSlots && p.attributes.JOINTS_0 !== undefined;
                const attributes = Object.fromEntries(Object.entries(p.attributes)
                    .filter(([k]) => !(rebind && (k === 'JOINTS_0' || k === 'WEIGHTS_0')))
                    .map(([k, v]) => [k, takeAccessor(v)]));
                if (rebind) Object.assign(attributes, reskin(p));
                return {
                    attributes,
                    ...(p.indices !== undefined ? { indices: takeAccessor(p.indices) } : {}),
                    ...(p.material !== undefined ? { material: takeMaterial(p.material) } : {}),
                    ...(p.mode !== undefined ? { mode: p.mode } : {}),
                };
            }),
        };
        const next = (out.meshes ??= []).push(mesh) - 1;
        meshMap.set(index, next);
        return next;
    };

    out.nodes = keptNodes.map((old) => {
        const src = json.nodes[old];
        const node = { name: src.name };
        for (const k of ['translation', 'rotation', 'scale', 'matrix']) {
            if (src[k]) node[k] = src[k];
        }
        const children = (src.children ?? []).filter((c) => nodeMap.has(c)).map((c) => nodeMap.get(c));
        if (children.length) node.children = children;
        if (src.mesh !== undefined) node.mesh = takeMesh(src.mesh);
        if (src.skin !== undefined) node.skin = src.skin;
        return node;
    });

    if (json.skins?.length) {
        out.skins = json.skins.map((s, si) => ({
            ...(s.name ? { name: s.name } : {}),
            joints: keptSlots[si].map((slot) => nodeMap.get(s.joints[slot])),
            ...(s.skeleton !== undefined && nodeMap.has(s.skeleton)
                ? { skeleton: nodeMap.get(s.skeleton) } : {}),
            // Row per joint: an unfiltered matrix list against a filtered joint
            // list binds every joint past the first drop to the wrong pose.
            ...(s.inverseBindMatrices !== undefined
                ? { inverseBindMatrices: takeRows(s.inverseBindMatrices, keptSlots[si], 16) } : {}),
        }));
    }

    const animations = (json.animations ?? []).filter((a) => keepAnimation(a.name));
    let dropped = 0;
    let keys = 0;
    let keysWere = 0;

    /**
     * The keys a linear curve needs, which is not the one key per frame an
     * export bakes. Douglas-Peucker against the WHOLE span rather than against
     * neighbours, so dropping a run of keys cannot drift: each survivor is kept
     * because something between it and the next one exceeded the tolerance.
     */
    const thin = (sampler, path) => {
        const eps = SIMPLIFY_EPS[path];
        if (!eps || (sampler.interpolation ?? 'LINEAR') !== 'LINEAR') return null;
        const times = accessorFloats(json, bins, sampler.input);
        const values = accessorFloats(json, bins, sampler.output);
        if (!times || !values || times.length < 3) return null;
        const width = values.length / times.length;
        if (!Number.isInteger(width)) return null;
        // A quaternion and its negation are the same rotation, and an export can
        // flip mid-curve; a flip read as motion would pin every key around it.
        if (path === 'rotation') {
            for (let i = 1; i < times.length; i++) {
                let dot = 0;
                for (let k = 0; k < width; k++) dot += values[(i - 1) * width + k] * values[i * width + k];
                if (dot < 0) for (let k = 0; k < width; k++) values[i * width + k] *= -1;
            }
        }
        const keep = new Uint8Array(times.length);
        keep[0] = 1;
        keep[times.length - 1] = 1;
        const spans = [[0, times.length - 1]];
        while (spans.length) {
            const [a, b] = spans.pop();
            if (b - a < 2) continue;
            let worst = 0;
            let at = -1;
            for (let i = a + 1; i < b; i++) {
                const t = (times[i] - times[a]) / ((times[b] - times[a]) || 1);
                let err = 0;
                for (let k = 0; k < width; k++) {
                    const from = values[a * width + k];
                    const lerp = from + (values[b * width + k] - from) * t;
                    err = Math.max(err, Math.abs(values[i * width + k] - lerp));
                }
                if (err > worst) { worst = err; at = i; }
            }
            if (worst > eps && at > 0) { keep[at] = 1; spans.push([a, at], [at, b]); }
        }
        const rows = [];
        for (let i = 0; i < keep.length; i++) if (keep[i]) rows.push(i);
        if (rows.length === times.length) return null;
        const keptTimes = new Float32Array(rows.map((i) => times[i]));
        return {
            kept: rows.length,
            input: pushAccessor({
                componentType: 5126, count: rows.length, type: 'SCALAR',
                min: [keptTimes[0]], max: [keptTimes[rows.length - 1]],
            }, new Uint8Array(keptTimes.buffer)),
            output: takeRows(sampler.output, rows, width),
        };
    };
    if (animations.length) {
        out.animations = animations.map((a) => {
            const samplers = [];
            const samplerMap = new Map();
            const channels = [];
            for (const ch of a.channels) {
                if (!nodeMap.has(ch.target.node)) continue;
                if (saysNothing(json, bins, a, ch)) { dropped++; continue; }
                if (!samplerMap.has(ch.sampler)) {
                    const s = a.samplers[ch.sampler];
                    const thinned = thin(s, ch.target.path);
                    keys += thinned ? thinned.kept : json.accessors[s.input].count;
                    keysWere += json.accessors[s.input].count;
                    samplerMap.set(ch.sampler, samplers.push({
                        input: thinned ? thinned.input : takeAccessor(s.input),
                        output: thinned ? thinned.output : takeAccessor(s.output),
                        ...(s.interpolation ? { interpolation: s.interpolation } : {}),
                    }) - 1);
                }
                channels.push({
                    sampler: samplerMap.get(ch.sampler),
                    target: { node: nodeMap.get(ch.target.node), path: ch.target.path },
                });
            }
            return { name: a.name, samplers, channels };
        });
    }

    if (dropped) console.log(`  dropped ${dropped} channel(s) that state the rest pose`);
    if (keysWere) console.log(`  ${keys} keys where the export baked ${keysWere}`);
    out.scenes = [{ nodes: (json.scenes[json.scene ?? 0].nodes)
        .filter((n) => nodeMap.has(n)).map((n) => nodeMap.get(n)) }];
    out.scene = 0;

    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const buffer = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { buffer.set(c, at); at += c.byteLength; }
    out.buffers = [{
        byteLength: total,
        uri: `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`,
    }];
    return out;
}

const args = process.argv.slice(2);
const srcDir = args[args.indexOf('--src') + 1];
if (!srcDir || srcDir.startsWith('--')) {
    console.error('usage: node tools/make-rig-corpus.mjs --src <dir>\n\n'
        + 'The dir holds the two CC0 packs named in this file\'s header:\n'
        + '  AnimationLibrary_Godot_Standard.gltf + .bin   (Quaternius, hero)\n'
        + '  Knight.glb                                    (KayKit, knight)');
    process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const hero = readSource(srcDir, 'AnimationLibrary_Godot_Standard.gltf');
const heroOut = subset(hero.json, hero.bins, {
    dropNode: (n) => HERO_FINGERS.test(n.name ?? ''),
    dropPrimitive: (p, json) => HERO_DECORATION.test(json.materials?.[p.material]?.name ?? ''),
    keepAnimation: (name) => HERO_CLIPS.includes(name),
    images: { uri: '', write: () => {} },
});
writeFileSync(path.join(OUT, 'hero.gltf'), JSON.stringify(heroOut));

const knight = readSource(srcDir, 'Knight.glb');
const knightOut = subset(knight.json, knight.bins, {
    dropNode: (n) => KNIGHT_PROPS.test(n.name ?? ''),
    keepAnimation: () => false,
    images: {
        uri: 'knight.png',
        write: (bytes) => writeFileSync(path.join(OUT, 'knight.png'), bytes),
    },
});
writeFileSync(path.join(OUT, 'knight.gltf'), JSON.stringify(knightOut));

for (const [name, doc] of [['hero', heroOut], ['knight', knightOut]]) {
    const size = JSON.stringify(doc).length;
    console.log(`${name}.gltf  ${(size / 1024).toFixed(0)}KB  `
        + `${doc.nodes.length} nodes, ${doc.meshes?.length ?? 0} meshes, `
        + `${doc.animations?.length ?? 0} clips`);
}

// The importer the editor and the CLI share writes the products; a second
// writer of `.esmesh` would drift from the one under test. In the same breath
// as the cut, so a re-cut leaves no stale products beside a new source.
for (const stem of ['hero', 'knight']) {
    execFileSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'import-model',
        path.join(OUT, `${stem}.gltf`), '--scale', String(IMPORT_SCALE),
        '--project', path.dirname(path.dirname(OUT)),
    ], { stdio: 'inherit' });
}

// =============================================================================
// The avatars, once `estella import-model` has written the prefabs
// =============================================================================

/**
 * How the two artists named the same joint — the only authored thing here; rest
 * poses and sizes are measured off the rigs. Only joints that correspond one for
 * one: the hero's three spine segments answer to the knight's two, and mapping a
 * pair onto one bone would have the second silently overwrite the first.
 */
const JOINT_NAMES = {
    'DEF-hips': 'hips',
    'DEF-spine.001': 'spine',
    'DEF-spine.003': 'chest',
    'DEF-head': 'head',
    'DEF-upper_arm.L': 'upperarm.l',
    'DEF-forearm.L': 'lowerarm.l',
    'DEF-hand.L': 'hand.l',
    'DEF-upper_arm.R': 'upperarm.r',
    'DEF-forearm.R': 'lowerarm.r',
    'DEF-hand.R': 'hand.r',
    'DEF-thigh.L': 'upperleg.l',
    'DEF-shin.L': 'lowerleg.l',
    'DEF-foot.L': 'foot.l',
    'DEF-thigh.R': 'upperleg.r',
    'DEF-shin.R': 'lowerleg.r',
    'DEF-foot.R': 'foot.r',
};

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

function rotate(q, v) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
        x: v.x + q.w * tx + q.y * tz - q.z * ty,
        y: v.y + q.w * ty + q.z * tx - q.x * tz,
        z: v.z + q.w * tz + q.x * ty - q.y * tx,
    };
}

/**
 * Every joint of a prefab's rig: its `childPath`, its local bind rotation, and
 * where it rests relative to the skeleton root. Paths are what a clip addresses
 * a joint by, so they are what an avatar is keyed on.
 */
function readRig(prefabFile) {
    const prefab = JSON.parse(readFileSync(prefabFile, 'utf8'));
    const byId = new Map(prefab.entities.map((e) => [e.prefabEntityId, e]));
    const joints = new Map();
    const trs = (e) => {
        const t = e.components.find((c) => c.type === 'Transform')?.data ?? {};
        return {
            p: t.position ?? { x: 0, y: 0, z: 0 },
            r: t.rotation ?? IDENTITY,
            s: t.scale ?? { x: 1, y: 1, z: 1 },
        };
    };
    // The prefab root carries the import's scale, and the skeleton root is a
    // child of it; a size measured through that scale would be the same ratio
    // on both rigs, but it would not be the rig's own size.
    const walk = (id, prefix, origin, rotation) => {
        const e = byId.get(id);
        const local = trs(e);
        const at = prefix === null ? { x: 0, y: 0, z: 0 } : (() => {
            const turned = rotate(rotation, local.p);
            return { x: origin.x + turned.x, y: origin.y + turned.y, z: origin.z + turned.z };
        })();
        const path = prefix === null ? '' : (prefix ? `${prefix}/${e.name}` : e.name);
        if (prefix !== null) joints.set(e.name, { path, rest: local.r, at });
        const spin = prefix === null ? IDENTITY : quatMul(rotation, local.r);
        for (const child of e.children) walk(child, path, at, spin);
    };
    walk(prefab.rootEntityId, null, { x: 0, y: 0, z: 0 }, IDENTITY);
    return joints;
}

const quatMul = (a, b) => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/** Root to the joint furthest from it: the one measure both avatars use. */
function rigSize(joints) {
    const root = joints.get('root');
    if (!root) throw new Error('rig has no `root` joint to measure from');
    let far = 0;
    for (const j of joints.values()) {
        far = Math.max(far, Math.hypot(j.at.x - root.at.x, j.at.y - root.at.y, j.at.z - root.at.z));
    }
    return far;
}

function writeAvatar(file, { joints, rest, scale }) {
    writeFileSync(file, `${JSON.stringify({ version: 1, joints, rest, scale }, null, 2)}\n`);
}

const heroRig = readRig(path.join(OUT, 'hero.esprefab'));
const knightRig = readRig(path.join(OUT, 'knight.esprefab'));
if (heroRig.size > 1 && knightRig.size > 1) {
    const heroRest = {};
    const knightJoints = {};
    const knightRest = {};
    for (const [heroName, knightName] of Object.entries(JOINT_NAMES)) {
        const mine = heroRig.get(heroName);
        const theirs = knightRig.get(knightName);
        if (!mine) throw new Error(`hero rig has no joint named ${heroName}`);
        if (!theirs) throw new Error(`knight rig has no joint named ${knightName}`);
        heroRest[mine.path] = mine.rest;
        knightJoints[mine.path] = theirs.path;
        knightRest[mine.path] = theirs.rest;
    }
    writeAvatar(path.join(OUT, 'hero.esavatar'),
                { joints: {}, rest: heroRest, scale: rigSize(heroRig) });
    writeAvatar(path.join(OUT, 'knight.esavatar'),
                { joints: knightJoints, rest: knightRest, scale: rigSize(knightRig) });
    console.log(`avatars      ${Object.keys(JOINT_NAMES).length} joints mapped, `
        + `hero ${rigSize(heroRig).toFixed(2)} tall vs knight ${rigSize(knightRig).toFixed(2)}`);
} else {
    console.log('avatars      skipped — run `estella import-model` on both .gltf first');
}
