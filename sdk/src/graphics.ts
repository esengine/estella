import type { Color, Vec2 } from './types';
import { Draw } from './draw';

const DEFAULT_CURVE_SEGMENTS = 20;

interface LineCmd {
    from: Vec2;
    to: Vec2;
    color: Color;
    thickness: number;
}

interface FillCmd {
    type: 'rect' | 'circle' | 'polygon';
    color: Color;
    x: number;
    y: number;
    width: number;
    height: number;
    radius?: number;
    segments?: number;
}

export class Graphics {
    private path_: Vec2[] = [];
    private lineColor_: Color = { r: 1, g: 1, b: 1, a: 1 };
    private lineThickness_ = 1;
    private fillColor_: Color = { r: 1, g: 1, b: 1, a: 1 };
    private filling_ = false;

    lineCommands: LineCmd[] = [];
    fillCommands: FillCmd[] = [];

    get pathLength(): number {
        return this.path_.length;
    }

    lineStyle(thickness: number, color: Color): void {
        this.lineThickness_ = thickness;
        this.lineColor_ = { ...color };
    }

    beginFill(color: Color): void {
        this.fillColor_ = { ...color };
        this.filling_ = true;
    }

    endFill(): void {
        this.filling_ = false;
    }

    moveTo(x: number, y: number): void {
        this.path_.push({ x, y });
    }

    lineTo(x: number, y: number): void {
        const prev = this.path_.length > 0 ? this.path_[this.path_.length - 1] : { x: 0, y: 0 };
        this.path_.push({ x, y });
        this.lineCommands.push({
            from: { ...prev },
            to: { x, y },
            color: { ...this.lineColor_ },
            thickness: this.lineThickness_,
        });
    }

    private addCurveSegments_(endX: number, endY: number, segments: number, interpolate: (s: number) => Vec2): void {
        const c = { ...this.lineColor_ };
        const t = this.lineThickness_;
        let last = this.path_.length > 0 ? this.path_[this.path_.length - 1] : { x: 0, y: 0 };
        for (let i = 1; i <= segments; i++) {
            const pt = interpolate(i / segments);
            this.lineCommands.push({ from: { ...last }, to: pt, color: c, thickness: t });
            last = pt;
        }
        this.path_.push({ x: endX, y: endY });
    }

    curveTo(cpx: number, cpy: number, x: number, y: number, segments = DEFAULT_CURVE_SEGMENTS): void {
        const prev = this.path_.length > 0 ? this.path_[this.path_.length - 1] : { x: 0, y: 0 };
        this.addCurveSegments_(x, y, segments, (s) => {
            const invS = 1 - s;
            return {
                x: invS * invS * prev.x + 2 * invS * s * cpx + s * s * x,
                y: invS * invS * prev.y + 2 * invS * s * cpy + s * s * y,
            };
        });
    }

    cubicCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number, segments = DEFAULT_CURVE_SEGMENTS): void {
        const prev = this.path_.length > 0 ? this.path_[this.path_.length - 1] : { x: 0, y: 0 };
        this.addCurveSegments_(x, y, segments, (s) => {
            const invS = 1 - s;
            return {
                x: invS * invS * invS * prev.x + 3 * invS * invS * s * cp1x + 3 * invS * s * s * cp2x + s * s * s * x,
                y: invS * invS * invS * prev.y + 3 * invS * invS * s * cp1y + 3 * invS * s * s * cp2y + s * s * s * y,
            };
        });
    }

    arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false, segments?: number): void {
        let sweep = endAngle - startAngle;
        if (anticlockwise) {
            if (sweep > 0) sweep -= Math.PI * 2;
        } else {
            if (sweep < 0) sweep += Math.PI * 2;
        }
        const numSegments = segments ?? Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * 32));
        const c = { ...this.lineColor_ };
        const t = this.lineThickness_;

        const startPt = { x: cx + Math.cos(startAngle) * radius, y: cy + Math.sin(startAngle) * radius };
        if (this.path_.length > 0) {
            const prev = this.path_[this.path_.length - 1];
            this.lineCommands.push({ from: { ...prev }, to: { ...startPt }, color: c, thickness: t });
        }

        let last = startPt;
        for (let i = 1; i <= numSegments; i++) {
            const angle = startAngle + sweep * (i / numSegments);
            const pt = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
            this.lineCommands.push({ from: { ...last }, to: pt, color: c, thickness: t });
            last = pt;
        }
        this.path_.push(last);
    }

    drawArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, anticlockwise = false, segments?: number): void {
        this.arc(cx, cy, radius, startAngle, endAngle, anticlockwise, segments);
    }

    drawRect(x: number, y: number, width: number, height: number): void {
        if (this.filling_) {
            this.fillCommands.push({
                type: 'rect', color: { ...this.fillColor_ },
                x: x + width / 2, y: y + height / 2, width, height,
            });
        }
        if (this.lineThickness_ > 0) {
            const c = this.lineColor_;
            const t = this.lineThickness_;
            this.lineCommands.push(
                { from: { x, y }, to: { x: x + width, y }, color: { ...c }, thickness: t },
                { from: { x: x + width, y }, to: { x: x + width, y: y + height }, color: { ...c }, thickness: t },
                { from: { x: x + width, y: y + height }, to: { x, y: y + height }, color: { ...c }, thickness: t },
                { from: { x, y: y + height }, to: { x, y }, color: { ...c }, thickness: t },
            );
        }
    }

    drawRoundRect(x: number, y: number, width: number, height: number, radius: number): void {
        const r = Math.min(radius, width / 2, height / 2);
        if (r <= 0) {
            this.drawRect(x, y, width, height);
            return;
        }

        const HALF_PI = Math.PI / 2;
        const PI = Math.PI;
        const cornerSegments = 8;

        const right = x + width;
        const bottom = y + height;

        if (this.filling_) {
            this.fillCommands.push({
                type: 'rect', color: { ...this.fillColor_ },
                x: x + width / 2, y: y + height / 2, width, height,
            });
        }

        if (this.lineThickness_ > 0) {
            const c = this.lineColor_;
            const t = this.lineThickness_;

            this.path_.push({ x: x + r, y });
            this.lineTo(right - r, y);
            this.arc(right - r, y + r, r, -HALF_PI, 0, false, cornerSegments);
            this.lineTo(right, bottom - r);
            this.arc(right - r, bottom - r, r, 0, HALF_PI, false, cornerSegments);
            this.lineTo(x + r, bottom);
            this.arc(x + r, bottom - r, r, HALF_PI, PI, false, cornerSegments);
            this.lineTo(x, y + r);
            this.arc(x + r, y + r, r, PI, PI + HALF_PI, false, cornerSegments);

            // close path
            const last = this.path_[this.path_.length - 1];
            this.lineCommands.push({
                from: { ...last }, to: { x: x + r, y },
                color: { ...c }, thickness: t,
            });
        }
    }

    drawCircle(cx: number, cy: number, radius: number, segments = 32): void {
        if (this.filling_) {
            this.fillCommands.push({
                type: 'circle', color: { ...this.fillColor_ },
                x: cx, y: cy, width: radius, height: radius, radius, segments,
            });
        }
        if (this.lineThickness_ > 0) {
            const c = this.lineColor_;
            const t = this.lineThickness_;
            for (let i = 0; i < segments; i++) {
                const a0 = (i / segments) * Math.PI * 2;
                const a1 = ((i + 1) / segments) * Math.PI * 2;
                this.lineCommands.push({
                    from: { x: cx + Math.cos(a0) * radius, y: cy + Math.sin(a0) * radius },
                    to: { x: cx + Math.cos(a1) * radius, y: cy + Math.sin(a1) * radius },
                    color: { ...c }, thickness: t,
                });
            }
        }
    }

    drawEllipse(cx: number, cy: number, rw: number, rh: number, segments = 32): void {
        if (this.lineThickness_ > 0) {
            const c = this.lineColor_;
            const t = this.lineThickness_;
            for (let i = 0; i < segments; i++) {
                const a0 = (i / segments) * Math.PI * 2;
                const a1 = ((i + 1) / segments) * Math.PI * 2;
                this.lineCommands.push({
                    from: { x: cx + Math.cos(a0) * rw, y: cy + Math.sin(a0) * rh },
                    to: { x: cx + Math.cos(a1) * rw, y: cy + Math.sin(a1) * rh },
                    color: { ...c }, thickness: t,
                });
            }
        }
    }

    clear(): void {
        this.path_ = [];
        this.lineCommands = [];
        this.fillCommands = [];
        this.filling_ = false;
    }

    flush(): void {
        for (const cmd of this.fillCommands) {
            switch (cmd.type) {
                case 'rect':
                    Draw.rect({ x: cmd.x, y: cmd.y }, { x: cmd.width, y: cmd.height }, cmd.color, true);
                    break;
                case 'circle':
                    Draw.circle({ x: cmd.x, y: cmd.y }, cmd.radius!, cmd.color, true, cmd.segments);
                    break;
            }
        }
        for (const cmd of this.lineCommands) {
            Draw.line(cmd.from, cmd.to, cmd.color, cmd.thickness);
        }
    }
}
