export type HitAreaShape =
    | { type: 'rect'; x: number; y: number; width: number; height: number }
    | { type: 'circle'; cx: number; cy: number; radius: number }
    | { type: 'polygon'; points: number[] };

export function pointInHitArea(px: number, py: number, area: HitAreaShape): boolean {
    switch (area.type) {
        case 'rect':
            return px >= area.x && px <= area.x + area.width &&
                   py >= area.y && py <= area.y + area.height;

        case 'circle': {
            const dx = px - area.cx;
            const dy = py - area.cy;
            return dx * dx + dy * dy <= area.radius * area.radius;
        }

        case 'polygon':
            return pointInPolygon(px, py, area.points);
    }
}

function pointInPolygon(px: number, py: number, points: number[]): boolean {
    const n = points.length / 2;
    if (n < 3) return false;

    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = points[i * 2], yi = points[i * 2 + 1];
        const xj = points[j * 2], yj = points[j * 2 + 1];

        if (((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}
