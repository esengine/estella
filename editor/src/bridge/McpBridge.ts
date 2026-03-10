import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import type { OutputService, OutputType } from '../services/OutputService';
import type { ScriptService } from '../services/ScriptService';
import type { BuildHistory } from '../builder/BuildHistory';
import { getEditorStore } from '../store/EditorStore';
import { getSharedRenderContext } from '../renderer/SharedRenderContext';
import { getPlayModeService } from '../services/PlayModeService';
import { getAllMenus, getMenuItems } from '../menus/MenuRegistry';
import { getAllPanels } from '../panels/PanelRegistry';
import { exportSettings, getSettingsValue } from '../settings/SettingsRegistry';
import { PropertyCommand } from '../commands/PropertyCommand';
import type { SceneData, EntityData } from '../types/SceneTypes';
import { RingBuffer } from './RingBuffer';

const LOG_BUFFER_CAPACITY = 500;

interface LogEntry {
    level: OutputType;
    message: string;
    timestamp: number;
}

interface McpRequest {
    id: string;
    method: string;
    params: Record<string, unknown>;
}

export class McpBridge {
    private logBuffer_ = new RingBuffer<LogEntry>(LOG_BUFFER_CAPACITY);
    private unlisten_: UnlistenFn | null = null;
    private logCleanup_: (() => void) | null = null;

    constructor(
        private outputService_: OutputService,
        private scriptService_: ScriptService,
        private buildHistory_: BuildHistory | null,
        private projectPath_: string | null = null,
    ) {
        this.setupLogCapture_();
        this.setupEventListener_();
        this.startBridgeServer_();
    }

    dispose(): void {
        this.logCleanup_?.();
        this.unlisten_?.();
    }

    private setupLogCapture_(): void {
        this.logCleanup_ = this.outputService_.registerOutputHandler(
            (text: string, type: OutputType) => {
                this.logBuffer_.push({
                    level: type,
                    message: text,
                    timestamp: Date.now(),
                });
            },
        );
    }

