import type { GraphState, GraphNodeLayout, ViewTransform, SelectedTransition } from './GraphState';
import { showContextMenu } from '../../ui/ContextMenu';
import {
    COLORS,
    GRID_SIZE,
    GRID_DOT_RADIUS,
    BEZIER_CONTROL_X,
    BEZIER_CONTROL_Y,
    MIN_ZOOM,
    MAX_ZOOM,
    ZOOM_SPEED,
    NODE_BORDER_RADIUS,
    NODE_FONT_SIZE,
    NODE_SUBTITLE_FONT_SIZE,
    CONNECTION_HIT_TOLERANCE,
    CONNECTOR_RADIUS,
    CONNECTOR_HOVER_MARGIN,
} from './graphConstants';

export interface GraphCanvasCallbacks {
    onSelectionChanged?(): void;
    onNodeDragged?(name: string, x: number, y: number): void;
    onNodeDragEnd?(): void;
    onConnectionCreated?(from: string, to: string): void;
    onDeleteSelection?(): void;
    onAddState?(worldX: number, worldY: number): void;
    onRenameNode?(name: string): void;
    onSetInitialState?(name: string): void;
    onAddAnyState?(worldX: number, worldY: number): void;
    onAddExitState?(worldX: number, worldY: number): void;
}

const MULTI_TRANSITION_OFFSET = 8;

export class GraphCanvas {
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private resizeObserver_: ResizeObserver;
    private state_: GraphState;
    private callbacks_: GraphCanvasCallbacks;
    private disposed_ = false;

    private isPanning_ = false;
    private isDragging_ = false;
    private isConnecting_ = false;
    private dragStartWorldX_ = 0;
    private dragStartWorldY_ = 0;
    private dragNodeStartPositions_ = new Map<string, { x: number; y: number }>();
    private panStartX_ = 0;
    private panStartY_ = 0;
    private panStartVx_ = 0;
    private panStartVy_ = 0;
    private spaceDown_ = false;
    private hoveredConnector_: string | null = null;

    private nodeSubtitles_ = new Map<string, string>();
    private lastCanvasW_ = 0;
    private lastCanvasH_ = 0;
    private resizeRafId_ = 0;

    private boundMouseMove_ = (e: MouseEvent) => this.onMouseMove(e);
    private boundMouseUp_ = (e: MouseEvent) => this.onMouseUp(e);
    private boundHoverMove_ = (e: MouseEvent) => this.onHoverMove(e);

    constructor(container: HTMLElement, state: GraphState, callbacks: GraphCanvasCallbacks = {}) {
        this.state_ = state;
        this.callbacks_ = callbacks;

        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'es-sm-graph-canvas';
        this.canvas_.tabIndex = 0;
        this.canvas_.style.position = 'absolute';
        this.canvas_.style.inset = '0';
        this.canvas_.style.width = '100%';
        this.canvas_.style.height = '100%';
        this.canvas_.style.display = 'block';
        this.canvas_.style.outline = 'none';
        container.appendChild(this.canvas_);
        this.ctx_ = this.canvas_.getContext('2d')!;

        this.resizeObserver_ = new ResizeObserver(() => {
            if (this.resizeRafId_) return;
            this.resizeRafId_ = requestAnimationFrame(() => {
                this.resizeRafId_ = 0;
                this.resizeCanvas();
            });
        });
        this.resizeObserver_.observe(container);

        this.canvas_.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas_.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas_.addEventListener('mousemove', this.boundHoverMove_);
        this.canvas_.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas_.addEventListener('keydown', (e) => this.onKeyDown(e));
        this.canvas_.addEventListener('keyup', (e) => this.onKeyUp(e));
        this.canvas_.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        this.resizeCanvas();
    }

