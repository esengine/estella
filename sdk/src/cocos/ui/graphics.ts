// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/graphics.ts
 * @brief   `Graphics`: the path-drawing component, over the engine's immediate `Draw`.
 *
 * A scene stores only a Graphics' style (line width, colours); its picture is what scripts draw with `moveTo`, `lineTo`, `rect`, `circle`,
 * `stroke` and `fill`, and Cocos keeps that picture until `clear()`. So this keeps the recorded drawing and plays it into the engine's `Draw`
 * every frame, in the node's place. What `Draw` can paint, this paints: lines at a width, filled rectangles and circles. A filled path of any other
 * shape is counted (and said once), not drawn — the engine has no polygon fill, and guessing one would draw the wrong thing.
 */
import { Component } from '../component';
import { Color, Vec2 } from '../math';
import { declareClass } from '../host';
import { Draw } from '../../render/draw';
import { registerScopedDrawCallback, unregisterDrawCallback } from '../../render/customDraw';
import type { CppRegistry } from '../../wasm';
import { log } from '../../util/logger';

interface Subpath {
    points: Vec2[];
    closed: boolean;
    /** Set when the subpath is exactly a rectangle or a circle, which can be filled. */
    shape?: { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'circle'; x: number; y: number; r: number };
}

interface Op {
    kind: 'stroke' | 'fill';
    paths: Subpath[];
    color: Color;
    width: number;
}

const SEGMENTS_PER_CURVE = 16;
let ids = 0;

const toEngine = (c: Color): { r: number; g: number; b: number; a: number } => ({ r: c.r / 255, g: c.g / 255, b: c.b / 255, a: c.a / 255 });

export class Graphics extends Component {
    static readonly LineJoin = Object.freeze({ BEVEL: 0, ROUND: 1, MITER: 2 });
    static readonly LineCap = Object.freeze({ BUTT: 0, ROUND: 1, SQUARE: 2 });

    lineWidth = 1;
    lineJoin = 2;
    lineCap = 0;
    miterLimit = 10;
    strokeColor: Color = new Color(0, 0, 0, 255);
    fillColor: Color = new Color(255, 255, 255, 255);

    private path_: Subpath[] = [];
    private cursor_: Vec2 | null = null;
    private drawn_ = false;
    private ops_: Op[] = [];
    private callback_: string | null = null;
    private warned_ = false;

    // ---- building a path ---------------------------------------------------------------------------------------------

    private current_(): Subpath {
        // A path begun after something was drawn is a new one: the earlier shapes are on the canvas, not in the path.
        if (this.drawn_) { this.path_ = []; this.drawn_ = false; }
        let sub = this.path_[this.path_.length - 1];
        if (!sub || sub.closed || sub.shape) {
            sub = { points: this.cursor_ ? [this.cursor_] : [], closed: false };
            this.path_.push(sub);
        }
        return sub;
    }

    moveTo(x: number, y: number): void {
        if (this.drawn_) { this.path_ = []; this.drawn_ = false; }
        this.cursor_ = new Vec2(x, y);
        this.path_.push({ points: [this.cursor_], closed: false });
    }

