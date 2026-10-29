// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/graphics.ts
 * @brief   `Graphics` and `Line`: path-drawing components, over the engine's vector paths.
 *
 * A scene stores only a Graphics' style (line width, colours); its picture is what scripts draw with `moveTo`, `lineTo`, `rect`, `circle`,
 * `stroke` and `fill`, and Cocos keeps that picture until `clear()`. So this records the drawing and turns it into the geometry of the node's own
 * `MeshRenderer` (the engine's `buildPathGeometry`: ear-clipped fills, strokes with the line join and cap Cocos names), which is retained,
 * sorted and batched like any mesh and moves with the node. Nothing is redrawn per frame; the geometry is rebuilt on the frame after a change.
 */
import { Component } from '../component';
import { Color, Vec2 } from '../math';
import { declareClass } from '../host';
import { Schedule, defineSystem, addSystemToSchedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { MeshRenderer } from '../../ecs/component';
import { MeshRenderers, type MeshRendererAPI } from '../../render/meshRenderer';
import { buildPathGeometry, mergeGeometry, type LineCap, type LineJoin, type PathColor } from '../../render/vectorPath';
import type { MeshRendererGeometry } from '../../ecs/component';

interface Subpath {
    points: Vec2[];
    closed: boolean;
}

interface Op {
    kind: 'stroke' | 'fill';
    paths: Subpath[];
    color: PathColor;
    width: number;
    join: LineJoin;
    cap: LineCap;
    miterLimit: number;
}

const SEGMENTS_PER_CURVE = 16;
const JOINS: LineJoin[] = ['bevel', 'round', 'miter'];
const CAPS: LineCap[] = ['butt', 'round', 'square'];

const toColor = (c: Color): PathColor => [c.r / 255, c.g / 255, c.b / 255, c.a / 255];

/** The engine's geometry API, handed over by the frame (a component has no app to ask). */
let meshApi: MeshRendererAPI | null = null;

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
    private dirty_ = false;

    // ---- building a path ---------------------------------------------------------------------------------------------

    /** A path begun after something was drawn is a new one: the earlier shapes are on the canvas, not in the path. */
    private fresh_(): void {
        if (this.drawn_) { this.path_ = []; this.drawn_ = false; }
    }

    private current_(): Subpath {
        this.fresh_();
        let sub = this.path_[this.path_.length - 1];
        if (!sub || sub.closed) {
            sub = { points: this.cursor_ ? [this.cursor_] : [], closed: false };
            this.path_.push(sub);
        }
        return sub;
    }

    moveTo(x: number, y: number): void {
        this.fresh_();
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

    private closedShape_(points: Vec2[]): void {
        this.fresh_();
        this.path_.push({ points, closed: true });
        this.cursor_ = points[0] ?? null;
    }

    rect(x: number, y: number, w: number, h: number): void {
        this.closedShape_([new Vec2(x, y), new Vec2(x + w, y), new Vec2(x + w, y + h), new Vec2(x, y + h)]);
    }

    roundRect(x: number, y: number, w: number, h: number, r: number): void {
        const radius = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
        if (radius === 0) { this.rect(x, y, w, h); return; }
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
        this.closedShape_(pts);
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        this.rect(x, y, w, h);
        this.fill();
    }

    circle(cx: number, cy: number, r: number): void { this.ellipse(cx, cy, r, r); }

    ellipse(cx: number, cy: number, rx: number, ry: number): void {
        const n = Math.max(24, Math.min(96, Math.ceil(Math.max(Math.abs(rx), Math.abs(ry)) / 2)));
        const pts: Vec2[] = [];
        for (let i = 0; i < n; i++) pts.push(new Vec2(cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry));
        this.closedShape_(pts);
    }

    close(): void {
        const sub = this.path_[this.path_.length - 1];
        if (sub) { sub.closed = true; this.cursor_ = sub.points[0] ?? null; }
    }

    // ---- painting it ---------------------------------------------------------------------------------------------------

    private snapshot_(): Subpath[] {
        return this.path_.filter((p) => p.points.length > 0).map((p) => ({ closed: p.closed, points: p.points.map((v) => v.clone()) }));
    }

    stroke(): void {
        this.ops_.push({
            kind: 'stroke', paths: this.snapshot_(), color: toColor(this.strokeColor), width: this.lineWidth,
            join: JOINS[this.lineJoin] ?? 'miter', cap: CAPS[this.lineCap] ?? 'butt', miterLimit: this.miterLimit,
        });
        this.drawn_ = true;
        this.dirty_ = true;
    }

    fill(): void {
        this.ops_.push({ kind: 'fill', paths: this.snapshot_(), color: toColor(this.fillColor), width: 0, join: 'miter', cap: 'butt', miterLimit: 4 });
        this.drawn_ = true;
        this.dirty_ = true;
    }

    clear(): void {
        this.ops_ = [];
        this.path_ = [];
        this.cursor_ = null;
        this.drawn_ = false;
        this.dirty_ = true;
    }

    // ---- into the engine -------------------------------------------------------------------------------------------------

    update(): void {
        if (this.dirty_ && meshApi) this.upload_(meshApi);
    }

    onDisable(): void {
        // a Graphics that is off draws nothing; its picture is kept and comes back when it is on
        meshApi?.clearGeometry(this.node._entity);
        this.dirty_ = true;
    }

    private upload_(api: MeshRendererAPI): void {
        this.dirty_ = false;
        putGeometry(this, api, this.geometry());
    }

    /** What the recorded drawing is as geometry, in this node's own space. */
    geometry(): MeshRendererGeometry {
        const parts: MeshRendererGeometry[] = [];
        for (const op of this.ops_) {
            for (const sub of op.paths) {
                const points = sub.points;
                if (op.kind === 'fill') {
                    if (points.length >= 3) parts.push(buildPathGeometry(points, { fill: { color: op.color }, closed: true }));
                } else if (points.length >= 2) {
                    parts.push(buildPathGeometry(points, {
                        stroke: { color: op.color, width: op.width, join: op.join, cap: op.cap, miterLimit: op.miterLimit }, closed: sub.closed,
                    }));
                }
            }
        }
        return mergeGeometry(parts);
    }
}

/** Give a component's node the geometry as its mesh, or take its mesh away when there is none. */
function putGeometry(component: Component, api: MeshRendererAPI, geometry: MeshRendererGeometry): void {
    const entity = component.node._entity;
    if (geometry.indices.length === 0) { api.clearGeometry(entity); return; }
    if (!component._world.has(entity, MeshRenderer)) component._world.insert(entity, MeshRenderer, { enabled: true });
    api.setGeometry(entity, geometry);
}

// ---------------------------------------------------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------------------------------------------------

/** `Line`: a polyline of a width and a colour. Its points are the world's (`worldSpace`) or the node's own. */
export class Line extends Component {
    private positions_: Array<{ x: number; y: number; z: number }> = [];
    worldSpace = true;
    width = 1;
    color: Color = new Color(255, 255, 255, 255);
    private dirty_ = true;

    get positions(): Array<{ x: number; y: number; z: number }> { return this.positions_; }
    set positions(value: Array<{ x: number; y: number; z: number }>) { this.positions_ = value; this.dirty_ = true; }

    update(): void {
        if (!this.dirty_ || !meshApi) return;
        this.dirty_ = false;
        putGeometry(this, meshApi, this.geometry());
    }

    onDisable(): void {
        meshApi?.clearGeometry(this.node._entity);
        this.dirty_ = true;
    }

    /** The polyline as geometry in the node's space: a world-space line is carried back through the node's place. */
    geometry(): MeshRendererGeometry {
        if (this.positions_.length < 2) return { positions: [], colors: [], indices: [] };
        let points: Vec2[] = this.positions_.map((p) => new Vec2(p.x, p.y));
        if (this.worldSpace) {
            const node = this.node;
            const p = node.worldPosition, s = node.worldScale, q = node.worldRotation;
            const angle = 2 * Math.atan2(q.z, q.w);
            const cos = Math.cos(-angle), sin = Math.sin(-angle);
            points = points.map((v) => {
                const x = v.x - p.x, y = v.y - p.y;
                return new Vec2((x * cos - y * sin) / (s.x || 1), (x * sin + y * cos) / (s.y || 1));
            });
        }
        return buildPathGeometry(points, { stroke: { color: toColor(this.color), width: this.width, join: 'round', cap: 'butt' } });
    }
}

/** Test seam: the geometry API the frame would hand over. */
export function setGraphicsMeshApi(api: MeshRendererAPI | null): void { meshApi = api; }

export function declareGraphics(): void {
    declareClass(Graphics as never, 'Graphics', [
        { name: 'lineWidth', kind: 'number' },
        { name: 'lineJoin', kind: 'number' },
        { name: 'lineCap', kind: 'number' },
        { name: 'miterLimit', kind: 'number' },
        { name: 'strokeColor', kind: 'color' },
        { name: 'fillColor', kind: 'color' },
    ]);
    declareClass(Line as never, 'Line', [
        { name: 'worldSpace', kind: 'boolean' },
        { name: 'width', kind: 'number' },
        { name: 'color', kind: 'color' },
        { name: 'positions', kind: 'json' },
    ]);
    // The geometry API lives on the app; a component has no way to ask for it, so a system hands it over each frame.
    addSystemToSchedule(Schedule.PreUpdate, defineSystem(
        [Res(MeshRenderers)],
        (api) => { if (api) meshApi = api; },
        { name: 'Cocos:GraphicsApi', touches: { opaque: true } },
    ));
}
