// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/core/dimension.ts
 * @brief   Dimension — a CSS-style length (value + unit) for the runtime UI box
 *          model (REARCH_GUI F2, see docs/REARCH_GUI.md).
 *
 * One field can be pixels, a percentage of the parent, or content-driven (auto),
 * replacing the old size/offset/`-1`-sentinel scheme. The on-wire shape matches
 * the C++ `Dimension` struct serialized by the EHT codegen (`{ value, unit }`,
 * `unit` an integer); these helpers give it a typed, ergonomic authoring API.
 */

/** How a {@link Dimension}'s `value` is interpreted. Mirrors the C++ u8 unit. */
export const DimensionUnit = {
    /** Absolute pixels. */
    Px: 0,
    /** Percentage of the parent's corresponding axis (0..100). */
    Percent: 1,
    /** Content-/layout-driven; `value` is ignored. */
    Auto: 2,
} as const;
export type DimensionUnit = (typeof DimensionUnit)[keyof typeof DimensionUnit];

/** A CSS-style length. Matches the generated `Dimension` interface (`{ value, unit }`). */
export interface Dimension {
    value: number;
    unit: number;
}

/** `n` pixels. */
export const px = (n: number): Dimension => ({ value: n, unit: DimensionUnit.Px });

/** `n` percent of the parent axis (0..100). */
export const percent = (n: number): Dimension => ({ value: n, unit: DimensionUnit.Percent });

/** Content-/layout-driven length (Yoga `auto`). */
export const auto = (): Dimension => ({ value: 0, unit: DimensionUnit.Auto });

/** True when the dimension is the content-/layout-driven `auto` length. */
export const isAuto = (d: Dimension): boolean => d.unit === DimensionUnit.Auto;
