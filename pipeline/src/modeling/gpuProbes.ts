// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DISPLACE_PATTERNS, mirroredPoint } from './displace';
import type { BakedModel } from './modelBake';
import { RELIEF_FLAT, RELIEF_RINGS, RELIEF_SPOKES, shadeTexels, startNormalBake, type BakeProbes, type NormalMap, type ShadeWork, type StainWork } from './normalBake';
import { normalize, type Vec3 } from './polyMesh';
import { checkStain, type StainParams } from './stain';
import { drawnLine, viewOf } from './surfaceLine';
import type { TriangleTree } from './triangleTree';

const DATA_WIDTH = 2048;
const DATA_SHIFT = 11;
const ITEM_WIDTH = 1024;
const BAND_LOW_MS = 30;
const BAND_HIGH_MS = 120;
const PAINT_TILE = 1024;

export type ProbeTick = (done: number, total: number) => void;

const VERTEX = `#version 300 es
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uNodes;
uniform sampler2D uSlots;
uniform sampler2D uCorners;
uniform sampler2D uNormals;
uniform ivec2 uOrigin;
uniform int uNodeCount;
out vec4 result;

vec4 at(sampler2D s, int i) {
    return texelFetch(s, ivec2(i & ${DATA_WIDTH - 1}, i >> ${DATA_SHIFT}), 0);
}

bool crosses(vec3 lo, vec3 hi, vec3 o, vec3 d, float near, float far) {
    for (int k = 0; k < 3; k++) {
        if (d[k] == 0.0) {
            if (o[k] < lo[k] || o[k] > hi[k]) return false;
            continue;
        }
        float t0 = (lo[k] - o[k]) / d[k], t1 = (hi[k] - o[k]) / d[k];
        near = max(near, min(t0, t1));
        far = min(far, max(t0, t1));
        if (near > far) return false;
    }
    return true;
}

int nearest(vec3 o, vec3 d, float reach, out vec2 place, out float along) {
    float best = reach;
    int found = -1;
    place = vec2(0.0);
    along = 0.0;
    for (int node = 0; node < uNodeCount;) {
        vec4 lo = at(uNodes, node * 2), hi = at(uNodes, node * 2 + 1);
        bool inside = crosses(lo.xyz, hi.xyz, o, d, -best, best);
        int count = int(hi.w);
        if (count == 0) {
            node = inside ? node + 1 : int(lo.w);
            continue;
        }
        node++;
        if (!inside) continue;
        int first = int(lo.w);
        for (int i = first; i < first + count; i++) {
            vec4 a = at(uSlots, i * 3);
            vec3 e1 = at(uSlots, i * 3 + 1).xyz - a.xyz, e2 = at(uSlots, i * 3 + 2).xyz - a.xyz;
            vec3 p = cross(d, e2);
            float det = dot(e1, p);
            if (det > -1e-14) continue;
            float inv = 1.0 / det;
            vec3 s = o - a.xyz;
            float u = dot(s, p) * inv;
            if (u < 0.0 || u > 1.0) continue;
            vec3 q = cross(s, e1);
            float v = dot(d, q) * inv;
            if (v < 0.0 || u + v > 1.0) continue;
            float t = dot(e2, q) * inv;
            if (abs(t) < best) {
                best = abs(t);
                found = int(a.w);
                place = vec2(u, v);
                along = t;
            }
        }
    }
    return found;
}

bool blocked(vec3 o, vec3 d, float reach) {
    for (int node = 0; node < uNodeCount;) {
        vec4 lo = at(uNodes, node * 2), hi = at(uNodes, node * 2 + 1);
        bool inside = crosses(lo.xyz, hi.xyz, o, d, 0.0, reach);
        int count = int(hi.w);
        if (count == 0) {
            node = inside ? node + 1 : int(lo.w);
            continue;
        }
        node++;
        if (!inside) continue;
        int first = int(lo.w);
        for (int i = first; i < first + count; i++) {
            vec3 a = at(uSlots, i * 3).xyz;
            vec3 e1 = at(uSlots, i * 3 + 1).xyz - a, e2 = at(uSlots, i * 3 + 2).xyz - a;
            vec3 p = cross(d, e2);
            float det = dot(e1, p);
            if (det > -1e-14 && det < 1e-14) continue;
            float inv = 1.0 / det;
            vec3 s = o - a;
            float u = dot(s, p) * inv;
            if (u < 0.0 || u > 1.0) continue;
            vec3 q = cross(s, e1);
            float v = dot(d, q) * inv;
            if (v < 0.0 || u + v > 1.0) continue;
            float t = dot(e2, q) * inv;
            if (t > 0.0 && t < reach) return true;
        }
    }
    return false;
}

void frame(vec4 item, out vec3 p, out vec3 n, out vec3 u, out vec3 v) {
    int c = int(item.x) * 3;
    float hv = item.y, hw = item.z, hu = 1.0 - hv - hw;
    p = hu * at(uCorners, c).xyz + hv * at(uCorners, c + 1).xyz + hw * at(uCorners, c + 2).xyz;
    n = hu * at(uNormals, c).xyz + hv * at(uNormals, c + 1).xyz + hw * at(uNormals, c + 2).xyz;
    float nl = length(n);
    n = nl > 0.0 ? n / nl : n;
    u = abs(n.x) < 0.9 ? vec3(0.0, -n.z, n.y) : vec3(-n.z, 0.0, n.x);
    float ul = length(u);
    u = ul > 0.0 ? u / ul : u;
    v = cross(n, u);
}
`;

const HITS = `${COMMON}
uniform sampler2D uCover;
uniform sampler2D uLight;
uniform float uSize;
uniform float uDistance;

void main() {
    ivec2 px = ivec2(gl_FragCoord.xy) + uOrigin;
    float t = texelFetch(uCover, px, 0).r;
    if (t < 0.0) { result = vec4(-1.0, 0.0, 0.0, 0.0); return; }
    int base = (int(t) / 3) * 6;
    vec4 pa = at(uLight, base), na = at(uLight, base + 1);
    vec4 pb = at(uLight, base + 2), nb = at(uLight, base + 3);
    vec4 pc = at(uLight, base + 4), nc = at(uLight, base + 5);
    vec2 A = vec2(pa.w, 1.0 - na.w) * uSize, B = vec2(pb.w, 1.0 - nb.w) * uSize, C = vec2(pc.w, 1.0 - nc.w) * uSize;
    float area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    vec2 P = vec2(px) + 0.5;
    float w0 = ((B.x - P.x) * (C.y - P.y) - (C.x - P.x) * (B.y - P.y)) / area;
    float w1 = ((C.x - P.x) * (A.y - P.y) - (A.x - P.x) * (C.y - P.y)) / area;
    float w2 = 1.0 - w0 - w1;
    vec3 n = w0 * na.xyz + w1 * nb.xyz + w2 * nc.xyz;
    float nl = length(n);
    n = nl > 0.0 ? n / nl : n;
    vec2 place;
    float along;
    int hit = nearest(w0 * pa.xyz + w1 * pb.xyz + w2 * pc.xyz, n, uDistance, place, along);
    result = vec4(float(hit), place, 0.0);
}`;

