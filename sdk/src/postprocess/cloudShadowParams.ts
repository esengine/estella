// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cloudShadowParams.ts
 * @brief   The params by which a sky draws the sun's cloud shadow map, as Unreal's atmosphere sun reads its clouds' shadow.
 *
 * @details A sky that declares them is asked by the engine, before the scene, for what of the sun is left under its clouds across a
 *          square round the camera (`u_cloudShadowPass` 1, where the square's tile lies in the target, and the matrix from the square
 *          back to the world); the sun's light is then
 *          dimmed by it where each surface is shaded. The sky's own light and a surface's emission are not, as they are not under a
 *          real cloud. `u_castCloudShadows` says the sky casts any; `u_cloudShadowExtentKm` how far the square reaches each way.
 */
export const CLOUD_SHADOW_PARAMS: readonly string[] = [
    '#pragma param u_castCloudShadows float default(1) range(0,1)',
    '#pragma param u_cloudShadowExtentKm float default(16) range(1,200)',
    '#pragma param u_cloudShadowPass float default(0) range(0,1)',
    '#pragma param u_cloudShadowRect color default(0,0,1,1)',
    '#pragma param u_cloudShadowInv0 color default(1,0,0,0)',
    '#pragma param u_cloudShadowInv1 color default(0,1,0,0)',
    '#pragma param u_cloudShadowInv2 color default(0,0,1,0)',
    '#pragma param u_cloudShadowInv3 color default(0,0,0,1)',
];