    lineTo(x: number, y: number): void {
        const sub = this.current_();
        this.cursor_ = new Vec2(x, y);
        sub.points.push(this.cursor_);
    }

    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
        const sub = this.current_();
        const from = sub.points[sub.points.length - 1] ?? new Vec2(c1x, c1y);
        for (let i = 1; i <= SEGMENTS_PER_CURVE; i++) {
            const t = i / SEGMENTS_PER_CURVE, u = 1 - t;
            sub.points.push(new Vec2(
                u * u * u * from.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
                u * u * u * from.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y));
        }
        this.cursor_ = new Vec2(x, y);
    }

    quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
        const sub = this.current_();
        const from = sub.points[sub.points.length - 1] ?? new Vec2(cx, cy);
        for (let i = 1; i <= SEGMENTS_PER_CURVE; i++) {
            const t = i / SEGMENTS_PER_CURVE, u = 1 - t;
            sub.points.push(new Vec2(u * u * from.x + 2 * u * t * cx + t * t * x, u * u * from.y + 2 * u * t * cy + t * t * y));
        }
        this.cursor_ = new Vec2(x, y);
    }

    arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, counterclockwise: boolean): void {
        const sub = this.current_();
        let sweep = endAngle - startAngle;
        if (counterclockwise && sweep > 0) sweep -= Math.PI * 2;
        if (!counterclockwise && sweep < 0) sweep += Math.PI * 2;
        const steps = Math.max(4, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 48));
        for (let i = 0; i <= steps; i++) {
            const a = startAngle + (sweep * i) / steps;
            sub.points.push(new Vec2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
        }
        this.cursor_ = sub.points[sub.points.length - 1]!;
    }

    private shape_(points: Vec2[], shape: Subpath['shape']): void {
        if (this.drawn_) { this.path_ = []; this.drawn_ = false; }
        this.path_.push({ points, closed: true, shape });
        this.cursor_ = points[0] ?? null;
    }

    rect(x: number, y: number, w: number, h: number): void {
        this.shape_([new Vec2(x, y), new Vec2(x + w, y), new Vec2(x + w, y + h), new Vec2(x, y + h)], { kind: 'rect', x, y, w, h });
    }

    /** A rounded rectangle is drawn as its outline of arcs, and filled as the rectangle it rounds: the engine fills no rounded corner here. */
    roundRect(x: number, y: number, w: number, h: number, r: number): void {
        const radius = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
        const pts: Vec2[] = [];
        const corner = (cx: number, cy: number, from: number): void => {
            for (let i = 0; i <= 8; i++) {
                const a = from + (Math.PI / 2) * (i / 8);
                pts.push(new Vec2(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
            }
        };
        corner(x + w - radius, y + radius, -Math.PI / 2);
        corner(x + w - radius, y + h - radius, 0);
        corner(x + radius, y + h - radius, Math.PI / 2);
        corner(x + radius, y + radius, Math.PI);
        this.shape_(pts, radius === 0 ? { kind: 'rect', x, y, w, h } : undefined);
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        this.rect(x, y, w, h);
        this.fill();
    }

    circle(cx: number, cy: number, r: number): void {
        const pts: Vec2[] = [];
        for (let i = 0; i < 48; i++) pts.push(new Vec2(cx + Math.cos((i / 48) * Math.PI * 2) * r, cy + Math.sin((i / 48) * Math.PI * 2) * r));
        this.shape_(pts, { kind: 'circle', x: cx, y: cy, r });
    }

    ellipse(cx: number, cy: number, rx: number, ry: number): void {
        const pts: Vec2[] = [];
        for (let i = 0; i < 48; i++) pts.push(new Vec2(cx + Math.cos((i / 48) * Math.PI * 2) * rx, cy + Math.sin((i / 48) * Math.PI * 2) * ry));
        this.shape_(pts, rx === ry ? { kind: 'circle', x: cx, y: cy, r: rx } : undefined);
    }

    close(): void {
        const sub = this.path_[this.path_.length - 1];
        if (sub && !sub.shape) { sub.closed = true; this.cursor_ = sub.points[0] ?? null; }
    }

    // ---- painting it ---------------------------------------------------------------------------------------------------

    private snapshot_(): Subpath[] {
        return this.path_.filter((p) => p.points.length > 0).map((p) => ({ ...p, points: p.points.map((v) => v.clone()) }));
    }

    stroke(): void {
        this.ops_.push({ kind: 'stroke', paths: this.snapshot_(), color: this.strokeColor.clone(), width: this.lineWidth });
        this.drawn_ = true;
    }

    fill(): void {
        this.ops_.push({ kind: 'fill', paths: this.snapshot_(), color: this.fillColor.clone(), width: 0 });
        this.drawn_ = true;
    }

    clear(): void {
        this.ops_ = [];
        this.path_ = [];
        this.cursor_ = null;
        this.drawn_ = false;
    }

    // ---- into the frame --------------------------------------------------------------------------------------------------

    onEnable(): void {
        const registry = this._world.getCppRegistry() as CppRegistry | null;
        if (!registry || this.callback_) return;
        this.callback_ = `cocos-graphics:${++ids}`;
        registerScopedDrawCallback(this.callback_, registry, () => this.paint_());
    }

    onDisable(): void {
        if (this.callback_) unregisterDrawCallback(this.callback_);
        this.callback_ = null;
    }

    private paint_(): void {
        if (this.ops_.length === 0) return;
        const node = this.node;
        const p = node.worldPosition, s = node.worldScale, q = node.worldRotation;
        // the node's turn about Z, which is all a drawing on a flat scene has
        const angle = 2 * Math.atan2(q.z, q.w);
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const place = (v: Vec2): { x: number; y: number } => {
            const x = v.x * s.x, y = v.y * s.y;
            return { x: p.x + x * cos - y * sin, y: p.y + x * sin + y * cos };
        };
        const scale = (Math.abs(s.x) + Math.abs(s.y)) / 2;
        for (const op of this.ops_) {
            const color = toEngine(op.color);
            if (color.a <= 0) continue;
            for (const sub of op.paths) {
                if (op.kind === 'stroke') {
                    const pts = sub.points.map(place);
                    const thickness = Math.max(op.width * scale, 1);
                    for (let i = 1; i < pts.length; i++) Draw.line(pts[i - 1]!, pts[i]!, color, thickness);
                    if (sub.closed && pts.length > 2) Draw.line(pts[pts.length - 1]!, pts[0]!, color, thickness);
                } else if (sub.shape?.kind === 'rect' && Math.abs(angle) < 1e-4) {
                    const a = place(new Vec2(sub.shape.x, sub.shape.y)), b = place(new Vec2(sub.shape.x + sub.shape.w, sub.shape.y + sub.shape.h));
                    Draw.rect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.abs(b.x - a.x), y: Math.abs(b.y - a.y) }, color, true);
                } else if (sub.shape?.kind === 'circle') {
                    Draw.circle(place(new Vec2(sub.shape.x, sub.shape.y)), sub.shape.r * scale, color, true, 32);
                } else if (!this.warned_) {
                    this.warned_ = true;
                    log.warn('cocos', `Graphics.fill() of a path that is not a rectangle or a circle is not drawn (${this.node.name})`);
                }
            }
        }
    }
}

export function declareGraphics(): void {
    declareClass(Graphics as never, 'Graphics', [
        { name: 'lineWidth', kind: 'number' },
        { name: 'lineJoin', kind: 'number' },
        { name: 'lineCap', kind: 'number' },
        { name: 'miterLimit', kind: 'number' },
        { name: 'strokeColor', kind: 'color' },
        { name: 'fillColor', kind: 'color' },
    ]);
}