const float = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const SPOKE_GROUPS = Math.ceil(RELIEF_SPOKES.length / 4);
const groupOf = (pick: (spoke: (typeof RELIEF_SPOKES)[number]) => number, group: number): string =>
    `vec4(${[0, 1, 2, 3].map((k) => float(RELIEF_SPOKES[group * 4 + k] ? pick(RELIEF_SPOKES[group * 4 + k]!) : 0)).join(', ')})`;
const groups = (line: (group: number) => string): string => Array.from({ length: SPOKE_GROUPS }, (_, group) => line(group)).join('\n');

const RELIEF = `${COMMON}
uniform sampler2D uItems;
uniform float uReach;

void main() {
    vec4 item = texelFetch(uItems, ivec2(gl_FragCoord.xy) + uOrigin, 0);
    if (item.x < 0.0) { result = vec4(0.0); return; }
    vec3 p, n, u, v;
    frame(item, p, n, u, v);
    float wide = uReach * 1.001;
    vec3 e = wide * (sqrt(max(vec3(0.0), 1.0 - n * n)) + abs(n));
    vec3 boxLo = p - e, boxHi = p + e;
${groups((g) => `    vec4 x${g} = uReach * ${groupOf((spoke) => spoke.share * spoke.cos, g)}, y${g} = uReach * ${groupOf((spoke) => spoke.share * spoke.sin, g)}, best${g} = vec4(uReach), h${g} = vec4(0.0);`)}
    for (int node = 0; node < uNodeCount;) {
        vec4 lo = at(uNodes, node * 2), hi = at(uNodes, node * 2 + 1);
        bool inside = all(lessThanEqual(lo.xyz, boxHi)) && all(greaterThanEqual(hi.xyz, boxLo));
        int count = int(hi.w);
        if (count == 0) {
            node = inside ? node + 1 : int(lo.w);
            continue;
        }
        node++;
        if (!inside) continue;
        int first = int(lo.w);
        for (int i = first; i < first + count; i++) {
            vec3 a = at(uSlots, i * 3).xyz;
            vec3 e1 = at(uSlots, i * 3 + 1).xyz - a, e2 = at(uSlots, i * 3 + 2).xyz - a;
            vec3 q = cross(n, e2);
            float det = dot(e1, q);
            if (det > -1e-14) continue;
            float inv = 1.0 / det;
            vec3 s = p - a, w = cross(e1, n), m = cross(e1, e2);
            float u0 = dot(s, q) * inv, uU = dot(u, q) * inv, uV = dot(v, q) * inv;
            float v0 = dot(s, w) * inv, vU = dot(u, w) * inv, vV = dot(v, w) * inv;
            float t0 = dot(s, m) * inv, tU = dot(u, m) * inv, tV = dot(v, m) * inv;
            vec4 bu, bv, bt, take;
${groups((g) => `            bu = u0 + x${g} * uU + y${g} * uV; bv = v0 + x${g} * vU + y${g} * vV; bt = t0 + x${g} * tU + y${g} * tV;
            take = step(0.0, bu) * step(bu, vec4(1.0)) * step(0.0, bv) * step(bu + bv, vec4(1.0)) * (1.0 - step(best${g}, abs(bt)));
            best${g} = mix(best${g}, abs(bt), take); h${g} = mix(h${g}, bt, take);`)}
        }
    }
    float found[${SPOKE_GROUPS * 4}];
    float height[${SPOKE_GROUPS * 4}];
${groups((g) => [0, 1, 2, 3].map((k) => `    found[${g * 4 + k}] = best${g}[${k}]; height[${g * 4 + k}] = h${g}[${k}];`).join('\n'))}
    const vec3 SPOKES[${RELIEF_SPOKES.length}] = vec3[${RELIEF_SPOKES.length}](${RELIEF_SPOKES.map((spoke) => `vec3(${float(spoke.share)}, ${float(spoke.cos)}, ${float(spoke.sin)})`).join(', ')});
    float bias = uReach * 0.02, sum = 0.0;
    bool level = true;
    for (int j = 0; j < ${RELIEF_SPOKES.length}; j++) {
        float h = height[j];
        if (found[j] >= uReach) h = blocked(p + n * bias, u * SPOKES[j].y + v * SPOKES[j].z, uReach * SPOKES[j].x) ? uReach : -uReach;
        if (abs(h) > uReach * ${float(RELIEF_FLAT)}) level = false;
        sum += h;
        if (j == ${RELIEF_RINGS[0][1] - 1} && level) { result = vec4(0.0); return; }
    }
    result = vec4(clamp(sum / ${float(RELIEF_SPOKES.length)} / (uReach * 0.5), -1.0, 1.0));
}`;

const OCCLUSION = `${COMMON}
uniform sampler2D uItems;
uniform float uReach;
uniform float uBias;
uniform int uSide;

void main() {
    vec4 item = texelFetch(uItems, ivec2(gl_FragCoord.xy) + uOrigin, 0);
    if (item.x < 0.0) { result = vec4(0.0); return; }
    vec3 p, s, u, v;
    frame(item, p, s, u, v);
    float turn = fract(item.w * 0.61803398875);
    vec3 o = p + s * uBias;
    float open = 0.0, side = float(uSide);
    for (int a = 0; a < uSide; a++) {
        for (int b = 0; b < uSide; b++) {
            float r = sqrt((float(a) + 0.5) / side);
            float phi = ((float(b) + 0.5) / side + turn) * 6.283185307179586;
            float dn = sqrt(max(0.0, 1.0 - r * r));
            if (!blocked(o, u * (r * cos(phi)) + v * (r * sin(phi)) + s * dn, uReach)) open += 1.0;
        }
    }
    result = vec4(open / (side * side));
}`;


