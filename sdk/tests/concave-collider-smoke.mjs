/**
 * A concave PolygonCollider2D against the real Box2D. The shape is a cup, whose
 * convex hull is a filled rectangle: a body dropped in rests on the floor at
 * y≈0.2, and on a sealed lid at y≈3.2 if anything stops dividing it. Both are
 * asserted, because the second is what makes the first mean anything.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireWasm } from '../../tools/lib/wasmDir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { decomposePolygon2D, computePolygonHull } =
    await import('file://' + path.join(HERE, '..', 'dist', 'physics', 'index.js').replace(/\\/g, '/'));

const wasmDir = requireWasm('physics.wasm');
const factory = (await import('file://' + path.join(wasmDir, 'physics.js').replace(/\\/g, '/'))).default;
const m = await factory({ wasmBinary: readFileSync(path.join(wasmDir, 'physics.wasm')) });

let pass = true;
const check = (name, cond, detail) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
    if (!cond) pass = false;
};

const STATIC = 0, DYNAMIC = 2;
const CUP = 1, DROP = 2;

function bodyPos(entity) {
    const count = m._physics_getDynamicBodyCount();
    const base = m._physics_getDynamicBodyTransforms() >> 2;
    for (let i = 0; i < count; i++) {
        const o = base + i * 4;
        if (m.HEAPU32[o] === entity) return { x: m.HEAPF32[o + 1], y: m.HEAPF32[o + 2] };
    }
    return null;
}

/** One convex piece as a Box2D polygon shape on `entity`'s body. */
function addPiece(entity, piece) {
    const ptr = m._malloc(piece.length * 2 * 4);
    const base = ptr >> 2;
    for (let i = 0; i < piece.length; i++) {
        m.HEAPF32[base + i * 2] = piece[i].x;
        m.HEAPF32[base + i * 2 + 1] = piece[i].y;
    }
    m._physics_addPolygonShape(entity, ptr, piece.length, 0, 1, 0.3, 0, 0, 1, 0xffff);
    m._free(ptr);
}

// A cup: a floor at y=0 between x=±1, two walls up to y=3, and a solid base under
// it. The mouth is open; the hull closes it.
const CUP_RING = [
    { x: -2, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 3 }, { x: 1, y: 3 },
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 3 }, { x: -2, y: 3 },
];

/** Drop a small box down the middle from `y`, and answer where it stops. */
function dropInto(pieces, fromY) {
    m._physics_init(0, -9.81, 1 / 60, 4, 30, 10, 3);
    m._physics_createBody(CUP, STATIC, 0, 0, 0, 1, 0, 0, 0, 0);
    for (const piece of pieces) addPiece(CUP, piece);
    m._physics_createBody(DROP, DYNAMIC, 0, fromY, 0, 1, 0, 0, 0, 0);
    m._physics_addBoxShape(DROP, 0.2, 0.2, 0, 0, 0, 1, 0.3, 0, 0, 1, 0xffff);
    for (let i = 0; i < 420; i++) m._physics_step(1 / 60);
    const at = bodyPos(DROP);
    m._physics_shutdown();
    return at;
}

const { pieces, degenerate } = decomposePolygon2D(CUP_RING);
check('the cup partitions', !degenerate && pieces.length > 1, `${pieces.length} piece(s)`);
check('every piece fits one Box2D polygon', pieces.every((p) => p.length >= 3 && p.length <= 8),
      pieces.map((p) => p.length).join('+'));

// The claim: the mouth is open, so the box reaches the floor at y=0 and rests at
// its own half-height above it.
const landed = dropInto(pieces, 5);
check('a body falls INTO the concave cup', landed && Math.abs(landed.y - 0.2) < 0.1,
      `y=${landed?.y.toFixed(3)} (want ≈0.2, the floor)`);
check('and it stayed down the middle rather than sliding out', landed && Math.abs(landed.x) < 0.8,
      `x=${landed?.x.toFixed(3)}`);

// The control. Against the same ring's hull the mouth is sealed and the same drop
// rests on the rim — so the assertion above is measuring the decomposition, not
// merely that something stopped the box.
const onLid = dropInto([computePolygonHull(CUP_RING)], 5);
check('the hull of the same ring seals it — the control', onLid && Math.abs(onLid.y - 3.2) < 0.1,
      `y=${onLid?.y.toFixed(3)} (want ≈3.2, the sealed rim)`);
check('the two answers are far apart', landed && onLid && onLid.y - landed.y > 2.5,
      `${landed?.y.toFixed(3)} vs ${onLid?.y.toFixed(3)}`);

console.log(pass ? '\nconcave-collider-smoke: PASS' : '\nconcave-collider-smoke: FAIL');
process.exit(pass ? 0 : 1);
