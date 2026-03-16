import { ScrollAlign, type LayoutProvider, type LayoutResult } from '../LayoutProvider';
import type { LinearLayoutData } from './LinearLayout';

export class LinearLayoutProvider implements LayoutProvider {
    getContentSize(
        itemCount: number,
        viewportSize: { x: number; y: number },
        config: unknown,
    ): { width: number; height: number } {
        const c = config as LinearLayoutData;
        const isVertical = c.direction === 1;
        const totalLength = itemCount > 0
            ? itemCount * c.itemSize + (itemCount - 1) * c.spacing
            : 0;
        return isVertical
            ? { width: viewportSize.x, height: totalLength }
            : { width: totalLength, height: viewportSize.y };
    }

    getVisibleRange(
        scrollOffset: { x: number; y: number },
        viewportSize: { x: number; y: number },
        itemCount: number,
        overscan: number,
        config: unknown,
    ): LayoutResult[] {
        if (itemCount === 0) return [];

        const c = config as LinearLayoutData;
        const isVertical = c.direction === 1;
        const stride = c.itemSize + c.spacing;
        if (stride <= 0) return [];

        const scroll = isVertical ? scrollOffset.y : scrollOffset.x;
        const viewLength = isVertical ? viewportSize.y : viewportSize.x;

        let startIdx = Math.floor(scroll / stride) - overscan;
        let endIdx = Math.ceil((scroll + viewLength) / stride) + overscan;
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(itemCount - 1, endIdx);

        if (c.reverseOrder) {
            const results: LayoutResult[] = [];
            for (let i = startIdx; i <= endIdx; i++) {
                const reversed = itemCount - 1 - i;
                const offset = i * stride;
                results.push({
                    index: reversed,
                    position: isVertical
                        ? { x: 0, y: offset }
                        : { x: offset, y: 0 },
                    size: isVertical
                        ? { x: viewportSize.x, y: c.itemSize }
                        : { x: c.itemSize, y: viewportSize.y },
                });
            }
            return results;
        }

        const results: LayoutResult[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
            const offset = i * stride;
            results.push({
                index: i,
                position: isVertical
                    ? { x: 0, y: offset }
                    : { x: offset, y: 0 },
                size: isVertical
                    ? { x: viewportSize.x, y: c.itemSize }
                    : { x: c.itemSize, y: viewportSize.y },
            });
        }
        return results;
    }

    getScrollOffsetForIndex(
        index: number,
        viewportSize: { x: number; y: number },
        itemCount: number,
        config: unknown,
        align: ScrollAlign,
    ): { x: number; y: number } {
        const c = config as LinearLayoutData;
        const isVertical = c.direction === 1;
        const stride = c.itemSize + c.spacing;
        const targetIdx = c.reverseOrder ? itemCount - 1 - index : index;
        const itemOffset = targetIdx * stride;
        const viewLength = isVertical ? viewportSize.y : viewportSize.x;

        let scrollTo: number;
        switch (align) {
            case ScrollAlign.Start:
                scrollTo = itemOffset;
                break;
            case ScrollAlign.Center:
                scrollTo = itemOffset - (viewLength - c.itemSize) / 2;
                break;
            case ScrollAlign.End:
                scrollTo = itemOffset - viewLength + c.itemSize;
                break;
            case ScrollAlign.Auto:
            default:
                scrollTo = itemOffset;
        }

        const contentLength = this.getContentSize(itemCount, viewportSize, config);
        const maxScroll = isVertical
            ? Math.max(0, contentLength.height - viewLength)
            : Math.max(0, contentLength.width - viewLength);
        scrollTo = Math.max(0, Math.min(scrollTo, maxScroll));

        return isVertical ? { x: 0, y: scrollTo } : { x: scrollTo, y: 0 };
    }
}