    get canvas(): HTMLCanvasElement {
        return this.canvas_;
    }

    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        if (this.resizeRafId_) cancelAnimationFrame(this.resizeRafId_);
        this.resizeObserver_.disconnect();
        document.removeEventListener('mousemove', this.boundMouseMove_);
        document.removeEventListener('mouseup', this.boundMouseUp_);
    }

    setNodeSubtitle(name: string, subtitle: string): void {
        this.nodeSubtitles_.set(name, subtitle);
    }

    clearSubtitles(): void {
        this.nodeSubtitles_.clear();
    }

    draw(): void {
        if (this.disposed_) return;
        this.resizeCanvas();

        const ctx = this.ctx_;
        const w = this.canvas_.clientWidth;
        const h = this.canvas_.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, w, h);

        const vt = this.state_.viewTransform;

        this.drawGrid(ctx, w, h, vt);
        this.drawEntryConnection(ctx, vt);
        this.drawTransitions(ctx, vt);
        this.drawPendingConnection(ctx, vt);
        this.drawNodes(ctx, vt);
        this.drawConnectors(ctx, vt);
    }

    private screenToWorld(sx: number, sy: number): { x: number; y: number } {
        const vt = this.state_.viewTransform;
        return {
            x: (sx - vt.x) / vt.zoom,
            y: (sy - vt.y) / vt.zoom,
        };
    }

    private getMousePos(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas_.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    private resizeCanvas(): void {
        const rect = this.canvas_.parentElement!.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w === 0 || h === 0) return;
        if (w === this.lastCanvasW_ && h === this.lastCanvasH_) return;
        this.lastCanvasW_ = w;
        this.lastCanvasH_ = h;
        const dpr = window.devicePixelRatio || 1;
        this.canvas_.width = w * dpr;
        this.canvas_.height = h * dpr;
        this.ctx_.scale(dpr, dpr);
        this.draw();
    }

    // =========================================================================
    // Drawing
    // =========================================================================

    private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, vt: ViewTransform): void {
        const gridSize = GRID_SIZE * vt.zoom;
        if (gridSize < 5) return;

        const offsetX = vt.x % gridSize;
        const offsetY = vt.y % gridSize;

        ctx.fillStyle = COLORS.gridDot;
        for (let x = offsetX; x < w; x += gridSize) {
            for (let y = offsetY; y < h; y += gridSize) {
                ctx.beginPath();
                ctx.arc(x, y, GRID_DOT_RADIUS, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    private drawEntryConnection(ctx: CanvasRenderingContext2D, vt: ViewTransform): void {
        const entryLayout = this.state_.nodeLayouts.get('__entry__');
        if (!entryLayout) return;

        const initialState = this.state_.initialStateName;
        if (!initialState) return;

        const targetLayout = this.state_.nodeLayouts.get(initialState);
        if (!targetLayout) return;

        this.drawBezierConnection(ctx, vt, entryLayout, targetLayout, COLORS.entryBorder, 2, 0);
    }

    private drawTransitions(ctx: CanvasRenderingContext2D, vt: ViewTransform): void {
        const pairCounts = new Map<string, number>();
        const pairIndex = new Map<string, number>();

        for (const t of this.state_.transitions) {
            const key = [t.from, t.target].sort().join('->');
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }

        for (const t of this.state_.transitions) {
            const fromLayout = this.state_.nodeLayouts.get(t.from);
            const toLayout = this.state_.nodeLayouts.get(t.target);
            if (!fromLayout || !toLayout) continue;

            const key = [t.from, t.target].sort().join('->');
            const count = pairCounts.get(key) ?? 1;
            const idx = pairIndex.get(key) ?? 0;
            pairIndex.set(key, idx + 1);

            const offset = count > 1
                ? (idx - (count - 1) / 2) * MULTI_TRANSITION_OFFSET
                : 0;

            const isSelected = this.state_.selectedTransition !== null
                && this.state_.selectedTransition.from === t.from
                && this.state_.selectedTransition.index === t.index;

            const color = isSelected ? COLORS.connectionSelected : COLORS.connectionLine;
            const lineWidth = isSelected ? 2.5 : 1.5;

            this.drawBezierConnection(ctx, vt, fromLayout, toLayout, color, lineWidth, offset);
        }
    }

    private drawBezierConnection(
        ctx: CanvasRenderingContext2D,
        vt: ViewTransform,
        from: GraphNodeLayout,
        to: GraphNodeLayout,
        color: string,
        lineWidth: number,
        offset: number,
    ): void {
        const fromCx = from.x + from.width / 2;
        const fromCy = from.y + from.height / 2;
        const toCx = to.x + to.width / 2;
        const toCy = to.y + to.height / 2;

        const fromEdge = this.clipToNodeEdge(fromCx, fromCy, toCx, toCy, from);
        const toEdge = this.clipToNodeEdge(toCx, toCy, fromCx, fromCy, to);

        let sx1 = fromEdge.x * vt.zoom + vt.x;
        let sy1 = fromEdge.y * vt.zoom + vt.y;
        let sx2 = toEdge.x * vt.zoom + vt.x;
        let sy2 = toEdge.y * vt.zoom + vt.y;

        if (offset !== 0) {
            const dx = sx2 - sx1;
            const dy = sy2 - sy1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) {
                const nx = -dy / len;
                const ny = dx / len;
                sx1 += nx * offset;
                sy1 += ny * offset;
                sx2 += nx * offset;
                sy2 += ny * offset;
            }
        }

        const dx = sx2 - sx1;
        const dy = sy2 - sy1;

        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.bezierCurveTo(
            sx1 + dx * BEZIER_CONTROL_X, sy1 + dy * BEZIER_CONTROL_Y,
            sx2 - dx * BEZIER_CONTROL_X, sy2 - dy * BEZIER_CONTROL_Y,
            sx2, sy2,
        );
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        this.drawArrow(ctx, sx2, sy2, dx, dy, color);
    }

    private drawPendingConnection(ctx: CanvasRenderingContext2D, vt: ViewTransform): void {
        const pending = this.state_.pendingConnection;
        if (!pending) return;

        const fromLayout = this.state_.nodeLayouts.get(pending.from);
        if (!fromLayout) return;

        const fromCx = fromLayout.x + fromLayout.width / 2;
        const fromCy = fromLayout.y + fromLayout.height / 2;
        const fromEdge = this.clipToNodeEdge(fromCx, fromCy, pending.mouseX, pending.mouseY, fromLayout);

        const sx1 = fromEdge.x * vt.zoom + vt.x;
        const sy1 = fromEdge.y * vt.zoom + vt.y;

        const rect = this.canvas_.getBoundingClientRect();
        const sx2 = pending.mouseX;
        const sy2 = pending.mouseY;

        const dx = sx2 - sx1;
        const dy = sy2 - sy1;

        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.bezierCurveTo(
            sx1 + dx * BEZIER_CONTROL_X, sy1,
            sx2 - dx * BEZIER_CONTROL_X, sy2,
            sx2, sy2,
        );
        ctx.strokeStyle = COLORS.connectionPending;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        this.drawArrow(ctx, sx2, sy2, dx, dy, COLORS.connectionPending);
    }

    private drawConnectors(ctx: CanvasRenderingContext2D, vt: ViewTransform): void {
        if (!this.hoveredConnector_) return;

        const layout = this.state_.nodeLayouts.get(this.hoveredConnector_);
        if (!layout) return;

        const rightX = (layout.x + layout.width) * vt.zoom + vt.x;
        const leftX = layout.x * vt.zoom + vt.x;
        const cy = (layout.y + layout.height / 2) * vt.zoom + vt.y;

        this.drawConnectorDot(ctx, rightX, cy, COLORS.connectorFill);
        this.drawConnectorDot(ctx, leftX, cy, COLORS.connectorFill);
    }

    private drawConnectorDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
        ctx.beginPath();
        ctx.arc(cx, cy, CONNECTOR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = COLORS.connectorStroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    private clipToNodeEdge(cx: number, cy: number, tx: number, ty: number, node: GraphNodeLayout): { x: number; y: number } {
        const hw = node.width / 2;
        const hh = node.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;
        if (dx === 0 && dy === 0) return { x: cx, y: cy };
        const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
        const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
        const s = Math.min(sx, sy);
        return { x: cx + dx * s, y: cy + dy * s };
    }

    private drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string): void {
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return;
        const ux = dx / len;
        const uy = dy / len;
        const size = 8;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - ux * size + uy * size * 0.4, y - uy * size - ux * size * 0.4);
        ctx.lineTo(x - ux * size - uy * size * 0.4, y - uy * size + ux * size * 0.4);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    private drawNodes(ctx: CanvasRenderingContext2D, vt: ViewTransform): void {
        for (const [name, layout] of this.state_.nodeLayouts) {
            const sx = layout.x * vt.zoom + vt.x;
            const sy = layout.y * vt.zoom + vt.y;
            const sw = layout.width * vt.zoom;
            const sh = layout.height * vt.zoom;

            const isEntry = name === '__entry__';
            const isAny = name === '__any__';
            const isExit = name === '__exit__';
            const isSpecial = isEntry || isAny || isExit;
            const isSelected = this.state_.selectedNodes.has(name);
            const isActive = this.state_.isPlayMode && this.state_.activeStateName === name;

            const fillColor = isEntry ? COLORS.entryFill : isAny ? COLORS.anyFill : isExit ? COLORS.exitFill : COLORS.nodeFill;
            const borderColor = isActive
                ? COLORS.playModeActive
                : isSelected
                    ? COLORS.nodeSelectedBorder
                    : isEntry ? COLORS.entryBorder : isAny ? COLORS.anyBorder : isExit ? COLORS.exitBorder : COLORS.nodeBorder;
            const textColor = isEntry ? COLORS.entryText : isAny ? COLORS.anyText : isExit ? COLORS.exitText : COLORS.nodeText;

            const r = Math.min(NODE_BORDER_RADIUS * vt.zoom, sh / 2);

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 4 * vt.zoom;
            ctx.shadowOffsetY = 2 * vt.zoom;
            ctx.beginPath();
            this.roundRect(ctx, sx, sy, sw, sh, r);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.restore();

            ctx.beginPath();
            this.roundRect(ctx, sx, sy, sw, sh, r);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isActive ? 2.5 : isSelected ? 2 : 1;
            ctx.stroke();

            const subtitle = isSpecial ? '' : (this.nodeSubtitles_.get(name) ?? '');
            const hasSubtitle = subtitle.length > 0;

            const fontSize = (isSpecial ? NODE_SUBTITLE_FONT_SIZE : NODE_FONT_SIZE) * vt.zoom;
            ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const displayName = isEntry ? 'Entry' : isAny ? 'Any' : isExit ? 'Exit' : name;
            const nameY = hasSubtitle ? sy + sh * 0.38 : sy + sh / 2;
            ctx.fillText(displayName, sx + sw / 2, nameY, sw - 12 * vt.zoom);

            if (hasSubtitle) {
                const subFontSize = NODE_SUBTITLE_FONT_SIZE * vt.zoom;
                ctx.font = `${subFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.fillStyle = COLORS.nodeSubtext;
                ctx.fillText(subtitle, sx + sw / 2, sy + sh * 0.66, sw - 12 * vt.zoom);
            }
        }
    }

    private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // =========================================================================
    // Hit Testing
    // =========================================================================

    private hitTestNode(worldX: number, worldY: number): string | null {
        for (const [name, layout] of this.state_.nodeLayouts) {
            if (
                worldX >= layout.x && worldX <= layout.x + layout.width &&
                worldY >= layout.y && worldY <= layout.y + layout.height
            ) {
                return name;
            }
        }
        return null;
    }

    private hitTestTransition(screenX: number, screenY: number): SelectedTransition | null {
        const vt = this.state_.viewTransform;
        const ctx = this.ctx_;
        const dpr = window.devicePixelRatio || 1;

        for (const t of this.state_.transitions) {
            const fromLayout = this.state_.nodeLayouts.get(t.from);
            const toLayout = this.state_.nodeLayouts.get(t.target);
            if (!fromLayout || !toLayout) continue;

            const fromCx = fromLayout.x + fromLayout.width / 2;
            const fromCy = fromLayout.y + fromLayout.height / 2;
            const toCx = toLayout.x + toLayout.width / 2;
            const toCy = toLayout.y + toLayout.height / 2;

            const fromEdge = this.clipToNodeEdge(fromCx, fromCy, toCx, toCy, fromLayout);
            const toEdge = this.clipToNodeEdge(toCx, toCy, fromCx, fromCy, toLayout);

            const sx1 = fromEdge.x * vt.zoom + vt.x;
            const sy1 = fromEdge.y * vt.zoom + vt.y;
            const sx2 = toEdge.x * vt.zoom + vt.x;
            const sy2 = toEdge.y * vt.zoom + vt.y;

            const dx = sx2 - sx1;
            const dy = sy2 - sy1;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.beginPath();
            ctx.moveTo(sx1 * dpr, sy1 * dpr);
            ctx.bezierCurveTo(
                (sx1 + dx * 0.3) * dpr, (sy1 + dy * 0.05) * dpr,
                (sx2 - dx * 0.3) * dpr, (sy2 - dy * 0.05) * dpr,
                sx2 * dpr, sy2 * dpr,
            );
            ctx.lineWidth = CONNECTION_HIT_TOLERANCE * 2 * dpr;
            const hit = ctx.isPointInStroke(screenX * dpr, screenY * dpr);
            ctx.restore();

            if (hit) {
                return { from: t.from, index: t.index };
            }
        }
        return null;
    }

    private isNearNodeEdge(worldX: number, worldY: number): string | null {
        for (const [name, layout] of this.state_.nodeLayouts) {
            if (name === '__entry__' || name === '__exit__') continue;
            const cy = layout.y + layout.height / 2;
            const dy = worldY - cy;
            if (Math.abs(dy) > layout.height / 2 + CONNECTOR_HOVER_MARGIN) continue;

            const rightEdge = layout.x + layout.width;
            const leftEdge = layout.x;
            const dxRight = Math.abs(worldX - rightEdge);
            const dxLeft = Math.abs(worldX - leftEdge);

            if (dxRight <= CONNECTOR_HOVER_MARGIN || dxLeft <= CONNECTOR_HOVER_MARGIN) {
                return name;
            }
        }
        return null;
    }

    // =========================================================================
    // Events
    // =========================================================================

    private onHoverMove(e: MouseEvent): void {
        if (this.isPanning_ || this.isDragging_ || this.isConnecting_) return;

        const { x: sx, y: sy } = this.getMousePos(e);
        const world = this.screenToWorld(sx, sy);
        const nearEdge = this.isNearNodeEdge(world.x, world.y);

        if (nearEdge !== this.hoveredConnector_) {
            this.hoveredConnector_ = nearEdge;
            this.canvas_.style.cursor = nearEdge ? 'crosshair' : 'default';
            this.draw();
        }
    }

    private onMouseDown(e: MouseEvent): void {
        this.canvas_.focus();

        if (e.button === 1 || (e.button === 0 && this.spaceDown_)) {
            this.startPan(e);
            e.preventDefault();
            return;
        }

        if (e.button === 0) {
            const { x: sx, y: sy } = this.getMousePos(e);
            const world = this.screenToWorld(sx, sy);

            if (this.hoveredConnector_) {
                this.isConnecting_ = true;
                this.state_.pendingConnection = {
                    from: this.hoveredConnector_,
                    mouseX: sx,
                    mouseY: sy,
                };
                document.addEventListener('mousemove', this.boundMouseMove_);
                document.addEventListener('mouseup', this.boundMouseUp_);
                this.draw();
                e.preventDefault();
                return;
            }

            const hitNode = this.hitTestNode(world.x, world.y);

            if (hitNode) {
                if (e.shiftKey) {
                    if (this.state_.selectedNodes.has(hitNode)) {
                        this.state_.selectedNodes.delete(hitNode);
                    } else {
                        this.state_.selectedNodes.add(hitNode);
                    }
                } else if (!this.state_.selectedNodes.has(hitNode)) {
                    this.state_.selectedNodes.clear();
                    this.state_.selectedNodes.add(hitNode);
                }
                this.state_.selectedTransition = null;
                this.callbacks_.onSelectionChanged?.();

                this.isDragging_ = true;
                this.dragStartWorldX_ = world.x;
                this.dragStartWorldY_ = world.y;
                this.dragNodeStartPositions_.clear();
                for (const name of this.state_.selectedNodes) {
                    const layout = this.state_.nodeLayouts.get(name);
                    if (layout) {
                        this.dragNodeStartPositions_.set(name, { x: layout.x, y: layout.y });
                    }
                }

                document.addEventListener('mousemove', this.boundMouseMove_);
                document.addEventListener('mouseup', this.boundMouseUp_);
                this.draw();
                e.preventDefault();
                return;
            }

            const hitTransition = this.hitTestTransition(sx, sy);
            if (hitTransition) {
                this.state_.selectedNodes.clear();
                this.state_.selectedTransition = hitTransition;
                this.callbacks_.onSelectionChanged?.();
                this.draw();
                e.preventDefault();
                return;
            }

            this.state_.selectedNodes.clear();
            this.state_.selectedTransition = null;
            this.callbacks_.onSelectionChanged?.();
            this.draw();
        }
    }

    private onMouseMove(e: MouseEvent): void {
        if (this.isPanning_) {
            const vt = this.state_.viewTransform;
            vt.x = this.panStartVx_ + (e.clientX - this.panStartX_);
            vt.y = this.panStartVy_ + (e.clientY - this.panStartY_);
            this.draw();
            return;
        }

        if (this.isConnecting_ && this.state_.pendingConnection) {
            const { x: sx, y: sy } = this.getMousePos(e);
            this.state_.pendingConnection.mouseX = sx;
            this.state_.pendingConnection.mouseY = sy;
            this.draw();
            return;
        }

        if (this.isDragging_) {
            const { x: sx, y: sy } = this.getMousePos(e);
            const world = this.screenToWorld(sx, sy);
            const dx = world.x - this.dragStartWorldX_;
            const dy = world.y - this.dragStartWorldY_;

            for (const [name, startPos] of this.dragNodeStartPositions_) {
                const layout = this.state_.nodeLayouts.get(name);
                if (layout) {
                    layout.x = startPos.x + dx;
                    layout.y = startPos.y + dy;
                    this.callbacks_.onNodeDragged?.(name, layout.x, layout.y);
                }
            }
            this.draw();
        }
    }

    private onMouseUp(e: MouseEvent): void {
        if (this.isPanning_) {
            this.isPanning_ = false;
            document.removeEventListener('mousemove', this.boundMouseMove_);
            document.removeEventListener('mouseup', this.boundMouseUp_);
            this.canvas_.style.cursor = this.spaceDown_ ? 'grab' : 'default';
            return;
        }

        if (this.isConnecting_ && this.state_.pendingConnection) {
            const { x: sx, y: sy } = this.getMousePos(e);
            const world = this.screenToWorld(sx, sy);
            const targetNode = this.hitTestNode(world.x, world.y);

            if (targetNode && targetNode !== this.state_.pendingConnection.from && targetNode !== '__entry__' && targetNode !== '__any__') {
                this.callbacks_.onConnectionCreated?.(this.state_.pendingConnection.from, targetNode);
            }

            this.state_.pendingConnection = null;
            this.isConnecting_ = false;
            this.hoveredConnector_ = null;
            document.removeEventListener('mousemove', this.boundMouseMove_);
            document.removeEventListener('mouseup', this.boundMouseUp_);
            this.canvas_.style.cursor = 'default';
            this.draw();
            return;
        }

        if (this.isDragging_) {
            this.isDragging_ = false;
            this.dragNodeStartPositions_.clear();
            document.removeEventListener('mousemove', this.boundMouseMove_);
            document.removeEventListener('mouseup', this.boundMouseUp_);
            this.callbacks_.onNodeDragEnd?.();
        }
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        const rect = this.canvas_.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const vt = this.state_.viewTransform;
        const oldZoom = vt.zoom;
        const delta = -e.deltaY * ZOOM_SPEED;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * (1 + delta)));

        vt.x = mx - (mx - vt.x) * (newZoom / oldZoom);
        vt.y = my - (my - vt.y) * (newZoom / oldZoom);
        vt.zoom = newZoom;

        this.draw();
    }

    private onDoubleClick(e: MouseEvent): void {
        const { x: sx, y: sy } = this.getMousePos(e);
        const world = this.screenToWorld(sx, sy);
        const hitNode = this.hitTestNode(world.x, world.y);

        if (hitNode && hitNode !== '__entry__' && hitNode !== '__any__' && hitNode !== '__exit__') {
            this.callbacks_.onRenameNode?.(hitNode);
        } else if (!hitNode) {
            this.callbacks_.onAddState?.(world.x, world.y);
        }
    }

    private onContextMenu(e: MouseEvent): void {
        e.preventDefault();
        const { x: sx, y: sy } = this.getMousePos(e);
        const world = this.screenToWorld(sx, sy);
        const hitNode = this.hitTestNode(world.x, world.y);

        if (hitNode && hitNode !== '__entry__' && hitNode !== '__any__' && hitNode !== '__exit__') {
            const isInitial = this.state_.initialStateName === hitNode;
            const items = [
                { label: 'Rename', onClick: () => this.callbacks_.onRenameNode?.(hitNode) },
                ...(!isInitial ? [{ label: 'Set as Initial State', onClick: () => this.callbacks_.onSetInitialState?.(hitNode) }] : []),
                { label: 'Delete', onClick: () => {
                    this.state_.selectedNodes.clear();
                    this.state_.selectedNodes.add(hitNode);
                    this.callbacks_.onDeleteSelection?.();
                }},
            ];
            showContextMenu({
                x: e.clientX,
                y: e.clientY,
                items,
            });
        } else {
            const hasAny = this.state_.nodeLayouts.has('__any__');
            const hasExit = this.state_.nodeLayouts.has('__exit__');
            const items = [
                { label: 'Add State', onClick: () => this.callbacks_.onAddState?.(world.x, world.y) },
                ...(!hasAny ? [{ label: 'Add Any State', onClick: () => this.callbacks_.onAddAnyState?.(world.x, world.y) }] : []),
                ...(!hasExit ? [{ label: 'Add Exit State', onClick: () => this.callbacks_.onAddExitState?.(world.x, world.y) }] : []),
            ];
            showContextMenu({
                x: e.clientX,
                y: e.clientY,
                items,
            });
        }
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.code === 'Space' && !this.spaceDown_) {
            this.spaceDown_ = true;
            this.canvas_.style.cursor = 'grab';
            e.preventDefault();
            return;
        }

        if (e.code === 'Delete' || e.code === 'Backspace') {
            if (this.state_.selectedNodes.size > 0 || this.state_.selectedTransition) {
                this.callbacks_.onDeleteSelection?.();
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }

    private onKeyUp(e: KeyboardEvent): void {
        if (e.code === 'Space') {
            this.spaceDown_ = false;
            if (!this.isPanning_) {
                this.canvas_.style.cursor = 'default';
            }
        }
    }

    private startPan(e: MouseEvent): void {
        this.isPanning_ = true;
        this.panStartX_ = e.clientX;
        this.panStartY_ = e.clientY;
        this.panStartVx_ = this.state_.viewTransform.x;
        this.panStartVy_ = this.state_.viewTransform.y;
        this.canvas_.style.cursor = 'grabbing';
        document.addEventListener('mousemove', this.boundMouseMove_);
        document.addEventListener('mouseup', this.boundMouseUp_);
    }
}
