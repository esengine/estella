// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetFieldType } from '../scene/scene';

/** Scene fields backed by a numeric handle in the current World. Other asset fields hold references. */
export const SCENE_HANDLE_TYPES = ['texture', 'material', 'font', 'mesh', 'environment', 'probeVolume'] as const satisfies readonly AssetFieldType[];
export type SceneHandleType = typeof SCENE_HANDLE_TYPES[number];

export function isSceneHandleType(type: string): type is SceneHandleType {
    return (SCENE_HANDLE_TYPES as readonly string[]).includes(type);
}

/** Untyped legacy slots use the original numeric empty value. */
export function emptySceneAssetValue(type: string | undefined): 0 | '' {
    return type === undefined || isSceneHandleType(type) ? 0 : '';
}
