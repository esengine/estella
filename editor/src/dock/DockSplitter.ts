export type SplitterDirection = 'horizontal' | 'vertical';

export interface DockSplitterOptions {
    direction: SplitterDirection;
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    onDoubleClick?: () => void;
}

export class DockSplitter {
    readonly element: HTMLElement;
    private direction_: SplitterDirection;
    private onResize_: (delta: number) => void;
    private onResizeEnd_?: () => void;
    private overlay_: HTMLElement | null = null;
    private startPos_ = 0;
    private lastPos_ = 0;

    private onMouseMove_: (e: MouseEvent) => void;
    private onMouseUp_: (e: MouseEvent) => void;

    constructor(options: DockSplitterOptions) {
        this.direction_ = options.direction;
        this.onResize_ = options.onResize;
        this.onResizeEnd_ = options.onResizeEnd;

        this.element = document.createElement('div');
        this.element.className = `es-dock-splitter es-splitter-${options.direction === 'vertical' ? 'v' : 'h'}`;

        this.onMouseMove_ = this.handleMouseMove_.bind(this);
        this.onMouseUp_ = this.handleMouseUp_.bind(this);

        this.element.addEventListener('mousedown', this.handleMouseDown_.bind(this));

        if (options.onDoubleClick) {
            this.element.addEventListener('dblclick', options.onDoubleClick);
        }
    }

    setVisible(visible: boolean): void {
        this.element.style.display = visible ? '' : 'none';
    }

    private handleMouseDown_(e: MouseEvent): void {
        if (e.button !== 0) return;
        e.preventDefault();

        this.startPos_ = this.direction_ === 'vertical' ? e.clientX : e.clientY;
        this.lastPos_ = this.startPos_;

        this.element.classList.add('es-dock-splitter-active');

        this.overlay_ = document.createElement('div');
        this.overlay_.className = 'es-dock-drag-overlay';
        this.overlay_.style.cursor = this.direction_ === 'vertical' ? 'col-resize' : 'row-resize';
        document.body.appendChild(this.overlay_);

        document.addEventListener('mousemove', this.onMouseMove_);
        document.addEventListener('mouseup', this.onMouseUp_);
    }

    private handleMouseMove_(e: MouseEvent): void {
        const pos = this.direction_ === 'vertical' ? e.clientX : e.clientY;
        const delta = pos - this.lastPos_;
        if (delta !== 0) {
            this.onResize_(delta);
            this.lastPos_ = pos;
        }
    }

    private handleMouseUp_(_e: MouseEvent): void {
        document.removeEventListener('mousemove', this.onMouseMove_);
        document.removeEventListener('mouseup', this.onMouseUp_);

        this.element.classList.remove('es-dock-splitter-active');

        if (this.overlay_) {
            this.overlay_.remove();
            this.overlay_ = null;
        }

        this.onResizeEnd_?.();
    }

    dispose(): void {
        document.removeEventListener('mousemove', this.onMouseMove_);
        document.removeEventListener('mouseup', this.onMouseUp_);
        this.overlay_?.remove();
        this.element.remove();
    }
}
