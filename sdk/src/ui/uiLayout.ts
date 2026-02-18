export interface LayoutRect {
    left: number;
    bottom: number;
    right: number;
    top: number;
}

export interface LayoutResult {
    centerX: number;
    centerY: number;
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
        const cx = aLeft + offsetMin.x;
        const hw = size.x * 0.5;
        myLeft = cx - hw;
        myRight = cx + hw;
    } else {
        myLeft = aLeft + offsetMin.x;
        myRight = aRight + offsetMax.x;
    }

    if (anchorMin.y === anchorMax.y) {
        const cy = aBottom + offsetMin.y;
        const hh = size.y * 0.5;
        myBottom = cy - hh;
        myTop = cy + hh;
    } else {
        myBottom = aBottom + offsetMin.y;
        myTop = aTop + offsetMax.y;
    }

    const width = myRight - myLeft;
    const height = myTop - myBottom;
    const centerX = (myLeft + myRight) * 0.5;
    const centerY = (myBottom + myTop) * 0.5;

    return {
        centerX,
        centerY,
        width,
        height,
        rect: { left: myLeft, bottom: myBottom, right: myRight, top: myTop },
    };
}
