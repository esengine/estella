// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export interface BitmapFontDocument {
    type?: unknown;
    fntFile?: unknown;
    generatedFnt?: unknown;
}

/** The metrics slot a .bmfont wrapper actually loads. */
export function bitmapFontMetricsField(document: BitmapFontDocument | null): 'generatedFnt' | 'fntFile' {
    return document?.type === 'label-atlas' ? 'generatedFnt' : 'fntFile';
}
