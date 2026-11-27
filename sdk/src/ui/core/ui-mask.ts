// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineBuiltin } from '../../ecs/component';
import type { Vec2 } from '../../types';

// Scissor clips to an axis-aligned rectangle and costs nothing; Stencil clips to
// the mask's own shape. Single-sourced from the C++ ES_ENUM via the generated
// module, so the number this writes is the number the renderer reads.
export { MaskMode } from '../../wasm/wasm.generated';
import { MaskMode } from '../../wasm/wasm.generated';

export interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
    /** Stencil mode only: above 0, clip to the SHAPE the mask sprite draws
     *  instead of to its box (0, the default, keeps the box). */
    alphaCutoff: number;
    /** Scissor mode only: how far in from its edges, in UI pixels, what the mask holds fades in instead of being cut (x left and
     *  right, y bottom and top). Zero, the default, is the hard edge. Sprites, UI visuals and text fade, a material's own shader too. */
    softness?: Vec2;
}

export const UIMask = defineBuiltin<UIMaskData>('UIMask', {
    enabled: true,
    mode: MaskMode.Scissor,
    alphaCutoff: 0,
    softness: { x: 0, y: 0 },
});