const PAINT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uCorners;
uniform sampler2D uNormals;
uniform sampler2D uHit;
uniform sampler2D uPrevColor;
uniform sampler2D uPrevMisc;
uniform sampler2D uChosen;
uniform sampler2D uRelief;
uniform sampler2D uLine;
uniform int uMirror;
uniform vec4 uNear;
uniform int uHard;
uniform int uLineStart;
uniform int uLineCount;
uniform float uLineWidth;
uniform ivec4 uView;
uniform vec4 uFacing;
uniform int uPattern;
uniform int uSeed;
uniform int uOctaves;
uniform vec3 uScale;
uniform float uWarp;
uniform float uWidth;
uniform int uAxis;
uniform float uCount;
uniform vec3 uAlong;
uniform vec3 uAcross1;
uniform vec3 uAcross2;
uniform float uLong;
uniform float uThreshold;
uniform float uSoftness;
uniform int uWhere;
uniform float uFray;
uniform float uAmount;
uniform vec4 uColor;
uniform vec4 uSet;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMisc;

const vec3 GRADIENTS[12] = vec3[12](
    vec3(1.0, 1.0, 0.0), vec3(-1.0, 1.0, 0.0), vec3(1.0, -1.0, 0.0), vec3(-1.0, -1.0, 0.0), vec3(1.0, 0.0, 1.0), vec3(-1.0, 0.0, 1.0),
    vec3(1.0, 0.0, -1.0), vec3(-1.0, 0.0, -1.0), vec3(0.0, 1.0, 1.0), vec3(0.0, -1.0, 1.0), vec3(0.0, 1.0, -1.0), vec3(0.0, -1.0, -1.0));

vec4 at(sampler2D s, int i) {
    return texelFetch(s, ivec2(i & ${DATA_WIDTH - 1}, i >> ${DATA_SHIFT}), 0);
}

float hash3(int x, int y, int z, int seed) {
    uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 873357470u + uint(seed) * 1442695041u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h ^= h >> 16u;
    return float(h) / 4294967295.0 * 2.0 - 1.0;
}

float unit(ivec3 c, int seed) {
    return hash3(c.x, c.y, c.z, seed) * 0.5 + 0.5;
}

float corner(ivec3 c, vec3 f, int seed) {
    return dot(GRADIENTS[int(floor(unit(c, seed) * 11.999))], f);
}

float gradientNoise(vec3 p, int seed) {
    vec3 i = floor(p), f = p - i;
    ivec3 c = ivec3(i);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
        mix(mix(corner(c, f, seed), corner(c + ivec3(1, 0, 0), f - vec3(1.0, 0.0, 0.0), seed), u.x),
            mix(corner(c + ivec3(0, 1, 0), f - vec3(0.0, 1.0, 0.0), seed), corner(c + ivec3(1, 1, 0), f - vec3(1.0, 1.0, 0.0), seed), u.x), u.y),
        mix(mix(corner(c + ivec3(0, 0, 1), f - vec3(0.0, 0.0, 1.0), seed), corner(c + ivec3(1, 0, 1), f - vec3(1.0, 0.0, 1.0), seed), u.x),
            mix(corner(c + ivec3(0, 1, 1), f - vec3(0.0, 1.0, 1.0), seed), corner(c + ivec3(1, 1, 1), f - vec3(1.0, 1.0, 1.0), seed), u.x), u.y),
        u.z) * 1.1;
}

vec3 scattered(vec3 p, int seed) {
    ivec3 base = ivec3(floor(p));
    float f1 = 1e30, f2 = 1e30, cell = 0.0;
    for (int dz = -1; dz <= 1; dz++) {
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                ivec3 c = base + ivec3(dx, dy, dz);
                float d = length(vec3(c) + vec3(unit(c, seed), unit(c, seed + 1), unit(c, seed + 2)) - p);
                if (d < f1) { f2 = f1; f1 = d; cell = unit(c, seed + 3); } else if (d < f2) f2 = d;
            }
        }
    }
    return vec3(f1, f2, cell);
}

float scratches(vec3 p, int seed, float width, vec3 n) {
    float deepest = 0.0;
    for (int layer = 0; layer < 3; layer++) {
        int s = seed + layer * 7;
        vec3 along = normalize(vec3(hash3(1, layer, 3, s), hash3(5, layer, 7, s), hash3(11, layer, 13, s)));
        vec3 side = normalize(abs(along.y) < 0.9 ? vec3(along.z, 0.0, -along.x) : vec3(0.0, -along.z, along.y));
        vec3 up = cross(along, side);
        float b = dot(p, side);
        int ib = int(floor(b));
        float a = dot(p, along) / 8.0 + unit(ivec3(ib, 0, 0), s + 1) * 13.0;
        float c = dot(p, up) / 8.0 + unit(ivec3(ib, 1, 0), s + 1) * 13.0;
        int ia = int(floor(a)), ic = int(floor(c));
        if (unit(ivec3(ib, ia, ic), s + 2) < 0.65) continue;
        float dist = abs(b - float(ib) - 0.2 - unit(ivec3(ib, ia, ic), s + 3) * 0.6);
        float taper = sin(3.141592653589793 * (a - float(ia))) * sin(3.141592653589793 * (c - float(ic)));
        float across = 1.0 - smoothstep(0.4, 0.75, abs(dot(n, side)));
        deepest = max(deepest, (1.0 - smoothstep(0.0, width, dist)) * min(1.0, taper * 3.0) * across);
    }
    return -deepest;
}

float weaveAt(float u, float v) {
    int iu = int(floor(u)), iv = int(floor(v));
    float a = sin(3.141592653589793 * (u - float(iu))), b = sin(3.141592653589793 * (v - float(iv)));
    return ((iu + iv) & 1) == 0 ? b * (0.55 + 0.45 * a) : a * (0.55 + 0.45 * b);
}

