/**
 * @file    EditorCamera.ts
 * @brief   Editor camera with pan/zoom support for scene view
 */

// =============================================================================
// EditorCamera
// =============================================================================

export class EditorCamera {
    panX: number = 0;
    panY: number = 0;
    zoom: number = 1;
    minZoom: number = 0.1;
    maxZoom: number = 10;
    orthoHalfHeight: number = 0;

    private matrix_ = new Float32Array(16);

    private getHalfSize(viewportWidth: number, viewportHeight: number): { halfW: number; halfH: number } {
        if (this.orthoHalfHeight > 0) {
            const halfH = this.orthoHalfHeight / this.zoom;
            return { halfW: halfH * (viewportWidth / viewportHeight), halfH };
        }
        return {
            halfW: (viewportWidth / 2) / this.zoom,
            halfH: (viewportHeight / 2) / this.zoom,
        };
    }

    getViewProjection(viewportWidth: number, viewportHeight: number): Float32Array {
        const { halfW, halfH } = this.getHalfSize(viewportWidth, viewportHeight);

        const left = -halfW - this.panX;
        const right = halfW - this.panX;
        const bottom = -halfH + this.panY;
        const top = halfH + this.panY;

        const near = -1000;
        const far = 1000;
        const m = this.matrix_;

        m[0] = 2 / (right - left);
        m[1] = 0;
        m[2] = 0;
        m[3] = 0;
        m[4] = 0;
        m[5] = 2 / (top - bottom);
        m[6] = 0;
        m[7] = 0;
        m[8] = 0;
        m[9] = 0;
        m[10] = -2 / (far - near);
        m[11] = 0;
        m[12] = -(right + left) / (right - left);
        m[13] = -(top + bottom) / (top - bottom);
        m[14] = -(far + near) / (far - near);
        m[15] = 1;

        return m;
    }

    /**
     * @brief Convert screen coordinates to world coordinates
     */
    screenToWorld(
        screenX: number,
        screenY: number,
        viewportWidth: number,
        viewportHeight: number
    ): { x: number; y: number } {
        const ndcX = (screenX / viewportWidth) * 2 - 1;
        const ndcY = 1 - (screenY / viewportHeight) * 2;

        const { halfW, halfH } = this.getHalfSize(viewportWidth, viewportHeight);

        return {
            x: ndcX * halfW + this.panX,
            y: ndcY * halfH + this.panY,
        };
    }

    /**
     * @brief Convert world coordinates to screen coordinates
     */
    worldToScreen(
        worldX: number,
        worldY: number,
        viewportWidth: number,
        viewportHeight: number
    ): { x: number; y: number } {
        const { halfW, halfH } = this.getHalfSize(viewportWidth, viewportHeight);

        const ndcX = (worldX - this.panX) / halfW;
        const ndcY = (worldY - this.panY) / halfH;

        return {
            x: (ndcX + 1) / 2 * viewportWidth,
            y: (1 - ndcY) / 2 * viewportHeight,
        };
    }

    /**
     * @brief Pan by screen delta
     */
    pan(deltaScreenX: number, deltaScreenY: number, viewportWidth: number, viewportHeight: number): void {
        const { halfW, halfH } = this.getHalfSize(viewportWidth, viewportHeight);
        const worldDeltaX = (deltaScreenX / viewportWidth) * (2 * halfW);
        const worldDeltaY = (deltaScreenY / viewportHeight) * (2 * halfH);

        this.panX -= worldDeltaX;
        this.panY += worldDeltaY;
    }

    /**
     * @brief Zoom at a specific screen point
     */
    zoomAt(factor: number, screenX: number, screenY: number, viewportWidth: number, viewportHeight: number): void {
        const worldBefore = this.screenToWorld(screenX, screenY, viewportWidth, viewportHeight);

        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));

        const worldAfter = this.screenToWorld(screenX, screenY, viewportWidth, viewportHeight);

        this.panX += worldBefore.x - worldAfter.x;
        this.panY += worldBefore.y - worldAfter.y;
    }

    /**
     * @brief Reset camera to default state
     */
    reset(): void {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
    }

    /**
     * @brief Focus on a specific world point
     */
    focusOn(worldX: number, worldY: number): void {
        this.panX = worldX;
        this.panY = worldY;
    }
}
