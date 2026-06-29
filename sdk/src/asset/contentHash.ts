// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Content hashing for asset identity (content-addressed identity).
 *
 * XXH64 — a fast, well-distributed 64-bit non-cryptographic hash — is the single
 * canonical definition backing {@link AddressableManifest}'s `contentHash` field.
 * The hash is an asset's *physical* identity: computed at build time over the
 * built bytes, it lets the pipeline dedupe identical content and treat
 * `<contentHash>.<ext>` as an immutable, permanently-cacheable URL — change a byte
 * → new hash → new URL, never a stale cache.
 *
 * Pure and dependency-free (BigInt, no Node/DOM APIs) so the build-time cook and
 * the runtime (e.g. integrity re-check of a CDN download) share ONE implementation
 * — no hand-mirrored second copy to drift. BigInt keeps the 64-bit arithmetic
 * exact and deterministic across engines; build-time hashing is not hot enough for
 * the 32-bit-emulation complexity to earn its risk. Output is canonical XXH64,
 * anchored on the official `XXH64("") == 0xEF46DB3751D8E999` vector, so external
 * `xxhsum`-family tooling can verify our artifacts.
 */

const MASK = (1n << 64n) - 1n;

// Canonical XXH64 primes.
const PRIME1 = 0x9e3779b185ebca87n;
const PRIME2 = 0xc2b2ae3d27d4eb4fn;
const PRIME3 = 0x165667b19e3779f9n;
const PRIME4 = 0x85ebca77c2b2ae63n;
const PRIME5 = 0x27d4eb2f165667c5n;

function rotl(x: bigint, r: bigint): bigint {
    return ((x << r) | (x >> (64n - r))) & MASK;
}

function round(acc: bigint, input: bigint): bigint {
    acc = (acc + input * PRIME2) & MASK;
    acc = rotl(acc, 31n);
    return (acc * PRIME1) & MASK;
}

function mergeRound(acc: bigint, val: bigint): bigint {
    const r = round(0n, val);
    acc = (acc ^ r) & MASK;
    return (acc * PRIME1 + PRIME4) & MASK;
}

/** Unsigned 32-bit little-endian read. `>>> 0` defeats JS's signed bit-ops. */
function readU32LE(b: Uint8Array, p: number): bigint {
    return BigInt(((b[p]) | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0);
}

/** Unsigned 64-bit little-endian read, composed from two 32-bit halves. */
function readU64LE(b: Uint8Array, p: number): bigint {
    return (readU32LE(b, p + 4) << 32n) | readU32LE(b, p);
}

/**
 * Canonical XXH64 of `data` as an exact unsigned 64-bit {@link bigint}.
 * Deterministic across engines; `seed` defaults to 0 (the manifest convention).
 */
export function xxh64(data: Uint8Array, seed: bigint = 0n): bigint {
    const len = data.length;
    let p = 0;
    let h: bigint;

    if (len >= 32) {
        let v1 = (seed + PRIME1 + PRIME2) & MASK;
        let v2 = (seed + PRIME2) & MASK;
        let v3 = seed & MASK;
        let v4 = (seed - PRIME1) & MASK;
        const limit = len - 32;
        do {
            v1 = round(v1, readU64LE(data, p)); p += 8;
            v2 = round(v2, readU64LE(data, p)); p += 8;
            v3 = round(v3, readU64LE(data, p)); p += 8;
            v4 = round(v4, readU64LE(data, p)); p += 8;
        } while (p <= limit);

        h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK;
        h = mergeRound(h, v1);
        h = mergeRound(h, v2);
        h = mergeRound(h, v3);
        h = mergeRound(h, v4);
    } else {
        h = (seed + PRIME5) & MASK;
    }

    h = (h + BigInt(len)) & MASK;

    // Tail: 8-byte, then 4-byte, then per-byte.
    while (p + 8 <= len) {
        h = (h ^ round(0n, readU64LE(data, p))) & MASK;
        h = (rotl(h, 27n) * PRIME1 + PRIME4) & MASK;
        p += 8;
    }
    if (p + 4 <= len) {
        h = (h ^ ((readU32LE(data, p) * PRIME1) & MASK)) & MASK;
        h = (rotl(h, 23n) * PRIME2 + PRIME3) & MASK;
        p += 4;
    }
    while (p < len) {
        h = (h ^ ((BigInt(data[p]) * PRIME5) & MASK)) & MASK;
        h = (rotl(h, 11n) * PRIME1) & MASK;
        p += 1;
    }

    // Final avalanche.
    h = (h ^ (h >> 33n)) & MASK;
    h = (h * PRIME2) & MASK;
    h = (h ^ (h >> 29n)) & MASK;
    h = (h * PRIME3) & MASK;
    h = (h ^ (h >> 32n)) & MASK;
    return h;
}

/** Lower-case, zero-padded 16-hex-digit XXH64 — the canonical `contentHash` string. */
export function contentHashHex(data: Uint8Array): string {
    return xxh64(data).toString(16).padStart(16, '0');
}

/**
 * Convenience over {@link contentHashHex} that also accepts a string (hashed as
 * UTF-8). Build-time only — `TextEncoder` is a Node/browser global.
 */
export function contentHashOf(data: Uint8Array | string): string {
    return contentHashHex(typeof data === 'string' ? new TextEncoder().encode(data) : data);
}
