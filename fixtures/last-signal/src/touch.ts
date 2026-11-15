export interface Point { id: number; x: number; y: number }

export interface Gesture {
    tap: { x: number; y: number } | null;
    drag: { fromX: number; fromY: number; toX: number; toY: number } | null;
    pinch: { factor: number; x: number; y: number } | null;
}

const TAP_SLOP = 12;
const TAP_SECONDS = 0.45;

export class Gestures {
    private held = new Map<number, { startX: number; startY: number; x: number; y: number; age: number; moved: boolean; blocked: boolean }>();
    private spread = 0;
    private many = false;

    feed(points: readonly Point[], seconds: number, overUi: boolean): Gesture {
        const out: Gesture = { tap: null, drag: null, pinch: null };
        const live = new Set(points.map((p) => p.id));
        for (const [id, h] of this.held) {
            if (live.has(id)) continue;
            this.held.delete(id);
            if (!h.blocked && !h.moved && !this.many && h.age <= TAP_SECONDS) out.tap = { x: h.x, y: h.y };
        }
        if (this.held.size === 0 && points.length === 0) this.many = false;
        for (const p of points) {
            const h = this.held.get(p.id);
            if (h === undefined) {
                this.held.set(p.id, { startX: p.x, startY: p.y, x: p.x, y: p.y, age: 0, moved: false, blocked: overUi });
                if (this.held.size > 1) { this.many = true; this.spread = 0; }
                continue;
            }
            h.age += seconds;
            if (Math.hypot(p.x - h.startX, p.y - h.startY) > TAP_SLOP) h.moved = true;
        }
        const free = points.filter((p) => this.held.get(p.id)?.blocked === false);
        if (free.length === 1 && !this.many) {
            const p = free[0]!, h = this.held.get(p.id)!;
            if (h.moved && (p.x !== h.x || p.y !== h.y)) out.drag = { fromX: h.x, fromY: h.y, toX: p.x, toY: p.y };
        } else if (free.length >= 2) {
            const [a, b] = free as [Point, Point];
            const spread = Math.hypot(a.x - b.x, a.y - b.y);
            const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
            if (this.spread > 0 && spread > 0) out.pinch = { factor: this.spread / spread, x, y };
            this.spread = spread;
        }
        if (free.length < 2) this.spread = 0;
        for (const p of points) {
            const h = this.held.get(p.id)!;
            h.x = p.x;
            h.y = p.y;
        }
        return out;
    }
}
