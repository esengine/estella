// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ComponentData } from './types';

export function cloneComponents(components: ComponentData[]): ComponentData[] {
    return components.map(c => ({
        type: c.type,
        data: JSON.parse(JSON.stringify(c.data)),
    }));
}

export function cloneComponentData(data: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(data));
}

export function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(metadata));
}
