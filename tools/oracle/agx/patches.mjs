// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  patches.mjs — the scene-linear colours AgX is compared on: a grey ramp from deep shadow to far over-range, and colours that a
 *        per-channel curve and AgX treat differently (saturated primaries, mixed and dark tones, HDR colour).
 */
export const GREYS = [0.002, 0.01, 0.03, 0.09, 0.18, 0.3, 0.5, 0.8, 1, 1.5, 2, 4, 8, 16, 32, 64].map((v) => [v, v, v]);
export const COLOURS = [
  [0.8, 0.1, 0.05], [0.05, 0.6, 0.1], [0.05, 0.1, 0.9], [0.9, 0.7, 0.1],
  [0.2, 0.3, 0.4], [0.02, 0.4, 0.35], [1.5, 0.6, 0.2], [0.5, 0.5, 0.5],
  [4, 0.5, 0.2], [0.1, 3, 0.1], [0.3, 0.3, 6], [2, 1.5, 0.3],
  [0.01, 0.02, 0.05], [1, 0.05, 0.05], [0.05, 1, 0.05], [0.05, 0.05, 1],
];
export const ALL = [...GREYS, ...COLOURS];