    private startBridgeServer_(): void {
        import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('start_bridge_server', {
                projectPath: this.projectPath_,
            }).then((port) => {
                console.log(`[McpBridge] Bridge server started on port ${port}`);
            }).catch((e) => {
                console.warn('[McpBridge] Failed to start bridge server:', e);
            });
        }).catch(() => {});
    }

    private setupEventListener_(): void {
        listen<McpRequest>('mcp-request', (event) => {
            this.handleRequest_(event.payload);
        }).then((fn) => {
            this.unlisten_ = fn;
        });
    }

    private async handleRequest_(req: McpRequest): Promise<void> {
        const responseEvent = `mcp-response-${req.id}`;
        try {
            const result = await this.dispatch_(req.method, req.params);
            emit(responseEvent, { ok: true, data: result });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            emit(responseEvent, { ok: false, error: msg });
        }
    }

    private async dispatch_(method: string, params: Record<string, unknown>): Promise<unknown> {
        switch (method) {
            case 'getSceneTree': return this.getSceneTree_(params.depth as number | undefined);
            case 'getEntityData': return this.getEntityData_(params);
            case 'getSelection': return this.getSelection_();
            case 'findEntities': return this.findEntities_(params.query as string);
            case 'getConsoleLogs': return this.getConsoleLogs_(params);
            case 'getPanelLayout': return this.getPanelLayout_();
            case 'getProjectSettings': return this.getProjectSettings_(params.keys as string[] | undefined);
            case 'getBuildStatus': return this.getBuildStatus_();
            case 'getRenderStats': return this.getRenderStats_();
            case 'getElementBounds': return this.getElementBounds_(params.selector as string);
            case 'capture': return this.capture_(params);
            case 'selectEntity': return this.selectEntity_(params);
            case 'setProperty': return this.setProperty_(params);
            case 'executeMenu': return this.executeMenu_(params.id as string);
            case 'togglePlayMode': return this.togglePlayMode_();
            case 'saveScene': return this.saveScene_();
            case 'reloadScripts': return this.reloadScripts_();
            default: throw new Error(`Unknown method: ${method}`);
        }
    }

    // =========================================================================
    // Scene & Entity
    // =========================================================================

    private getSceneTree_(depth?: number): unknown {
        const store = getEditorStore();
        const entities = store.state.scene.entities;
        const maxDepth = depth ?? 999;

        const childMap = new Map<number | null, EntityData[]>();
        for (const e of entities) {
            const parent = e.parent ?? null;
            if (!childMap.has(parent)) childMap.set(parent, []);
            childMap.get(parent)!.push(e);
        }

        const buildTree = (parentId: number | null, currentDepth: number): unknown[] => {
            const children = childMap.get(parentId) ?? [];
            return children.map(e => ({
                id: e.id,
                name: e.name,
                components: e.components.map(c => c.type),
                ...(currentDepth < maxDepth
                    ? { children: buildTree(e.id, currentDepth + 1) }
                    : {}),
            }));
        };

        return { entities: buildTree(null, 0) };
    }

    private getEntityData_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const entity = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (entity == null) throw new Error(`Entity not found`);
        const data = store.getEntityData(entity);
        if (!data) throw new Error(`Entity data not found: ${entity}`);
        const components: Record<string, unknown> = {};
        for (const c of data.components) {
            components[c.type] = c.data;
        }
        return { id: data.id, name: data.name, parent: data.parent, components };
    }

    private getSelection_(): unknown {
        const store = getEditorStore();
        const selected = [...store.selectedEntities].map(id => {
            const data = store.getEntityData(id);
            return { id, name: data?.name ?? '' };
        });
        const asset = store.state.selectedAsset;
        return { entities: selected, asset: asset ?? null };
    }

    private findEntities_(query: string): unknown {
        const store = getEditorStore();
        const lowerQuery = query.toLowerCase();
        const results = store.state.scene.entities.filter(e => {
            if (e.name.toLowerCase().includes(lowerQuery)) return true;
            return e.components.some(c => c.type.toLowerCase() === lowerQuery);
        });
        return results.map(e => ({
            id: e.id,
            name: e.name,
            components: e.components.map(c => c.type),
        }));
    }

    // =========================================================================
    // State
    // =========================================================================

    private getConsoleLogs_(params: Record<string, unknown>): unknown {
        const count = (params.count as number) ?? 50;
        const level = params.level as string | undefined;
        let logs = this.logBuffer_.recent(count);
        if (level) {
            logs = logs.filter(l => l.level === level);
        }
        return logs;
    }

    private getPanelLayout_(): unknown {
        const panels = getAllPanels();
        return panels.map(p => ({
            id: p.id,
            title: p.title,
            position: p.position,
            defaultVisible: p.defaultVisible ?? true,
        }));
    }

    private getProjectSettings_(keys?: string[]): unknown {
        if (!keys) return exportSettings();
        const result: Record<string, unknown> = {};
        for (const k of keys) {
            result[k] = getSettingsValue(k);
        }
        return result;
    }

    private getBuildStatus_(): unknown {
        if (!this.buildHistory_) return { entries: [] };
        return { entries: this.buildHistory_.getRecentBuilds(20) };
    }

    private getRenderStats_(): unknown {
        const ctx = getSharedRenderContext();
        const app = (ctx as any).app_;
        if (!app) return { frameTimeMs: 0, phaseTimings: [], systemTimings: [] };

        const phaseMap = app.getPhaseTimings?.() as Map<string, number> | undefined;
        const systemMap = app.getSystemTimings?.() as ReadonlyMap<string, number> | undefined;

        const phaseTimings = phaseMap ? [...phaseMap.entries()] : [];
        const systemTimings = systemMap ? [...systemMap.entries()] : [];
        const frameTimeMs = phaseTimings.reduce((a, [, b]) => a + b, 0);

        return { frameTimeMs, phaseTimings, systemTimings };
    }

    private getElementBounds_(selector: string): unknown {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }

    // =========================================================================
    // Capture
    // =========================================================================

    private async capture_(params: Record<string, unknown>): Promise<unknown> {
        const panel = params.panel as string | undefined;
        const maxWidth = params.maxWidth as number | undefined;

        if (panel === 'scene' || panel === 'game' || !panel) {
            return this.captureWebGL_(maxWidth);
        }
        return this.captureDomPanel_(panel, maxWidth);
    }

    private captureWebGL_(maxWidth?: number): Promise<unknown> {
        const ctx = getSharedRenderContext();
        return new Promise((resolve, reject) => {
            const prevCallback = (ctx as any).postTickCallback_ ?? null;

            ctx.setPostTickCallback(() => {
                ctx.setPostTickCallback(prevCallback);
                try {
                    const gl = (ctx as any).gl_ as WebGL2RenderingContext;
                    const canvas = (ctx as any).webglCanvas_ as HTMLCanvasElement;
                    if (!gl || !canvas) {
                        reject(new Error('WebGL context not available'));
                        return;
                    }
                    const w = canvas.width;
                    const h = canvas.height;
                    const pixels = new Uint8Array(w * h * 4);
                    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    flipY(pixels, w, h);

                    const outCanvas = document.createElement('canvas');
                    let outW = w;
                    let outH = h;
                    if (maxWidth && w > maxWidth) {
                        outW = maxWidth;
                        outH = Math.round(h * (maxWidth / w));
                    }
                    outCanvas.width = outW;
                    outCanvas.height = outH;

                    const tmpCanvas = document.createElement('canvas');
                    tmpCanvas.width = w;
                    tmpCanvas.height = h;
                    const tmpCtx = tmpCanvas.getContext('2d')!;
                    const imageData = tmpCtx.createImageData(w, h);
                    imageData.data.set(pixels);
                    tmpCtx.putImageData(imageData, 0, 0);

                    const outCtx = outCanvas.getContext('2d')!;
                    outCtx.drawImage(tmpCanvas, 0, 0, outW, outH);

                    resolve({ dataUrl: outCanvas.toDataURL('image/png') });
                } catch (e) {
                    reject(e);
                }
            });

            ctx.requestRender();
        });
    }

    private async captureDomPanel_(panelId: string, maxWidth?: number): Promise<unknown> {
        const selector = `[data-panel-id="${panelId}"]`;
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) throw new Error(`Panel not found: ${panelId}`);

        try {
            const modName = 'html2' + 'canvas';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await (Function('m', 'return import(m)') as (m: string) => Promise<any>)(modName);
            const html2canvas = mod.default ?? mod;
            const canvas = await html2canvas(el, {
                scale: 1,
                useCORS: true,
                logging: false,
            }) as HTMLCanvasElement;

            if (maxWidth && canvas.width > maxWidth) {
                const ratio = maxWidth / canvas.width;
                const outCanvas = document.createElement('canvas');
                outCanvas.width = maxWidth;
                outCanvas.height = Math.round(canvas.height * ratio);
                const ctx = outCanvas.getContext('2d')!;
                ctx.drawImage(canvas, 0, 0, outCanvas.width, outCanvas.height);
                return { dataUrl: outCanvas.toDataURL('image/png') };
            }

            return { dataUrl: canvas.toDataURL('image/png') };
        } catch {
            throw new Error(`Failed to capture panel: ${panelId}. html2canvas may not be available.`);
        }
    }

    // =========================================================================
    // Actions
    // =========================================================================

    private selectEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const entity = params.entity;
        const id = typeof entity === 'string'
            ? this.resolveEntityByName_(entity)
            : entity as number;
        if (id == null) throw new Error(`Entity not found: ${entity}`);
        store.selectEntity(id);
        return { ok: true, resolvedId: id };
    }

    private setProperty_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const entityRef = params.entity;
        const id = typeof entityRef === 'string'
            ? this.resolveEntityByName_(entityRef)
            : entityRef as number;
        if (id == null) throw new Error(`Entity not found: ${entityRef}`);

        const scene = store.state.scene;
        const entityMap = new Map<number, EntityData>(scene.entities.map(e => [e.id, e]));
        const entityData = entityMap.get(id);
        if (!entityData) throw new Error(`Entity data not found: ${id}`);

        const componentType = params.component as string;
        const field = params.field as string;
        const comp = entityData.components.find(c => c.type === componentType);
        if (!comp) throw new Error(`Component not found: ${componentType}`);

        const oldValue = (comp.data as Record<string, unknown>)[field];
        const newValue = params.value;

        const cmd = new PropertyCommand(
            scene, entityMap, id, componentType, field, oldValue, newValue,
        );
        store.executeCommand(cmd);
        return { ok: true };
    }

    private executeMenu_(id: string): unknown {
        const menus = getAllMenus();
        for (const menu of menus) {
            const items = getMenuItems(menu.id);
            const found = items.find(i => i.id === id);
            if (found) {
                if (found.enabled && !found.enabled()) {
                    throw new Error(`Menu item disabled: ${id}`);
                }
                found.action();
                return { ok: true };
            }
        }
        throw new Error(`Menu item not found: ${id}`);
    }

    private async togglePlayMode_(): Promise<unknown> {
        const playService = getPlayModeService();
        if (playService.state === 'stopped') {
            await playService.enter();
            return { mode: 'play' };
        } else {
            await playService.exit();
            return { mode: 'edit' };
        }
    }

    private saveScene_(): unknown {
        const menus = getAllMenus();
        for (const menu of menus) {
            const items = getMenuItems(menu.id);
            const saveItem = items.find(i => i.id === 'file.save');
            if (saveItem) {
                saveItem.action();
                const store = getEditorStore();
                return { ok: true, path: store.filePath };
            }
        }
        throw new Error('Save menu item not found');
    }

    private async reloadScripts_(): Promise<unknown> {
        const success = await this.scriptService_.reload();
        return { ok: true, success };
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private resolveEntity_(id?: number, name?: string): number | null {
        if (id != null) return id;
        if (name != null) return this.resolveEntityByName_(name);
        return null;
    }

    private resolveEntityByName_(name: string): number | null {
        const store = getEditorStore();
        const entity = store.state.scene.entities.find(e => e.name === name);
        return entity ? entity.id : null;
    }
}

function flipY(pixels: Uint8Array, width: number, height: number): void {
    const rowSize = width * 4;
    const temp = new Uint8Array(rowSize);
    for (let y = 0; y < height / 2; y++) {
        const topOffset = y * rowSize;
        const bottomOffset = (height - 1 - y) * rowSize;
        temp.set(pixels.subarray(topOffset, topOffset + rowSize));
        pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
        pixels.set(temp, bottomOffset);
    }
}
