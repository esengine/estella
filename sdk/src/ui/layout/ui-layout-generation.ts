// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../../resource';

export interface UILayoutGenerationData {
    generation: number;
}

export const UILayoutGeneration = defineResource<UILayoutGenerationData>({ generation: 0 }, 'UILayoutGeneration');
