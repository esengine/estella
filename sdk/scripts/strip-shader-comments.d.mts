// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type StripEdit = [start: number, end: number];
export interface StripResult {
    code: string;
    map: { version: 3; file: string; sources: string[]; sourcesContent: string[]; names: string[]; mappings: string };
}
export function shaderStripEdits(code: string, fileName?: string): StripEdit[];
export function applyStrip(code: string, edits: StripEdit[], fileName: string): StripResult;
export function stripShaderComments(): { name: string; transform(code: string, id: string): StripResult | null };