float patternAt(vec3 p, vec3 n) {
    if (uPattern == 0 || uPattern == 1 || uPattern == 9) {
        float sum = 0.0, amp = 1.0, total = 0.0, f = 1.0;
        for (int o = 0; o < uOctaves; o++) {
            float g = gradientNoise(p * f, uSeed + o);
            if (uPattern == 0) {
                sum += amp * g;
            } else if (uPattern == 1) {
                float crest = 1.0 - min(1.0, abs(g) * 2.5);
                sum += amp * crest * crest * crest;
            } else {
                sum += amp * (sqrt(abs(g) * 1.6 + 0.02) - 0.55);
            }
            total += amp;
            amp *= uPattern == 0 ? 0.5 : 0.45;
            f *= uPattern == 1 ? 2.1 : 2.0;
        }
        if (uPattern == 0) return (sum / total) * 1.6;
        if (uPattern == 1) return -min(1.0, (sum / total) * 1.5);
        return clamp((sum / total) * 2.2, -1.0, 1.0);
    }
    if (uPattern == 2 || uPattern == 3 || uPattern == 4) {
        vec3 s = scattered(p, uSeed);
        if (uPattern == 2) return smoothstep(0.0, uWidth, s.y - s.x) - 1.0;
        if (uPattern == 3) return smoothstep(0.0, 0.12, s.y - s.x) * (1.0 - min(1.0, s.x * s.x * 1.2)) - 0.5;
        float open = 1.0 - min(1.0, s.x / uWidth);
        return s.z < 0.55 ? 0.0 : -(open * open);
    }
    if (uPattern == 5) return sin(6.283185307179586 * (uAxis == 0 ? p.x : uAxis == 2 ? p.z : p.y));
    if (uPattern == 6) {
        vec3 w = vec3(pow(abs(n.x), 4.0), pow(abs(n.y), 4.0), pow(abs(n.z), 4.0));
        float total = w.x + w.y + w.z;
        total = total == 0.0 ? 1.0 : total;
        return ((w.x * weaveAt(p.y, p.z) + w.y * weaveAt(p.x, p.z) + w.z * weaveAt(p.x, p.y)) / total) * 2.0 - 1.0;
    }
    if (uPattern == 7) return scratches(p, uSeed, uWidth, n);
    return pow(fract((atan(p.x, p.z) / 6.283185307179586 + 1.0) * uCount), 1.5) * 2.0 - 1.0;
}

float field(vec3 at, vec3 n) {
    vec3 p = uPattern == 9 ? vec3(dot(at, uAcross1) / uScale.x, dot(at, uAlong) / (uScale.y * uLong), dot(at, uAcross2) / uScale.z) : at / uScale;
    if (uWarp > 0.0) {
        p += uWarp * vec3(
            gradientNoise(p * 0.7 + vec3(3.1, 0.0, 0.0), uSeed + 40),
            gradientNoise(p * 0.7 + vec3(0.0, 5.7, 0.0), uSeed + 41),
            gradientNoise(p * 0.7 + vec3(0.0, 0.0, 9.3), uSeed + 42));
    }
    return patternAt(p, n);
}

float share(vec3 at, vec3 n) {
    float value = field(at, n);
    return (uPattern == 1 || uPattern == 2 || uPattern == 4 || uPattern == 7) ? max(0.0, -value) : value * 0.5 + 0.5;
}

float weigh(vec3 raw, vec3 n, float shape) {
    float m = 1.0;
    vec3 p = vec3(uMirror == 0 ? abs(raw.x) : raw.x, uMirror == 1 ? abs(raw.y) : raw.y, uMirror == 2 ? abs(raw.z) : raw.z);
    if (uNear.w > 0.0) {
        float t = 1.0 - length(p - uNear.xyz) / uNear.w;
        float w = t <= 0.0 ? 0.0 : t * t * (3.0 - 2.0 * t);
        m *= uHard == 1 ? (w > 0.0 ? 1.0 : 0.0) : w;
        if (m == 0.0) return 0.0;
    }
    if (uLineCount > 0) {
        vec3 q = p;
        if (uView.z >= 0) {
            if (n[uView.z] * float(uView.w) <= 0.0) return 0.0;
            q = vec3(raw[uView.x], raw[uView.y], 0.0);
        }
        float best = 1e30;
        for (int i = 1; i < uLineCount; i++) {
            vec3 a = at(uLine, uLineStart + i - 1).xyz, d = at(uLine, uLineStart + i).xyz - a;
            float span = dot(d, d);
            float k = span > 0.0 ? clamp(dot(q - a, d) / span, 0.0, 1.0) : 0.0;
            best = min(best, length(q - a - d * k));
        }
        float t = 1.0 - best / uLineWidth;
        m *= t <= 0.0 ? 0.0 : uHard == 1 ? 1.0 : t * t * (3.0 - 2.0 * t);
        if (m == 0.0) return 0.0;
    }
    if (uFacing.w > 0.0) {
        m *= smoothstep(0.2, 0.75, dot(n, uFacing.xyz));
        if (m == 0.0) return 0.0;
    }
    if (uWhere != 0) {
        float sunk = uWhere == 1 ? shape : -shape;
        if (uPattern >= 0 && uFray >= 0.0) {
            return m * smoothstep(uThreshold * 0.4 - uSoftness, uThreshold * 0.4 + uSoftness, sunk + (share(p, n) - 0.5) * 2.0 * uFray * min(1.0, max(0.0, sunk) * 4.0 + 0.15));
        }
        m *= smoothstep(uThreshold * 0.4 - uSoftness, uThreshold * 0.4 + uSoftness, sunk);
        if (m == 0.0) return 0.0;
    }
    if (uPattern >= 0) m *= smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, share(p, n));
    return m;
}

