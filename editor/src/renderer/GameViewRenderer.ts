import type { ESEngineModule, CppRegistry, UICameraData } from 'esengine';
import { Renderer, UICameraInfo } from 'esengine';
import type { SharedRenderContext } from './SharedRenderContext';

const PROJECTION_ORTHOGRAPHIC = 1;

const _orthoM = new Float32Array(16);
function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
    const m = _orthoM;
    m.fill(0);
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;
    m[0]  = 2 / rl;
    m[5]  = 2 / tb;
    m[10] = -2 / fn;
    m[12] = -(right + left) / rl;
    m[13] = -(top + bottom) / tb;
    m[14] = -(far + near) / fn;
    m[15] = 1;
    return m;
}

const _perspM = new Float32Array(16);
function perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
    const m = _perspM;
    m.fill(0);
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = near - far;
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) / nf;
    m[11] = -1;
    m[14] = (2 * far * near) / nf;
    return m;
}

const _invTransM = new Float32Array(16);
function invertTranslation(x: number, y: number, z: number): Float32Array {
    const m = _invTransM;
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = -x; m[13] = -y; m[14] = -z; m[15] = 1;
    return m;
}

const _mulM = new Float32Array(16);
function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const m = _mulM;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            m[j * 4 + i] =
                a[0 * 4 + i] * b[j * 4 + 0] +
                a[1 * 4 + i] * b[j * 4 + 1] +
                a[2 * 4 + i] * b[j * 4 + 2] +
                a[3 * 4 + i] * b[j * 4 + 3];
        }
    }
    return m;
}

const SCALE_FIXED_WIDTH = 0;
const SCALE_EXPAND = 2;
const SCALE_SHRINK = 3;
const SCALE_MATCH = 4;

function computeEffectiveOrthoSize(
    baseOrthoSize: number,
    designAspect: number,
    actualAspect: number,
    scaleMode: number,
    matchWidthOrHeight: number,
): number {
    const orthoForWidth = baseOrthoSize * designAspect / actualAspect;
    const orthoForHeight = baseOrthoSize;

    switch (scaleMode) {
        case SCALE_FIXED_WIDTH: return orthoForWidth;
        case SCALE_EXPAND: return Math.max(orthoForWidth, orthoForHeight);
        case SCALE_SHRINK: return Math.min(orthoForWidth, orthoForHeight);
        case SCALE_MATCH: {
            const t = matchWidthOrHeight;
            return Math.pow(orthoForWidth, 1 - t) * Math.pow(orthoForHeight, t);
        }
        default: return orthoForHeight;
    }
}

export class GameViewRenderer {
    private canvas2d_: HTMLCanvasElement;
    private ctx2d_: CanvasRenderingContext2D;
    private webglCanvas_: HTMLCanvasElement;
    private visible_ = false;
    private width_ = 0;
    private height_ = 0;
    private vpMatrix_ = new Float32Array(16);
    private worldLeft_ = 0;
    private worldRight_ = 0;
    private worldBottom_ = 0;
    private worldTop_ = 0;

    constructor(canvas2d: HTMLCanvasElement, webglCanvas: HTMLCanvasElement) {
        this.canvas2d_ = canvas2d;
        this.webglCanvas_ = webglCanvas;
        const ctx = canvas2d.getContext('2d');
        if (!ctx) throw new Error('Failed to create 2D context for GameViewRenderer');
        this.ctx2d_ = ctx;
    }

    get visible(): boolean {
        return this.visible_;
    }

    get width(): number {
        return this.width_;
    }

    get height(): number {
        return this.height_;
    }

    setSize(w: number, h: number): void {
        this.width_ = w;
        this.height_ = h;
        this.canvas2d_.width = w;
        this.canvas2d_.height = h;
    }

    setVisible(visible: boolean): void {
        this.visible_ = visible;
    }

    computeGameCameraVP(context: SharedRenderContext): boolean {
        const module = context.module_;
        const sceneManager = context.sceneManager_;
        if (!module || !sceneManager) return false;
        if (this.width_ <= 0 || this.height_ <= 0) return false;

        const registry = sceneManager.registry;
        const cameraEntities = module.registry_getCameraEntities(registry);
        if (cameraEntities.length === 0) return false;

        const e = cameraEntities[0];
        const camera = registry.getCamera(e);
        const transform = registry.getTransform(e);

        const width = this.width_;
        const height = this.height_;
        const aspect = width / height;

        let projection: Float32Array;

        const camX = transform.position.x;
        const camY = transform.position.y;

        if (camera.projectionType === PROJECTION_ORTHOGRAPHIC) {
            let halfH = camera.orthoSize;

            const canvasEntity = module.registry_getCanvasEntity(registry);
            if (canvasEntity >= 0) {
                const canvas = registry.getCanvas(canvasEntity);
                const baseOrthoSize = canvas.designResolution.y / 2;
                const designAspect = canvas.designResolution.x / canvas.designResolution.y;
                halfH = computeEffectiveOrthoSize(
                    baseOrthoSize, designAspect, aspect,
                    canvas.scaleMode, canvas.matchWidthOrHeight,
                );
            }

            const halfW = halfH * aspect;
            projection = ortho(-halfW, halfW, -halfH, halfH, -camera.farPlane, camera.farPlane);

            this.worldLeft_ = camX - halfW;
            this.worldRight_ = camX + halfW;
            this.worldBottom_ = camY - halfH;
            this.worldTop_ = camY + halfH;
        } else {
            projection = perspective(
                camera.fov * Math.PI / 180,
                aspect,
                camera.nearPlane,
                camera.farPlane,
            );
            this.worldLeft_ = 0;
            this.worldRight_ = 0;
            this.worldBottom_ = 0;
            this.worldTop_ = 0;
        }

        const view = invertTranslation(camX, camY, transform.position.z);
        this.vpMatrix_.set(multiply(projection, view));
        return true;
    }

