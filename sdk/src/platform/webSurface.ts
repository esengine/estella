// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
function layoutPixels(value: string | undefined): number | undefined {
    if (!value?.endsWith('px')) return undefined;
    const pixels = Number(value.slice(0, -2));
    return Number.isFinite(pixels) ? pixels : undefined;
}

/** Convert viewport coordinates to the same layout pixels as a surface's DOM offsets. */
export function surfacePointerFrame(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    // Canvas dimensions and borders can have a fractional layout size. Read the
    // locally resolved CSS sizes before comparing with the transformed rect.
    const style = el.localName === 'canvas' ? el.ownerDocument.defaultView?.getComputedStyle(el) : undefined;
    const leftBorder = layoutPixels(style?.borderLeftWidth) ?? el.clientLeft;
    const topBorder = layoutPixels(style?.borderTopWidth) ?? el.clientTop;
    const width = layoutPixels(style?.width), height = layoutPixels(style?.height);
    const extraX = style && style.boxSizing !== 'border-box'
        ? leftBorder + (layoutPixels(style.borderRightWidth) ?? 0)
        + (layoutPixels(style.paddingLeft) ?? 0) + (layoutPixels(style.paddingRight) ?? 0)
        : 0;
    const extraY = style && style.boxSizing !== 'border-box'
        ? topBorder + (layoutPixels(style.borderBottomWidth) ?? 0)
        + (layoutPixels(style.paddingTop) ?? 0) + (layoutPixels(style.paddingBottom) ?? 0)
        : 0;
    const layoutW = width !== undefined ? width + extraX : el.offsetWidth;
    const layoutH = height !== undefined ? height + extraY : el.offsetHeight;
    // Axis-aligned CSS scaling changes the client rect but not the layout dimensions.
    const scaleX = layoutW > 0 && rect.width > 0 ? layoutW / rect.width : 1;
    const scaleY = layoutH > 0 && rect.height > 0 ? layoutH / rect.height : 1;
    return {
        left: rect.left + leftBorder / scaleX,
        top: rect.top + topBorder / scaleY,
        scaleX, scaleY,
    };
}
