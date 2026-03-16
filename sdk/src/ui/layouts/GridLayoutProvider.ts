import { ScrollAlign, type LayoutProvider, type LayoutResult } from '../LayoutProvider';
import type { GridLayoutData } from './GridLayout';

export class GridLayoutProvider implements LayoutProvider {
    getContentSize(
        itemCount: number,
        viewportSize: { x: number; y: number },
        config: unknown,
    ): { width: number; height: number } {
        const c = config as GridLayoutData;
        if (itemCount === 0) return { width: 0, height: 0 };
        const isVertical = c.direction === 0;
        const cols = isVertical ? Math.min(c.crossAxisCount, itemCount) : Math.ceil(itemCount / c.crossAxisCount);
        const rows = isVertical ? Math.ceil(itemCount / c.crossAxisCount) : Math.min(c.crossAxisCount, itemCount);

        return {
            width: cols * c.itemSize.x + Math.max(0, cols - 1) * c.spacing.x,
            height: rows * c.itemSize.y + Math.max(0, rows - 1) * c.spacing.y,
        };
    }

    getVisibleRange(
        scrollOffset: { x: number; y: number },
        viewportSize: { x: number; y: number },
        itemCount: number,
        overscan: number,
        config: unknown,
    ): LayoutResult[] {
        if (itemCount === 0) return [];

        const c = config as GridLayoutData;
        const isVertical = c.direction === 0;
        const cols = c.crossAxisCount;
        const strideX = c.itemSize.x + c.spacing.x;
        const strideY = c.itemSize.y + c.spacing.y;

        if (isVertical) {
            const rowStride = strideY;
            if (rowStride <= 0) return [];
            let startRow = Math.floor(scrollOffset.y / rowStride) - overscan;
            let endRow = Math.ceil((scrollOffset.y + viewportSize.y) / rowStride) + overscan;
            const totalRows = Math.ceil(itemCount / cols);
            startRow = Math.max(0, startRow);
            endRow = Math.min(totalRows - 1, endRow);

            const results: LayoutResult[] = [];
            for (let row = startRow; row <= endRow; row++) {
                for (let col = 0; col < cols; col++) {
                    const index = row * cols + col;
                    if (index >= itemCount) break;
                    results.push({
                        index,
                        position: { x: col * strideX, y: row * strideY },
                        size: { x: c.itemSize.x, y: c.itemSize.y },
                    });
                }
            }
            return results;
        } else {
            const colStride = strideX;
            if (colStride <= 0) return [];
            let startCol = Math.floor(scrollOffset.x / colStride) - overscan;
            let endCol = Math.ceil((scrollOffset.x + viewportSize.x) / colStride) + overscan;
            const totalCols = Math.ceil(itemCount / cols);
            startCol = Math.max(0, startCol);
            endCol = Math.min(totalCols - 1, endCol);

            const results: LayoutResult[] = [];
            for (let col = startCol; col <= endCol; col++) {
                for (let row = 0; row < cols; row++) {
                    const index = col * cols + row;
                    if (index >= itemCount) break;
                    results.push({
                        index,
                        position: { x: col * strideX, y: row * strideY },
                        size: { x: c.itemSize.x, y: c.itemSize.y },
                    });
                }
            }
            return results;
        }
    }

    getScrollOffsetForIndex(
        index: number,
        viewportSize: { x: number; y: number },
        itemCount: number,
        config: unknown,
        align: ScrollAlign,
    ): { x: number; y: number } {
        const c = config as GridLayoutData;
        const isVertical = c.direction === 0;
        const cols = c.crossAxisCount;
        const strideY = c.itemSize.y + c.spacing.y;
        const strideX = c.itemSize.x + c.spacing.x;

        const row = isVertical ? Math.floor(index / cols) : index % cols;
        const col = isVertical ? index % cols : Math.floor(index / cols);
        const itemOffset = isVertical ? row * strideY : col * strideX;
        const itemSize = isVertical ? c.itemSize.y : c.itemSize.x;
        const viewLength = isVertical ? viewportSize.y : viewportSize.x;

        let scrollTo: number;
        switch (align) {
            case ScrollAlign.Start: scrollTo = itemOffset; break;
            case ScrollAlign.Center: scrollTo = itemOffset - (viewLength - itemSize) / 2; break;
            case ScrollAlign.End: scrollTo = itemOffset - viewLength + itemSize; break;
            default: scrollTo = itemOffset;
        }

        const contentSize = this.getContentSize(itemCount, viewportSize, config);
        const maxScroll = isVertical
            ? Math.max(0, contentSize.height - viewLength)
            : Math.max(0, contentSize.width - viewLength);
        scrollTo = Math.max(0, Math.min(scrollTo, maxScroll));

        return isVertical ? { x: 0, y: scrollTo } : { x: scrollTo, y: 0 };
    }
}
