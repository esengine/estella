export interface LayoutResult {
    index: number;
    position: { x: number; y: number };
    size: { x: number; y: number };
    rotation?: number;
}

export const ScrollAlign = {
    Start: 0,
    Center: 1,
    End: 2,
    Auto: 3,
} as const;
export type ScrollAlign = (typeof ScrollAlign)[keyof typeof ScrollAlign];

export interface LayoutProvider {
    getContentSize(
        itemCount: number,
        viewportSize: { x: number; y: number },
        config: unknown,
    ): { width: number; height: number };

    getVisibleRange(
        scrollOffset: { x: number; y: number },
        viewportSize: { x: number; y: number },
        itemCount: number,
        overscan: number,
        config: unknown,
    ): LayoutResult[];

    getScrollOffsetForIndex(
        index: number,
        viewportSize: { x: number; y: number },
        itemCount: number,
        config: unknown,
        align: ScrollAlign,
    ): { x: number; y: number };
}

const providerRegistry = new Map<string, LayoutProvider>();

export function registerLayoutProvider(name: string, provider: LayoutProvider): void {
    providerRegistry.set(name, provider);
}

export function getLayoutProvider(name: string): LayoutProvider | null {
    return providerRegistry.get(name) ?? null;
}
