/**
 * @file    Splitter.ts
 * @brief   Draggable splitter for resizable panels
 */

export type SplitterDirection = 'horizontal' | 'vertical';

export interface SplitterOptions {
    direction: SplitterDirection;
    container: HTMLElement;
    leftPanel: HTMLElement;
    rightPanel: HTMLElement;
    minSize?: number;
    defaultPosition?: number;
    onResize?: (leftSize: number, rightSize: number) => void;
}

export class Splitter {
    private container_: HTMLElement;
    private leftPanel_: HTMLElement;
    private rightPanel_: HTMLElement;
    private splitter_: HTMLElement;
    private direction_: SplitterDirection;
    private minSize_: number;
    private isDragging_ = false;
    private startPos_ = 0;
    private startLeftSize_ = 0;
    private startRightSize_ = 0;
    private onResize_?: (leftSize: number, rightSize: number) => void;
    private boundOnMouseMove_!: (e: MouseEvent) => void;
    private boundOnMouseUp_!: () => void;

    constructor(options: SplitterOptions) {
        this.container_ = options.container;
        this.leftPanel_ = options.leftPanel;
        this.rightPanel_ = options.rightPanel;
        this.direction_ = options.direction;
        this.minSize_ = options.minSize ?? 200;
        this.onResize_ = options.onResize;

        this.splitter_ = document.createElement('div');
        this.splitter_.className = `es-splitter es-splitter-${this.direction_}`;

        this.insertSplitter();
        this.setupEvents();

        if (options.defaultPosition) {
            this.setPosition(options.defaultPosition);
        }
    }

    private insertSplitter(): void {
        this.leftPanel_.insertAdjacentElement('afterend', this.splitter_);
    }

    private setupEvents(): void {
        this.splitter_.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.boundOnMouseMove_ = (e: MouseEvent) => this.onMouseMove(e);
        this.boundOnMouseUp_ = () => this.onMouseUp();
        document.addEventListener('mousemove', this.boundOnMouseMove_);
        document.addEventListener('mouseup', this.boundOnMouseUp_);
    }

    private onMouseDown(e: MouseEvent): void {
        e.preventDefault();
        this.isDragging_ = true;

        this.startPos_ = this.direction_ === 'horizontal' ? e.clientX : e.clientY;
        this.startLeftSize_ = this.getSize(this.leftPanel_);
        this.startRightSize_ = this.getSize(this.rightPanel_);

        document.body.style.cursor = this.direction_ === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isDragging_) return;

        const currentPos = this.direction_ === 'horizontal' ? e.clientX : e.clientY;
        const delta = currentPos - this.startPos_;

        const newLeftSize = this.startLeftSize_ + delta;
        const newRightSize = this.startRightSize_ - delta;

        if (newLeftSize >= this.minSize_ && newRightSize >= this.minSize_) {
            this.setSize(this.leftPanel_, newLeftSize);
            this.setSize(this.rightPanel_, newRightSize);

            if (this.onResize_) {
                this.onResize_(newLeftSize, newRightSize);
            }
        }
    }

    private onMouseUp(): void {
        if (!this.isDragging_) return;

        this.isDragging_ = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    private getSize(element: HTMLElement): number {
        if (this.direction_ === 'horizontal') {
            return element.offsetWidth;
        } else {
            return element.offsetHeight;
        }
    }

    private setSize(element: HTMLElement, size: number): void {
        if (this.direction_ === 'horizontal') {
            element.style.width = `${size}px`;
        } else {
            element.style.height = `${size}px`;
        }
    }

    setPosition(leftSize: number): void {
        const totalSize = this.getSize(this.container_);
        const rightSize = totalSize - leftSize - this.getSplitterSize();

        if (leftSize >= this.minSize_ && rightSize >= this.minSize_) {
            this.setSize(this.leftPanel_, leftSize);
            this.setSize(this.rightPanel_, rightSize);
        }
    }

    private getSplitterSize(): number {
        return this.direction_ === 'horizontal'
            ? this.splitter_.offsetWidth
            : this.splitter_.offsetHeight;
    }

    getLeftSize(): number {
        return this.getSize(this.leftPanel_);
    }

    getRightSize(): number {
        return this.getSize(this.rightPanel_);
    }

    dispose(): void {
        document.removeEventListener('mousemove', this.boundOnMouseMove_);
        document.removeEventListener('mouseup', this.boundOnMouseUp_);
        this.splitter_.remove();
    }
}
