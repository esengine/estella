import type { Color, Vec2 } from './types';
import { Draw } from './draw';

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

    drawRoundRect(x: number, y: number, width: number, height: number, _radius: number): void {
        this.drawRect(x, y, width, height);
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