void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    outColor = texelFetch(uPrevColor, px, 0);
    outMisc = texelFetch(uPrevMisc, px, 0);
    vec4 hit = texelFetch(uHit, px, 0);
    if (hit.x < 0.0) return;
    int triangle = int(hit.x);
    if (at(uChosen, triangle).r < 0.5) return;
    int c = triangle * 3;
    float hv = hit.y, hw = hit.z, hu = 1.0 - hv - hw;
    vec3 p = hu * at(uCorners, c).xyz + hv * at(uCorners, c + 1).xyz + hw * at(uCorners, c + 2).xyz;
    vec3 n = hu * at(uNormals, c).xyz + hv * at(uNormals, c + 1).xyz + hw * at(uNormals, c + 2).xyz;
    float nl = length(n);
    n = nl > 0.0 ? n / nl : n;
    float m = weigh(p, n, texelFetch(uRelief, px, 0).r) * uAmount;
    if (m <= 0.0) return;
    if (uColor.w > 0.0) outColor.rgb += (uColor.rgb - outColor.rgb) * m;
    if (uSet.x >= 0.0) outColor.a += (uSet.x - outColor.a) * m;
    if (uSet.y >= 0.0) outMisc.r += (uSet.y - outMisc.r) * m;
    if (uSet.z >= 0.0) outMisc.g += (uSet.z - outMisc.g) * m;
    if (uSet.w >= 0.0) outMisc.b += (uSet.w - outMisc.b) * m;
}`;

const SOURCES = { hits: HITS, relief: RELIEF, occlusion: OCCLUSION, paint: PAINT } as const;
type ProgramName = keyof typeof SOURCES;

interface Started {
    program: WebGLProgram;
    shaders: WebGLShader[];
    checked: boolean;
}

const started = new WeakMap<WebGL2RenderingContext, Map<ProgramName, Started>>();

function start(gl: WebGL2RenderingContext, name: ProgramName): Started {
    let programs = started.get(gl);
    if (!programs) started.set(gl, programs = new Map());
    let entry = programs.get(name);
    if (!entry) {
        const program = gl.createProgram()!;
        const shaders = ([[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, SOURCES[name]]] as const).map(([type, source]) => {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
            return shader;
        });
        gl.linkProgram(program);
        programs.set(name, entry = { program, shaders, checked: false });
    }
    return entry;
}

function programOf(gl: WebGL2RenderingContext, name: ProgramName): WebGLProgram {
    const entry = start(gl, name);
    if (!entry.checked) {
        if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
            const log = entry.shaders.map((shader) => gl.getShaderInfoLog(shader)).join('\n') + gl.getProgramInfoLog(entry.program);
            started.get(gl)!.delete(name);
            throw new Error(`the bake program "${name}" did not build: ${log}`);
        }
        for (const shader of entry.shaders) gl.deleteShader(shader);
        entry.checked = true;
    }
    return entry.program;
}

export function warmBakePrograms(gl: WebGL2RenderingContext): void {
    gl.getExtension('KHR_parallel_shader_compile');
    for (const name of Object.keys(SOURCES) as ProgramName[]) start(gl, name);
}

interface PaintLayer {
    chosen: WebGLTexture;
    relief: number;
    set(gl: WebGL2RenderingContext, at: (name: string) => WebGLUniformLocation | null): void;
}

function escapes(links: Int32Array): { escape: Int32Array; count: number } {
    const escape = new Int32Array(links.length / 2);
    const stack: [number, number][] = [[0, -1]];
    let last = 0;
    while (stack.length) {
        const [node, next] = stack.pop()!;
        escape[node] = next;
        if (node > last) last = node;
        if (links[node * 2 + 1] === 0) stack.push([links[node * 2]!, next], [node + 1, links[node * 2]!]);
    }
    const count = last + 1;
    for (let node = 0; node < count; node++) if (escape[node]! < 0) escape[node] = count;
    return { escape, count };
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class GpuProbes {
    private readonly textures: WebGLTexture[] = [];
    private readonly target: WebGLFramebuffer;
    private readonly vertices: WebGLVertexArrayObject;
    private readonly nodes: WebGLTexture;
    private readonly slots: WebGLTexture;
    private readonly byCorner: WebGLTexture;
    private readonly byNormal: WebGLTexture;
    private readonly nodeCount: number;

    static supported(gl: WebGL2RenderingContext): boolean {
        return gl.getExtension('EXT_color_buffer_float') !== null;
    }

    constructor(private readonly gl: WebGL2RenderingContext, tree: TriangleTree, corners: Float64Array, normals: Float64Array) {
        if (!GpuProbes.supported(gl)) throw new Error('this graphics device cannot draw into a float texture, which a bake on it needs');
        const { order, boxes, links } = tree.parts();
        const { escape, count: nodeTotal } = escapes(links);
        this.nodeCount = nodeTotal;
        const count = corners.length / 9;
        const nodeCount = links.length / 2;
        const nodeData = new Float32Array(nodeCount * 8);
        for (let node = 0; node < nodeCount; node++) {
            for (let k = 0; k < 3; k++) { nodeData[node * 8 + k] = boxes[node * 6 + k]!; nodeData[node * 8 + 4 + k] = boxes[node * 6 + 3 + k]!; }
            nodeData[node * 8 + 3] = links[node * 2 + 1] === 0 ? escape[node]! : links[node * 2]!;
            nodeData[node * 8 + 7] = links[node * 2 + 1]!;
        }
        const slotData = new Float32Array(count * 12), cornerData = new Float32Array(count * 12), normalData = new Float32Array(count * 12);
        for (let slot = 0; slot < count; slot++) {
            const t = order[slot]!;
            for (let c = 0; c < 3; c++) {
                for (let k = 0; k < 3; k++) {
                    slotData[slot * 12 + c * 4 + k] = corners[t * 9 + c * 3 + k]!;
                    cornerData[slot * 12 + c * 4 + k] = corners[slot * 9 + c * 3 + k]!;
                    normalData[slot * 12 + c * 4 + k] = normals[slot * 9 + c * 3 + k]!;
                }
            }
            slotData[slot * 12 + 3] = t;
        }
        this.nodes = this.data(nodeData);
        this.slots = this.data(slotData);
        this.byCorner = this.data(cornerData);
        this.byNormal = this.data(normalData);
        this.target = gl.createFramebuffer()!;
        this.vertices = gl.createVertexArray()!;
    }

    private texture(width: number, height: number, internal: number, format: number, pixels: Float32Array | null): WebGLTexture {
        const { gl } = this;
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.FLOAT, pixels);
        for (const side of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, side, gl.NEAREST);
        for (const side of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, side, gl.CLAMP_TO_EDGE);
        this.textures.push(texture);
        return texture;
    }

    private data(rgba: Float32Array, width = DATA_WIDTH): WebGLTexture {
        const height = Math.max(1, Math.ceil(rgba.length / 4 / width));
        const padded = rgba.length === width * height * 4 ? rgba : new Float32Array(width * height * 4);
        if (padded !== rgba) padded.set(rgba);
        return this.texture(width, height, this.gl.RGBA32F, this.gl.RGBA, padded);
    }

    private release(texture: WebGLTexture): void {
        this.gl.deleteTexture(texture);
        this.textures.splice(this.textures.indexOf(texture), 1);
    }

    private bytes(width: number, height: number, internal: number, format: number, pixels: Uint8Array): WebGLTexture {
        const { gl } = this;
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.UNSIGNED_BYTE, pixels);
        for (const side of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, side, gl.NEAREST);
        for (const side of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, side, gl.CLAMP_TO_EDGE);
        this.textures.push(texture);
        return texture;
    }

    private refill(texture: WebGLTexture, width: number, height: number, format: number, type: number, pixels: ArrayBufferView): void {
        const { gl } = this;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, type, pixels);
    }

    private layers(work: StainWork, triangles: number): { layers: PaintLayer[]; line: WebGLTexture } {
        const { gl } = this;
        const height = Math.max(1, Math.ceil(triangles / DATA_WIDTH));
        const points: number[] = [];
        const masks = new Map<Uint8Array, WebGLTexture>();
        const layers = work.stains.map((p: StainParams, index): PaintLayer => {
            checkStain(p);
            const faces = work.chosen[index]!;
            let chosen = masks.get(faces);
            if (!chosen) {
                const mask = new Uint8Array(DATA_WIDTH * height);
                for (let t = 0; t < triangles; t++) mask[t] = faces[work.faceOf[t]!] ? 255 : 0;
                chosen = this.bytes(DATA_WIDTH, height, gl.R8, gl.RED, mask);
                masks.set(faces, chosen);
            }
            const view = p.line?.from ? viewOf(p.line.from) : null;
            const lineStart = points.length / 4;
            let lineCount = 0;
            if (p.line) {
                for (const point of drawnLine(p.line.points, p.line.curve)) {
                    const [x, y, z] = view ? [point[0]!, point[1]!, 0] : mirroredPoint(p.mirror, [point[0]!, point[1]!, point[2] ?? 0]);
                    points.push(x, y, z, 0);
                    lineCount++;
                }
            }
            const near = p.near ? mirroredPoint(p.mirror, p.near.at) : null;
            const facing = p.facing ? normalize(p.facing) : null;
            const stretch = p.stretch ?? [1, 1, 1];
            const scale = p.scale ?? 1;
            const along: Vec3 = [0, -1, 0], across1: Vec3 = [1, 0, 0], across2: Vec3 = [0, 0, 1];
            const pattern = p.pattern ? DISPLACE_PATTERNS.indexOf(p.pattern) : -1;
            const width = p.width ?? (p.pattern === 'cracks' ? 0.08 : p.pattern === 'pores' ? 0.25 : 0.12);
            const axis = { x: 0, y: 1, z: 2 } as const;
            return {
                chosen,
                relief: work.reliefOf[index]!,
                set: (g, at) => {
                    g.uniform1i(at('uMirror'), p.mirror ? axis[p.mirror] : -1);
                    g.uniform4f(at('uNear'), near?.[0] ?? 0, near?.[1] ?? 0, near?.[2] ?? 0, p.near?.radius ?? 0);
                    g.uniform1i(at('uHard'), p.hard ? 1 : 0);
                    g.uniform1i(at('uLineStart'), lineStart);
                    g.uniform1i(at('uLineCount'), lineCount);
                    g.uniform1f(at('uLineWidth'), p.line?.width ?? 1);
                    g.uniform4i(at('uView'), view?.u ?? 0, view?.v ?? 1, view?.axis ?? -1, view?.sign ?? 1);
                    g.uniform4f(at('uFacing'), facing?.[0] ?? 0, facing?.[1] ?? 0, facing?.[2] ?? 0, facing ? 1 : 0);
                    g.uniform1i(at('uPattern'), pattern);
                    g.uniform1i(at('uSeed'), p.seed ?? 1);
                    g.uniform1i(at('uOctaves'), p.octaves ?? 3);
                    g.uniform3f(at('uScale'), scale * stretch[0], scale * stretch[1], scale * stretch[2]);
                    g.uniform1f(at('uWarp'), p.warp ?? 0);
                    g.uniform1f(at('uWidth'), width);
                    g.uniform1i(at('uAxis'), p.axis ? axis[p.axis] : 1);
                    g.uniform1f(at('uCount'), 24);
                    g.uniform3f(at('uAlong'), ...along);
                    g.uniform3f(at('uAcross1'), ...across1);
                    g.uniform3f(at('uAcross2'), ...across2);
                    g.uniform1f(at('uLong'), 4);
                    g.uniform1f(at('uThreshold'), p.threshold ?? 0.5);
                    g.uniform1f(at('uSoftness'), p.softness ?? 0.15);
                    g.uniform1i(at('uWhere'), p.where === 'cavity' ? 1 : p.where === 'edges' ? 2 : 0);
                    g.uniform1f(at('uFray'), p.fray ?? -1);
                    g.uniform1f(at('uAmount'), p.amount ?? 1);
                    g.uniform4f(at('uColor'), p.color?.[0] ?? 0, p.color?.[1] ?? 0, p.color?.[2] ?? 0, p.color ? 1 : 0);
                    g.uniform4f(at('uSet'), p.alpha ?? -1, p.roughness ?? -1, p.metallic ?? -1, p.glow ?? -1);
                },
            };
        });
        return { layers, line: this.data(Float32Array.from(points.length ? points : [0, 0, 0, 0])) };
    }

    async paint(work: StainWork, probes: BakeProbes, size: number, triangle: Int32Array, place: Float32Array, tick?: ProbeTick): Promise<void> {
        const { gl } = this;
        const { slots, colorRgba, surfaceRgba, glow, fallback } = work;
        const program = programOf(gl, 'paint');
        const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
        const tile = Math.min(size, PAINT_TILE);
        const { layers, line } = this.layers(work, probes.corners.length / 9);
        const reliefs = probes.reliefs.map((relief) => {
            const full = new Float32Array(size * size);
            for (let slot = 0; slot < slots.length; slot++) {
                const value = relief.values[slot]!;
                full[slots[slot]!] = Number.isNaN(value) ? 0 : value;
            }
            return { full, texture: this.texture(tile, tile, gl.R32F, gl.RED, null) };
        });
        const flat = this.texture(1, 1, gl.R32F, gl.RED, new Float32Array(1));
        const hitData = new Float32Array(tile * tile * 4), reliefData = new Float32Array(tile * tile);
        const colorData = new Uint8Array(tile * tile * 4), miscData = new Uint8Array(tile * tile * 4);
        const hitTexture = this.texture(tile, tile, gl.RGBA32F, gl.RGBA, null);
        const baseColor = this.bytes(tile, tile, gl.RGBA8, gl.RGBA, colorData), baseMisc = this.bytes(tile, tile, gl.RGBA8, gl.RGBA, miscData);
        const states = [0, 1].map(() => ({ color: this.half(tile), misc: this.half(tile), target: gl.createFramebuffer()! }));
        for (const state of states) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, state.target);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.color, 0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, state.misc, 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        }
        const outColor = new Float32Array(tile * tile * 4), outMisc = new Float32Array(tile * tile * 4);
        const byte = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
        const tiles = (size / tile) ** 2;
        let done = 0;
        for (let top = 0; top < size; top += tile) {
            for (let left = 0; left < size; left += tile) {
                for (let y = 0; y < tile; y++) {
                    for (let x = 0; x < tile; x++) {
                        const texel = (top + y) * size + left + x, i = y * tile + x;
                        hitData[i * 4] = triangle[texel]!;
                        hitData[i * 4 + 1] = place[texel * 2]!;
                        hitData[i * 4 + 2] = place[texel * 2 + 1]!;
                        for (let k = 0; k < 4; k++) colorData[i * 4 + k] = colorRgba ? colorRgba[texel * 4 + k]! : 0;
                        miscData[i * 4] = surfaceRgba ? surfaceRgba[texel * 4 + 1]! : byte(fallback.roughness);
                        miscData[i * 4 + 1] = surfaceRgba ? surfaceRgba[texel * 4 + 2]! : byte(fallback.metallic);
                        miscData[i * 4 + 2] = glow ? glow[texel]! : 0;
                    }
                }
                this.refill(hitTexture, tile, tile, gl.RGBA, gl.FLOAT, hitData);
                this.refill(baseColor, tile, tile, gl.RGBA, gl.UNSIGNED_BYTE, colorData);
                this.refill(baseMisc, tile, tile, gl.RGBA, gl.UNSIGNED_BYTE, miscData);
                for (const relief of reliefs) {
                    for (let y = 0; y < tile; y++) reliefData.set(relief.full.subarray((top + y) * size + left, (top + y) * size + left + tile), y * tile);
                    this.refill(relief.texture, tile, tile, gl.RED, gl.FLOAT, reliefData);
                }
                gl.useProgram(program);
                gl.bindVertexArray(this.vertices);
                gl.viewport(0, 0, tile, tile);
                gl.disable(gl.BLEND);
                gl.disable(gl.DEPTH_TEST);
                gl.disable(gl.SCISSOR_TEST);
                let from: { color: WebGLTexture; misc: WebGLTexture } = { color: baseColor, misc: baseMisc };
                layers.forEach((layer, index) => {
                    const to = states[index % 2]!;
                    gl.bindFramebuffer(gl.FRAMEBUFFER, to.target);
                    Object.entries({
                        uCorners: this.byCorner, uNormals: this.byNormal, uHit: hitTexture, uPrevColor: from.color, uPrevMisc: from.misc,
                        uChosen: layer.chosen, uRelief: layer.relief >= 0 ? reliefs[layer.relief]!.texture : flat, uLine: line,
                    }).forEach(([name, texture], unit) => {
                        gl.activeTexture(gl.TEXTURE0 + unit);
                        gl.bindTexture(gl.TEXTURE_2D, texture);
                        gl.uniform1i(at(name), unit);
                    });
                    layer.set(gl, at);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    from = to;
                });
                if (layers.length > 0) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, states[(layers.length - 1) % 2]!.target);
                    gl.readBuffer(gl.COLOR_ATTACHMENT0);
                    gl.readPixels(0, 0, tile, tile, gl.RGBA, gl.FLOAT, outColor);
                    gl.readBuffer(gl.COLOR_ATTACHMENT1);
                    gl.readPixels(0, 0, tile, tile, gl.RGBA, gl.FLOAT, outMisc);
                    gl.readBuffer(gl.COLOR_ATTACHMENT0);
                    if (gl.isContextLost()) throw new Error('the graphics device was lost during a bake');
                    for (let y = 0; y < tile; y++) {
                        for (let x = 0; x < tile; x++) {
                            const texel = (top + y) * size + left + x, i = y * tile + x;
                            if (triangle[texel]! < 0) continue;
                            if (colorRgba) for (let k = 0; k < 4; k++) colorRgba[texel * 4 + k] = byte(outColor[i * 4 + k]!);
                            if (surfaceRgba) { surfaceRgba[texel * 4 + 1] = byte(outMisc[i * 4]!); surfaceRgba[texel * 4 + 2] = byte(outMisc[i * 4 + 1]!); }
                            if (glow) glow[texel] = byte(outMisc[i * 4 + 2]!);
                        }
                    }
                }
                tick?.(++done, tiles);
                await pause();
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const state of states) gl.deleteFramebuffer(state.target);
        work.painted = true;
    }

    private half(size: number): WebGLTexture {
        const { gl } = this;
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, size, size);
        for (const side of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, side, gl.NEAREST);
        this.textures.push(texture);
        return texture;
    }

    private async draw(
        program: WebGLProgram, width: number, height: number, inputs: Record<string, WebGLTexture>,
        uniforms: (gl: WebGL2RenderingContext, at: (name: string) => WebGLUniformLocation | null) => void,
        take: (row: number, rows: number, pixels: Float32Array) => void, tick?: ProbeTick,
    ): Promise<void> {
        const { gl } = this;
        const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
        let rows = Math.max(1, Math.min(height, Math.floor(65536 / width)));
        let canvas: WebGLTexture | null = null, canvasRows = 0;
        let pixels = new Float32Array(0);
        for (let row = 0; row < height;) {
            const now = Math.min(rows, height - row);
            if (!canvas || canvasRows !== now) {
                if (canvas) this.release(canvas);
                canvas = this.texture(width, now, gl.RGBA32F, gl.RGBA, null);
                canvasRows = now;
                pixels = new Float32Array(width * now * 4);
            }
            gl.useProgram(program);
            gl.bindVertexArray(this.vertices);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, canvas, 0);
            gl.viewport(0, 0, width, now);
            gl.disable(gl.BLEND);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.SCISSOR_TEST);
            Object.entries({ uNodes: this.nodes, uSlots: this.slots, uCorners: this.byCorner, uNormals: this.byNormal, ...inputs }).forEach(([name, texture], unit) => {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.uniform1i(at(name), unit);
            });
            gl.uniform2i(at('uOrigin'), 0, row);
            gl.uniform1i(at('uNodeCount'), this.nodeCount);
            uniforms(gl, at);
            const began = performance.now();
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.readPixels(0, 0, width, now, gl.RGBA, gl.FLOAT, pixels);
            const took = performance.now() - began;
            if (gl.isContextLost()) throw new Error('the graphics device was lost during a bake');
            take(row, now, pixels);
            row += now;
            tick?.(row, height);
            if (took < BAND_LOW_MS) rows = Math.min(height, rows * 2);
            else if (took > BAND_HIGH_MS) rows = Math.max(1, rows >> 1);
            await pause();
        }
        if (canvas) this.release(canvas);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    async hits(work: ShadeWork, triangle: Int32Array, place: Float32Array, tick?: ProbeTick): Promise<void> {
        const { gl } = this;
        const { size, indices, P, N, UV, cover } = work;
        const light = new Float32Array(indices.length * 8);
        for (let i = 0; i < indices.length; i++) {
            const v = indices[i]!;
            light.set([P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!, UV[v * 2]!, N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!, UV[v * 2 + 1]!], i * 8);
        }
        const lightTexture = this.data(light);
        const coverTexture = this.texture(size, size, gl.R32F, gl.RED, Float32Array.from(cover));
        await this.draw(programOf(gl, 'hits'), size, size, { uCover: coverTexture, uLight: lightTexture }, (g, at) => {
            g.uniform1f(at('uSize'), size);
            g.uniform1f(at('uDistance'), work.distance);
        }, (row, rows, pixels) => {
            for (let i = 0, texel = row * size; i < rows * size; i++, texel++) {
                triangle[texel] = pixels[i * 4]!;
                place[texel * 2] = pixels[i * 4 + 1]!;
                place[texel * 2 + 1] = pixels[i * 4 + 2]!;
            }
        }, tick);
        this.release(lightTexture);
        this.release(coverTexture);
    }

    private items(count: number, fill: (i: number, out: Float32Array, at: number) => void): { texture: WebGLTexture; height: number } {
        const height = Math.max(1, Math.ceil(count / ITEM_WIDTH));
        const data = new Float32Array(ITEM_WIDTH * height * 4).fill(-1);
        for (let i = 0; i < count; i++) fill(i, data, i * 4);
        return { texture: this.texture(ITEM_WIDTH, height, this.gl.RGBA32F, this.gl.RGBA, data), height };
    }

    private async reliefOf(probes: BakeProbes, index: number, list: Int32Array, tick?: ProbeTick): Promise<void> {
        if (list.length === 0) return;
        const { triangles, places } = probes;
        const { reach, values } = probes.reliefs[index]!;
        const { texture, height } = this.items(list.length, (i, out, at) => {
            const slot = list[i]!;
            out[at] = triangles[slot]!; out[at + 1] = places[slot * 2]!; out[at + 2] = places[slot * 2 + 1]!; out[at + 3] = 0;
        });
        await this.draw(programOf(this.gl, 'relief'), ITEM_WIDTH, height, { uItems: texture }, (g, at) => g.uniform1f(at('uReach'), reach), (row, rows, pixels) => {
            const end = Math.min(list.length, (row + rows) * ITEM_WIDTH);
            for (let i = row * ITEM_WIDTH; i < end; i++) values[list[i]!] = pixels[(i - row * ITEM_WIDTH) * 4]!;
        }, tick);
        this.release(texture);
    }

    relief(probes: BakeProbes, index: number, tick?: ProbeTick): Promise<void> {
        return this.reliefOf(probes, index, probes.reliefs[index]!.todo, tick);
    }

    async occlusion(probes: BakeProbes, tick?: ProbeTick): Promise<void> {
        const probe = probes.occlusion;
        if (!probe || probe.todo.length === 0) return;
        const { todo, triangles, places, texels, values } = probe;
        const { texture, height } = this.items(todo.length, (i, out, at) => {
            const item = todo[i]!;
            out[at] = triangles[item]!; out[at + 1] = places[item * 2]!; out[at + 2] = places[item * 2 + 1]!; out[at + 3] = texels[item]!;
        });
        await this.draw(programOf(this.gl, 'occlusion'), ITEM_WIDTH, height, { uItems: texture }, (g, at) => {
            g.uniform1f(at('uReach'), probe.reach);
            g.uniform1f(at('uBias'), probe.bias);
            g.uniform1i(at('uSide'), Math.ceil(Math.sqrt(probe.samples)));
        }, (row, rows, pixels) => {
            const end = Math.min(todo.length, (row + rows) * ITEM_WIDTH);
            for (let i = row * ITEM_WIDTH; i < end; i++) values[todo[i]!] = pixels[(i - row * ITEM_WIDTH) * 4]!;
        }, tick);
        this.release(texture);
    }

    dispose(): void {
        const { gl } = this;
        for (const texture of this.textures) gl.deleteTexture(texture);
        this.textures.length = 0;
        gl.deleteFramebuffer(this.target);
        gl.deleteVertexArray(this.vertices);
    }
}

export async function gpuNormalBake(gl: WebGL2RenderingContext, model: BakedModel, tick?: (stage: 'surface' | 'relief' | 'occlusion' | 'paint' | 'finish', done: number, total: number) => void): Promise<NormalMap> {
    const start = startNormalBake(model);
    const { shading } = start;
    const texels = shading.size * shading.size;
    warmBakePrograms(gl);
    const gpu = new GpuProbes(gl, start.tree, shading.corners, shading.normals);
    try {
        const triangle = shading.hitTriangle ?? new Int32Array(texels);
        const place = shading.hitPlace ?? new Float32Array(texels * 2);
        await gpu.hits(shading, triangle, place, (done, total) => tick?.('surface', done, total));
        shadeTexels(shading, start.tree, 0, shading.stats.length / 3, { triangle, place });
        const plan = start.plan();
        for (let index = 0; index < plan.probes.reliefs.length; index++) await gpu.relief(plan.probes, index, (done, total) => tick?.('relief', done, total));
        await gpu.occlusion(plan.probes, (done, total) => tick?.('occlusion', done, total));
        if (plan.stains) await gpu.paint(plan.stains, plan.probes, shading.size, triangle, place, (done, total) => tick?.('paint', done, total));
        tick?.('finish', 0, 1);
        const map = plan.finish();
        tick?.('finish', 1, 1);
        return map;
    } finally {
        gpu.dispose();
    }
}
