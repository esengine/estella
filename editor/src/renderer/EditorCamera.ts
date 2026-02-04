/**
 * @file    EditorCamera.ts
 * @brief   Editor camera with pan/zoom support for scene view
 */

// =============================================================================
// EditorCamera
// =============================================================================

export class EditorCamera {
    /** Pan offset in world units */
    panX: number = 0;
    panY: number = 0;

    /** Zoom level (1.0 = 100%, 2.0 = 200%, 0.5 = 50%) */
    zoom: number = 1;

    /** Minimum zoom level */
    minZoom: number = 0.1;

    /** Maximum zoom level */
    maxZoom: number = 10;

    /**
     * @brief Get view-projection matrix for orthographic rendering
     * @param viewportWidth Viewport width in pixels
     * @param viewportHeight Viewport height in pixels
     * @returns Column-major 4x4 matrix as Float32Array
     */
    getViewProjection(viewportWidth: number, viewportHeight: number): Float32Array {
        const halfWidth = (viewportWidth / 2) / this.zoom;
        const halfHeight = (viewportHeight / 2) / this.zoom;

        const left = -halfWidth - this.panX;
        const right = halfWidth - this.panX;
        const bottom = -halfHeight + this.panY;
        const top = halfHeight + this.panY;

        const near = -1000;
        const far = 1000;

        const matrix = new Float32Array(16);

        matrix[0] = 2 / (right - left);
        matrix[1] = 0;
        matrix[2] = 0;
        matrix[3] = 0;

        matrix[4] = 0;
        matrix[5] = 2 / (top - bottom);
        matrix[6] = 0;
        matrix[7] = 0;

        matrix[8] = 0;
        matrix[9] = 0;
        matrix[10] = -2 / (far - near);
        matrix[11] = 0;

        matrix[12] = -(right + left) / (right - left);
        matrix[13] = -(top + bottom) / (top - bottom);
        matrix[14] = -(far + near) / (far - near);
        matrix[15] = 1;

        return matrix;
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

        const halfWidth = (viewportWidth / 2) / this.zoom;
        const halfHeight = (viewportHeight / 2) / this.zoom;

        const worldX = ndcX * halfWidth + this.panX;
        const worldY = ndcY * halfHeight + this.panY;

        return { x: worldX, y: worldY };
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
        const halfWidth = (viewportWidth / 2) / this.zoom;
        const halfHeight = (viewportHeight / 2) / this.zoom;

        const ndcX = (worldX - this.panX) / halfWidth;
        const ndcY = (worldY - this.panY) / halfHeight;

        const screenX = (ndcX + 1) / 2 * viewportWidth;
        const screenY = (1 - ndcY) / 2 * viewportHeight;

        return { x: screenX, y: screenY };
    }

    /**
     * @brief Pan by screen delta
     */
    pan(deltaScreenX: number, deltaScreenY: number, viewportWidth: number, viewportHeight: number): void {
        const worldDeltaX = (deltaScreenX / viewportWidth) * (viewportWidth / this.zoom);
        const worldDeltaY = (deltaScreenY / viewportHeight) * (viewportHeight / this.zoom);

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
