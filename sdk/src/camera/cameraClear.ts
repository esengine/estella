// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cameraClear.ts
 * @brief   The colour a camera clears to when it is not the canvas's.
 *
 * @details Every camera clears to the canvas's background, which is right for a picture someone sees. A camera taking a picture for
 *          the engine's own use (an impostor's) wants the empty parts of it empty, and says so here. Engine-internal: a camera with
 *          no entry clears as it always has.
 */
import type { Entity } from '../types';

type Rgba = { x: number; y: number; z: number; w: number };

const overrides = new Map<Entity, Rgba>();

/** Clear @p camera to @p colour instead of the canvas's background; null puts it back. @internal */
export function setCameraClearColor(camera: Entity, colour: Rgba | null): void {
    if (colour) overrides.set(camera, colour);
    else overrides.delete(camera);
}

/** The colour @p camera clears to if it has its own, else @p fallback. @internal */
export function cameraClearColor(camera: Entity, fallback: Rgba | undefined): Rgba | undefined {
    return overrides.get(camera) ?? fallback;
}
