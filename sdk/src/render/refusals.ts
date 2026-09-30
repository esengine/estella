// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    refusals.ts
 * @brief   The engine's refusal codes as the words a reader gets.
 *
 * Indexed by the number the engine writes, in the order of its enums
 * (LightRefusal in LightPlan.hpp, the atlas refusal in ShadowPlan). The web and
 * native backends read the same codes, so they read them through one table.
 */

/** Why a light did not reach the frame. */
export const LIGHT_REFUSAL = ['none', 'capacity', 'no-environment-sun'] as const;

/** Why a shadow caster got fewer tiles than it asked for. */
export const ATLAS_REFUSAL = ['none', 'tile-budget', 'tile-too-large', 'atlas-full'] as const;
