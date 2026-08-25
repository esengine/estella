// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probe.ts
 * @brief   The arguments where libm and ECMAScript disagree about Math.
 *
 * @details Ties, and the sign of zero, plus ordinary values so the shims are not
 *          only exercised at their edges. Shared because two differentials use
 *          it and they have to use the SAME one: conformance.test.ts settles
 *          what the right answer is (node against the interpreter), and
 *          codegen.test.ts settles that a real C compiler produces it.
 */
export const PROBE: readonly number[] = [
    -2.5, 2.5, -0.5, 0.5, 0.49999999999999994, -0.49999999999999994,
    -0.2, 0.2, 0, -0, 1.5, -1.5, 3.5, -3.5, -1, 1,
    100.5, -100.5, 1e-7, -1e-7, 7, -7, 2.675, -2.675,
];

/** A probe row as both worlds hold it; every output starts at zero. */
export function probeRow(v: number): Record<string, number> {
    return { v, rounded: 0, truncated: 0, ceiled: 0, floored: 0, signum: 0, lo: 0, hi: 0 };
}