    updateUICameraInfo(context: SharedRenderContext): void {
        if (!this.visible_ || this.width_ <= 0 || this.height_ <= 0) return;
        if (!this.computeGameCameraVP(context)) return;

        const cam = context.getUICameraInfo();
        if (!cam) return;

        cam.viewProjection.set(this.vpMatrix_);
        cam.vpX = 0;
        cam.vpY = 0;
        cam.vpW = this.width_;
        cam.vpH = this.height_;
        cam.screenW = this.width_;
        cam.screenH = this.height_;
        cam.worldLeft = this.worldLeft_;
        cam.worldRight = this.worldRight_;
        cam.worldBottom = this.worldBottom_;
        cam.worldTop = this.worldTop_;
        cam.valid = true;
    }

    renderAndCapture(context: SharedRenderContext): void {
        if (!this.visible_ || this.width_ <= 0 || this.height_ <= 0) return;
        if (!this.computeGameCameraVP(context)) return;

        const sceneManager = context.sceneManager_;
        if (!sceneManager || sceneManager.isBusy) return;

        const renderW = this.width_;
        const renderH = this.height_;

        const bg = this.findCanvasBackgroundColor(context);
        Renderer.setClearColor(bg.r, bg.g, bg.b, bg.a);

        const pipeline = context.pipeline_;
        const elapsed = context.elapsed;
        const cppReg = sceneManager.registry;
        const registry = { _cpp: cppReg };

        try {
            Renderer.setViewport(0, 0, renderW, renderH);
            Renderer.clearBuffers(3);
            Renderer.begin(this.vpMatrix_);
            if (pipeline?.maskProcessor) {
                pipeline.maskProcessor(registry._cpp, this.vpMatrix_, 0, 0, renderW, renderH);
            }
            Renderer.submitSprites(registry);
            Renderer.submitBitmapText(registry);
            if (pipeline?.spineRenderer) {
                pipeline.spineRenderer(registry, elapsed);
            } else {
                Renderer.submitSpine(registry);
            }
            Renderer.submitParticles(registry);
            Renderer.flush();
            Renderer.end();

            const srcY = this.webglCanvas_.height - renderH;
            this.ctx2d_.clearRect(0, 0, this.width_, this.height_);
            this.ctx2d_.drawImage(
                this.webglCanvas_,
                0, srcY, renderW, renderH,
                0, 0, this.width_, this.height_,
            );
        } catch (e) {
            if (e instanceof WebAssembly.RuntimeError) {
                console.warn('[GameViewRenderer] WASM error during render:', (e as Error).message);
            } else {
                throw e;
            }
        }
    }

    private findCanvasBackgroundColor(context: SharedRenderContext): { r: number; g: number; b: number; a: number } {
        const module = context.module_;
        const sceneManager = context.sceneManager_;
        if (module && sceneManager) {
            const registry = sceneManager.registry;
            const canvasEntity = module.registry_getCanvasEntity(registry);
            if (canvasEntity >= 0) {
                const canvas = registry.getCanvas(canvasEntity);
                const bg = canvas.backgroundColor;
                return { r: bg.x, g: bg.y, b: bg.z, a: bg.w };
            }
        }
        return { r: 0.1, g: 0.1, b: 0.1, a: 1.0 };
    }

    getDesignResolution(context: SharedRenderContext): { x: number; y: number } | null {
        const module = context.module_;
        const sceneManager = context.sceneManager_;
        if (!module || !sceneManager) return null;
        const registry = sceneManager.registry;
        const canvasEntity = module.registry_getCanvasEntity(registry);
        if (canvasEntity < 0) return null;
        const canvas = registry.getCanvas(canvasEntity);
        const x = canvas.designResolution.x;
        const y = canvas.designResolution.y;
        if (x <= 0 || y <= 0) return null;
        return { x, y };
    }

    dispose(): void {
        this.visible_ = false;
    }
}
