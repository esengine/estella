export enum ScreenOrientation {
    Portrait = 'portrait',
    Landscape = 'landscape',
}

export class ScreenInfo {
    width = 0;
    height = 0;
    dpr = 1;
    orientation: ScreenOrientation = ScreenOrientation.Portrait;

    onOrientationChange: ((orientation: ScreenOrientation) => void) | null = null;
    onResize: ((width: number, height: number) => void) | null = null;

    private initialized_ = false;

    update(width: number, height: number, dpr: number = 1): void {
        const newOrientation = width > height ? ScreenOrientation.Landscape : ScreenOrientation.Portrait;
        const orientationChanged = this.initialized_ && newOrientation !== this.orientation;

        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.orientation = newOrientation;
        this.initialized_ = true;

        this.onResize?.(width, height);

        if (orientationChanged) {
            this.onOrientationChange?.(this.orientation);
        }
    }
}
