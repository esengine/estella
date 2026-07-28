// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineBuiltin } from '../../ecs/component';

export const MaskMode = {
    Scissor: 0,
    Stencil: 1,
} as const;
export type MaskMode = (typeof MaskMode)[keyof typeof MaskMode];

export interface UIMaskData {
    enabled: boolean;
    mode: MaskMode;
    /** Stencil mode only: above 0, clip to the SHAPE the mask sprite draws
     *  instead of to its box (0, the default, keeps the box). */
    alphaCutoff: number;
}

export const UIMask = defineBuiltin<UIMaskData>('UIMask', {
    enabled: true,
    mode: MaskMode.Scissor,
    alphaCutoff: 0,
});
