// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    graphics.ts
 * @brief   Graphics: a retained vector drawing, tessellated once and drawn as often as asked.
 *
 * @details A Graphics records paths and shapes the way a 2D canvas is drawn (a line style, a fill, `moveTo`, `lineTo`, curves, arcs,
 *          rectangles, circles, polygons) and turns them into triangles with the engine's path tessellator (`buildPathGeometry`):
 *          fills of any outline, concave ones included, and strokes with a join at every corner and a cap at each open end. The
 *          triangles are built once, the first time they are drawn after a change, and `flush()` draws them through `Draw.triangles`,
 *          batched with the frame's other shapes. `flush({ x, y, rotation, scale, alpha })` draws the same drawing somewhere else,
 *          turned, scaled or faded, so one shape stands for any number of copies on screen with nothing rebuilt and no texture made:
 *          a hit flash fading out is one Graphics drawn with a falling alpha, not a drawing a frame.
 *
 *          A fill painted between `beginFill` and `endFill` covers every outline drawn in it, a path as much as a rectangle; the line
 *          style strokes what is drawn while it is set. A path takes the style in force when it ends: a new `moveTo`, a change of
 *          style, a shape, `closePath` or a draw ends it.
 */
import type { Color, Vec2 } from '../types';
import { Draw } from './draw';
import { buildPathGeometry, mergeGeometry, type LineCap, type LineJoin, type PathStyle } from './vectorPath';
import type { MeshRendererGeometry } from '../ecs/component';

const DEFAULT_CURVE_SEGMENTS = 20;
const TWO_PI = Math.PI * 2;

/** How a Graphics strokes, besides its width and colour. @experimental */
export interface GraphicsLineOptions {
    /** How two segments meet at a corner. Default `'miter'`. */
    join?: LineJoin;
    /** How an open path ends. Default `'butt'`. */
    cap?: LineCap;
    /** How far a miter may reach, as a multiple of half the width, before the corner is bevelled. Default 4. */
    miterLimit?: number;
}

/** Where and how {@link Graphics.flush} draws. Every field is optional; none moves or fades anything. @experimental */
export interface GraphicsDrawOptions {
    /** Moves the drawing by this much, after it is turned and scaled about its own origin. */
    x?: number;
    y?: number;
    /** Turns the drawing about its own origin, in radians. */
    rotation?: number;
    /** Scales the drawing about its own origin: one factor, or one each way. */
    scale?: number | Vec2;
    /** Multiplies every colour's alpha: 0 draws nothing, 1 the drawing as recorded. */
    alpha?: number;
    /** Multiplies every colour. */
    tint?: Color;
}

/** One outline and the style it is drawn with. */
interface Shape {
    points: Vec2[];
    style: PathStyle;
}

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const toPathColor = (c: Color): [number, number, number, number] => [c.r, c.g, c.b, c.a];

