// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { writePsd, type Layer } from 'ag-psd';

export function pixelLayer(name: string, red: number, id?: number): Layer {
    const imageData = { width: 1, height: 1, data: new Uint8ClampedArray([red, 0, 0, 255]) } as ImageData;
    return { name, id, imageData };
}

export function photoshopFile(children: Layer[], psb = false): Uint8Array {
    return new Uint8Array(writePsd({ width: 2, height: 2, children }, { generateThumbnail: false, psb }));
}
