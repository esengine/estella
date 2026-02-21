export interface LayoutRect {
    left: number;
    bottom: number;
    right: number;
    top: number;
}

export interface LayoutResult {
    originX: number;
    originY: number;
    width: number;
    height: number;
    rect: LayoutRect;
}

export function computeUIRectLayout(
    anchorMin: { x: number; y: number },
    anchorMax: { x: number; y: number },
    offsetMin: { x: number; y: number },
    offsetMax: { x: number; y: number },
    size: { x: number; y: number },
    parentRect: LayoutRect,
    pivot: { x: number; y: number } = { x: 0.5, y: 0.5 },
): LayoutResult {
    const parentW = parentRect.right - parentRect.left;
    const parentH = parentRect.top - parentRect.bottom;

    const aLeft = parentRect.left + anchorMin.x * parentW;
    const aRight = parentRect.left + anchorMax.x * parentW;
    const aBottom = parentRect.bottom + anchorMin.y * parentH;
    const aTop = parentRect.bottom + anchorMax.y * parentH;

    let myLeft: number;
    let myBottom: number;
    let myRight: number;
    let myTop: number;

    if (anchorMin.x === anchorMax.x) {
        myLeft = aLeft + offsetMin.x - size.x * pivot.x;
        myRight = myLeft + size.x;
    } else {
        myLeft = aLeft + offsetMin.x;
        myRight = aRight + offsetMax.x;
    }

    if (anchorMin.y === anchorMax.y) {
        myBottom = aBottom + offsetMin.y - size.y * pivot.y;
        myTop = myBottom + size.y;
    } else {
        myBottom = aBottom + offsetMin.y;
        myTop = aTop + offsetMax.y;
    }

    const width = Math.max(0, myRight - myLeft);
    const height = Math.max(0, myTop - myBottom);
    const originX = myLeft + pivot.x * width;
    const originY = myBottom + pivot.y * height;

    return {
        originX,
        originY,
        width,
        height,
        rect: { left: myLeft, bottom: myBottom, right: myRight, top: myTop },
    };
}