export class Graphics {
    private lineThickness_ = 1;
    private lineColor_: Color = { ...WHITE };
    private lineOptions_: GraphicsLineOptions = {};
    private fillColor_: Color = { ...WHITE };
    private filling_ = false;
    /** The path being drawn, and whether closePath closed it. */
    private path_: Vec2[] = [];
    private closed_ = false;
    private readonly shapes_: Shape[] = [];
    private feather_ = 0;
    /** The triangles of every shape, built the first time they are needed after a change; null when they must be built again. */
    private built_: MeshRendererGeometry | null = null;
    private drawn_ = { positions: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) };

    /**
     * Width of a fade to transparent along every outer edge, in the drawing's units: anti-aliasing for a surface drawn without
     * multisampling. 0 (default) draws hard edges.
     */
    get feather(): number {
        return this.feather_;
    }

    set feather(value: number) {
        const next = Math.max(0, value || 0);
        if (next === this.feather_) return;
        this.feather_ = next;
        this.built_ = null;
    }

    /** How many points the path being drawn holds. */
    get pathLength(): number {
        return this.path_.length;
    }

    /** How many outlines the drawing holds; the path being drawn counts once it ends. */
    get shapeCount(): number {
        return this.shapes_.length;
    }

    lineStyle(thickness: number, color: Color, options: GraphicsLineOptions = {}): void {
        this.endPath_(true);
        this.lineThickness_ = thickness;
        this.lineColor_ = { ...color };
        this.lineOptions_ = { ...options };
    }

    beginFill(color: Color): void {
        this.endPath_(true);
        this.fillColor_ = { ...color };
        this.filling_ = true;
    }

    endFill(): void {
        this.endPath_(true);
        this.filling_ = false;
    }

    moveTo(x: number, y: number): void {
        this.endPath_(false);
        this.path_.push({ x, y });
    }

    lineTo(x: number, y: number): void {
        this.current_();
        this.path_.push({ x, y });
    }

    /** Joins the path's last point back to its first, so a stroke turns that corner with no caps. Ends the path. */
    closePath(): void {
        if (this.path_.length === 0) return;
        this.closed_ = true;
        this.endPath_(false);
    }

    curveTo(cpx: number, cpy: number, x: number, y: number, segments = DEFAULT_CURVE_SEGMENTS): void {
        const p = this.current_();
        this.addCurve_(segments, (s) => {
            const u = 1 - s;
            return { x: u * u * p.x + 2 * u * s * cpx + s * s * x, y: u * u * p.y + 2 * u * s * cpy + s * s * y };
        });
    }

    cubicCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number, segments = DEFAULT_CURVE_SEGMENTS): void {
        const p = this.current_();
        this.addCurve_(segments, (s) => {
            const u = 1 - s;
            return {
                x: u * u * u * p.x + 3 * u * u * s * cp1x + 3 * u * s * s * cp2x + s * s * s * x,
                y: u * u * u * p.y + 3 * u * u * s * cp1y + 3 * u * s * s * cp2y + s * s * s * y,
            };
        });
    }

    /** An arc about (cx, cy). The path goes on from its last point straight to where the arc begins. */
    arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false, segments?: number): void {
        let sweep = endAngle - startAngle;
        if (anticlockwise) {
            if (sweep > 0) sweep -= TWO_PI;
        } else if (sweep < 0) {
            sweep += TWO_PI;
        }
        const n = segments ?? Math.max(1, Math.ceil((Math.abs(sweep) / TWO_PI) * 32));
        this.path_.push({ x: cx + Math.cos(startAngle) * radius, y: cy + Math.sin(startAngle) * radius });
        for (let i = 1; i <= n; i++) {
            const a = startAngle + sweep * (i / n);
            this.path_.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
        }
    }

    drawArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false, segments?: number): void {
        this.arc(cx, cy, radius, startAngle, endAngle, anticlockwise, segments);
    }

    drawRect(x: number, y: number, width: number, height: number): void {
        this.shape_([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]);
    }

    drawRoundRect(x: number, y: number, width: number, height: number, radius: number, cornerSegments = 8): void {
        const r = Math.min(radius, width / 2, height / 2);
        if (!(r > 0)) {
            this.drawRect(x, y, width, height);
            return;
        }
        const points: Vec2[] = [];
        const corner = (cx: number, cy: number, from: number): void => {
            for (let i = 0; i <= cornerSegments; i++) {
                const a = from + (Math.PI / 2) * (i / cornerSegments);
                points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
            }
        };
        corner(x + width - r, y + r, -Math.PI / 2);
        corner(x + width - r, y + height - r, 0);
        corner(x + r, y + height - r, Math.PI / 2);
        corner(x + r, y + r, Math.PI);
        this.shape_(points);
    }

    drawCircle(cx: number, cy: number, radius: number, segments = 32): void {
        this.drawEllipse(cx, cy, radius, radius, segments);
    }

    drawEllipse(cx: number, cy: number, rw: number, rh: number, segments = 32): void {
        const n = Math.max(3, Math.floor(segments));
        const points: Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TWO_PI;
            points.push({ x: cx + Math.cos(a) * rw, y: cy + Math.sin(a) * rh });
        }
        this.shape_(points);
    }

    /** A closed outline through `points`, filled while a fill is on and stroked with the line style: any polygon, concave too. */
    drawPolygon(points: readonly Vec2[]): void {
        this.shape_(points.map((p) => ({ x: p.x, y: p.y })));
    }

    clear(): void {
        this.path_ = [];
        this.closed_ = false;
        this.shapes_.length = 0;
        this.filling_ = false;
        this.built_ = null;
    }

    /** The drawing's triangles in its own coordinates: what {@link flush} draws, and what a MeshRenderer can be given to keep. */
    geometry(): MeshRendererGeometry {
        this.endPath_(true);
        if (!this.built_) {
            const built = mergeGeometry(this.shapes_.map((s) => buildPathGeometry(s.points, s.style)));
            this.built_ = built;
            this.drawn_ = {
                positions: Float32Array.from(built.positions),
                colors: Float32Array.from(built.colors ?? []),
                indices: Uint32Array.from(built.indices),
            };
        }
        return this.built_;
    }

    /** Draws the drawing (built first if it changed), moved, turned, scaled and faded as `options` say. */
    flush(options: GraphicsDrawOptions = {}): void {
        this.geometry();
        if (this.drawn_.indices.length === 0) return;
        const alpha = options.alpha ?? 1;
        if (!(alpha > 0)) return;
        const t = options.tint ?? WHITE;
        const rotation = options.rotation ?? 0;
        const scale = options.scale ?? 1;
        const sx = typeof scale === 'number' ? scale : scale.x;
        const sy = typeof scale === 'number' ? scale : scale.y;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);
        Draw.triangles(this.drawn_, {
            tint: { r: t.r, g: t.g, b: t.b, a: t.a * alpha },
            transform: [cos * sx, sin * sx, -sin * sy, cos * sy, options.x ?? 0, options.y ?? 0],
        });
    }

    private current_(): Vec2 {
        if (this.path_.length === 0) this.path_.push({ x: 0, y: 0 });
        return this.path_[this.path_.length - 1];
    }

    private addCurve_(segments: number, at: (s: number) => Vec2): void {
        const n = Math.max(1, Math.floor(segments));
        for (let i = 1; i <= n; i++) this.path_.push(at(i / n));
    }

    /** The style a shape drawn now takes: the fill if one is on, the stroke if the line has a width; null when it would draw nothing. */
    private style_(closed: boolean): PathStyle | null {
        const stroke = this.lineThickness_ > 0;
        if (!this.filling_ && !stroke) return null;
        return {
            ...(this.filling_ ? { fill: { color: toPathColor(this.fillColor_) } } : {}),
            ...(stroke ? {
                stroke: {
                    color: toPathColor(this.lineColor_),
                    width: this.lineThickness_,
                    join: this.lineOptions_.join ?? 'miter',
                    cap: this.lineOptions_.cap ?? 'butt',
                    ...(this.lineOptions_.miterLimit !== undefined ? { miterLimit: this.lineOptions_.miterLimit } : {}),
                },
            } : {}),
            closed,
            ...(this.feather_ > 0 ? { feather: this.feather_ } : {}),
        };
    }

    private shape_(points: Vec2[]): void {
        this.endPath_(true);
        const style = this.style_(true);
        if (!style || points.length < 2) return;
        this.shapes_.push({ points, style });
        this.built_ = null;
    }

    /**
     * End the path being drawn as a shape in the style in force. `keepPen` starts the next path where this one stopped, so a change
     * of style part-way along a line goes on from the same point.
     */
    private endPath_(keepPen: boolean): void {
        const points = this.path_;
        const closed = this.closed_;
        this.path_ = keepPen && points.length > 0 && !closed ? [points[points.length - 1]] : [];
        this.closed_ = false;
        if (points.length < 2) return;
        const style = this.style_(closed);
        if (!style) return;
        this.shapes_.push({ points, style });
        this.built_ = null;
    }
}
