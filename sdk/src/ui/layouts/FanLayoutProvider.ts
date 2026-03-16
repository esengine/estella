import type { LayoutProvider, LayoutResult, ScrollAlign } from '../LayoutProvider';
import type { FanLayoutData } from './FanLayout';

const DEG_TO_RAD = Math.PI / 180;

export function computeFanPositions(
    itemCount: number,
    config: FanLayoutData,
    excludeIndices?: Set<number>,
): LayoutResult[] {
    if (itemCount === 0) return [];

    const activeIndices: number[] = [];
    for (let i = 0; i < itemCount; i++) {
        if (!excludeIndices?.has(i)) activeIndices.push(i);
    }
    const n = activeIndices.length;
    if (n === 0) return [];

    const spreadAngle = Math.min(
        config.maxSpreadAngle,
        (n - 1) * config.maxCardAngle,
    );
    const dirSign = config.direction === 1 ? -1 : 1;

    const results: LayoutResult[] = [];
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
        const angle = spreadAngle * t * DEG_TO_RAD;

        const useFixed = config.cardSpacing > 0 && n > 1;
        const x = useFixed
            ? (i - (n - 1) * 0.5) * config.cardSpacing
            : config.radius * Math.sin(angle);
        const y = config.radius * (1 - Math.cos(angle)) * dirSign;
        const rotation = angle * config.tiltFactor * (180 / Math.PI) * dirSign;

        results.push({
            index: activeIndices[i],
            position: { x, y },
            size: { x: 0, y: 0 },
            rotation,
        });
    }

    return results;
}

export class FanLayoutProvider implements LayoutProvider {
    getContentSize(
        itemCount: number,
        _viewportSize: { x: number; y: number },
        config: unknown,
    ): { width: number; height: number } {
        const c = config as FanLayoutData;
        const positions = computeFanPositions(itemCount, c);
        if (positions.length === 0) return { width: 0, height: 0 };

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of positions) {
            if (p.position.x < minX) minX = p.position.x;
            if (p.position.x > maxX) maxX = p.position.x;
            if (p.position.y < minY) minY = p.position.y;
            if (p.position.y > maxY) maxY = p.position.y;
        }

        return { width: maxX - minX, height: maxY - minY };
    }

    getVisibleRange(
        _scrollOffset: { x: number; y: number },
        _viewportSize: { x: number; y: number },
        itemCount: number,
        _overscan: number,
        config: unknown,
    ): LayoutResult[] {
        return computeFanPositions(itemCount, config as FanLayoutData);
    }

    getScrollOffsetForIndex(
        _index: number,
        _viewportSize: { x: number; y: number },
        _itemCount: number,
        _config: unknown,
        _align: ScrollAlign,
    ): { x: number; y: number } {
        return { x: 0, y: 0 };
    }
}
