// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { NativePlatform } from '../utils/nativeTemplate.js';

export interface TemplateVerdict {
    ok: boolean;
    problems: string[];
    platform: NativePlatform | null;
    engineVersion: string | null;
}

export function verifyTemplateZip(zipPath: string): TemplateVerdict;
export function verifyTemplates(zipPaths: string[]): void;
