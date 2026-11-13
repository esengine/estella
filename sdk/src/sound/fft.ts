// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  fft.ts — the fast Fourier transform a sound's rooms and its picture are worked out with.
 */
/** In place: the transform of @p re + i @p im, their length a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const r = re[i]!; re[i] = re[j]!; re[j] = r; const m = im[i]!; im[i] = im[j]!; im[j] = m; }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const angle = (-2 * Math.PI) / size;
        const wr = Math.cos(angle), wi = Math.sin(angle), half = size >> 1;
        // Plain locals throughout: this loop is all the time a long convolution takes.
        for (let start = 0; start < n; start += size) {
            let cr = 1, ci = 0;
            for (let k = 0; k < half; k++) {
                const a = start + k, b = a + half;
                const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
                re[b] = re[a]! - tr; im[b] = im[a]! - ti;
                re[a] = re[a]! + tr; im[a] = im[a]! + ti;
                const next = cr * wr - ci * wi;
                ci = cr * wi + ci * wr; cr = next;
            }
        }
    }
}
