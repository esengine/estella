import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import type { OutputService, OutputType } from '../services/OutputService';
import type { ScriptService } from '../services/ScriptService';
import type { BuildHistory } from '../builder/BuildHistory';
import { getEditorStore } from '../store/EditorStore';
import { getSharedRenderContext } from '../renderer/SharedRenderContext';
import { getEditorContainer } from '../container';
import { GAME_VIEW_SERVICE } from '../container/tokens';
import { getAllMenus, getMenuItems } from '../menus/MenuRegistry';
import { getAllPanels } from '../panels/PanelRegistry';
import { exportSettings, getSettingsValue } from '../settings/SettingsRegistry';
import { PropertyCommand } from '../commands/PropertyCommand';
import { getInitialComponentData, getAllComponentSchemas, getComponentsByCategory, getComponentSchema } from '../schemas/ComponentSchemas';
import { getAssetDatabase, type AssetEntry } from '../asset/AssetDatabase';
import { getSceneService, getClipboardService } from '../services';
import { getEditorContext } from '../context/EditorContext';
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
            case 'createEntity': return this.createEntity_(params);
            case 'deleteEntity': return this.deleteEntity_(params);
            case 'renameEntity': return this.renameEntity_(params);
            case 'reparentEntity': return this.reparentEntity_(params);
            case 'addComponent': return this.addComponent_(params);
            case 'removeComponent': return this.removeComponent_(params);
            case 'duplicateEntity': return this.duplicateEntity_(params);
            case 'selectEntity': return this.selectEntity_(params);
            case 'setProperty': return this.setProperty_(params);
            case 'executeMenu': return this.executeMenu_(params.id as string);
            case 'togglePlayMode': return this.togglePlayMode_();
            case 'saveScene': return this.saveScene_();
            case 'reloadScripts': return this.reloadScripts_();
            case 'undo': return this.undo_();
            case 'redo': return this.redo_();
            case 'listAssets': return this.listAssets_(params);
            case 'getAssetInfo': return this.getAssetInfo_(params);
            case 'listComponents': return this.listComponents_();
            case 'getComponentSchema': return this.getComponentSchema_(params.name as string);
            case 'listMenus': return this.listMenus_();
            case 'getSceneMetadata': return this.getSceneMetadata_();
            case 'toggleVisibility': return this.toggleVisibility_(params);
            case 'newScene': return this.newScene_();
            case 'openScene': return this.openScene_(params.path as string);
            case 'instantiatePrefab': return this.instantiatePrefab_(params);
            case 'createScript': return this.createScript_(params);
            case 'getTimelineData': return this.getTimelineData_(params);
            case 'updateTimelineData': return this.updateTimelineData_(params);
            case 'getAssetMeta': return this.getAssetMeta_(params);
            case 'updateAssetMeta': return this.updateAssetMeta_(params);
            case 'ensureAssetMeta': return this.ensureAssetMeta_(params);
            case 'createAsset': return this.createAsset_(params);
            case 'deleteAsset': return this.deleteAsset_(params);
            case 'renameAsset': return this.renameAsset_(params);
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
    // Entity CRUD
    // =========================================================================

    private createEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const name = (params.name as string) ?? 'Entity';
        const parentRef = params.parent;
        const parent = parentRef == null ? null
            : typeof parentRef === 'string' ? this.resolveEntityByName_(parentRef)
            : parentRef as number;
        const entity = store.createEntity(name, parent);

        const components = params.components as Array<{ type: string; data?: Record<string, unknown> }> | undefined;
        if (components) {
            for (const comp of components) {
                const defaults = getInitialComponentData(comp.type);
                store.addComponent(entity, comp.type, { ...defaults, ...comp.data });
            }
        }

        getSharedRenderContext().requestRender();
        return { ok: true, entityId: entity };
    }

    private deleteEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        store.deleteEntity(id);
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private renameEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        const newName = params.newName as string;
        if (!newName) throw new Error('newName is required');
        store.renameEntity(id, newName);
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private reparentEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        const parentRef = params.newParent;
        const newParent = parentRef == null ? null
            : typeof parentRef === 'string' ? this.resolveEntityByName_(parentRef)
            : parentRef as number;
        store.reparentEntity(id, newParent);
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private addComponent_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        const componentType = params.component as string;
        if (!componentType) throw new Error('component type is required');
        const defaults = getInitialComponentData(componentType);
        const data = params.data as Record<string, unknown> | undefined;
        store.addComponent(id, componentType, { ...defaults, ...data });
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private removeComponent_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        const componentType = params.component as string;
        if (!componentType) throw new Error('component type is required');
        store.removeComponent(id, componentType);
        getSharedRenderContext().requestRender();
        return { ok: true };
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
        getSharedRenderContext().requestRender();
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
        getSharedRenderContext().requestRender();
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
                getSharedRenderContext().requestRender();
                return { ok: true };
            }
        }
        throw new Error(`Menu item not found: ${id}`);
    }

    private async togglePlayMode_(): Promise<unknown> {
        const gameView = getEditorContainer().get(GAME_VIEW_SERVICE, 'default');
        if (!gameView) throw new Error('Game view not available');
        if (gameView.gameState === 'stopped') {
            await gameView.play();
            return { mode: 'play' };
        } else {
            await gameView.stop();
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
        getSharedRenderContext().requestRender();
        return { ok: true, success };
    }

    private duplicateEntity_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        store.selectEntity(id);
        getClipboardService().duplicateSelected();
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private undo_(): unknown {
        const store = getEditorStore();
        if (!store.canUndo) throw new Error('Nothing to undo');
        store.undo();
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private redo_(): unknown {
        const store = getEditorStore();
        if (!store.canRedo) throw new Error('Nothing to redo');
        store.redo();
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    // =========================================================================
    // Assets & Components
    // =========================================================================

    private listAssets_(params: Record<string, unknown>): unknown {
        const db = getAssetDatabase();
        const typeFilter = params.type as string | undefined;
        const results: Array<{ uuid: string; path: string; type: string }> = [];
        for (const entry of db.getAllEntries()) {
            if (typeFilter && entry.type !== typeFilter) continue;
            results.push({ uuid: entry.uuid, path: entry.path, type: entry.type });
        }
        return results;
    }

    private getAssetInfo_(params: Record<string, unknown>): unknown {
        const db = getAssetDatabase();
        const uuid = params.uuid as string | undefined;
        const path = params.path as string | undefined;
        const entry = uuid ? db.getEntry(uuid) : path ? db.getEntryByPath(path) : undefined;
        if (!entry) throw new Error('Asset not found');
        return {
            uuid: entry.uuid,
            path: entry.path,
            type: entry.type,
            address: entry.address,
            group: entry.group,
            labels: [...entry.labels],
            fileSize: entry.fileSize,
        };
    }

    private listComponents_(): unknown {
        const byCategory = getComponentsByCategory();
        const result: Record<string, string[]> = {};
        for (const [category, schemas] of Object.entries(byCategory)) {
            result[category] = schemas.map((s: { name: string }) => s.name);
        }
        return result;
    }

    private getComponentSchema_(name: string): unknown {
        if (!name) throw new Error('name is required');
        const schema = getComponentSchema(name);
        if (!schema) throw new Error(`Component not found: ${name}`);
        const defaults = getInitialComponentData(name);
        return {
            name: schema.name,
            category: schema.category,
            displayName: schema.displayName ?? schema.name,
            description: schema.description ?? null,
            removable: schema.removable !== false,
            requires: schema.requires ?? [],
            conflicts: schema.conflicts ?? [],
            defaults,
            properties: schema.properties.map(p => ({
                name: p.name,
                type: p.type,
                displayName: p.displayName ?? p.name,
                tooltip: p.tooltip ?? null,
                readOnly: p.readOnly ?? false,
                min: p.min ?? null,
                max: p.max ?? null,
                step: p.step ?? null,
                options: p.options ?? null,
            })),
        };
    }

    private listMenus_(): unknown {
        const menus = getAllMenus();
        return menus.map(menu => ({
            id: menu.id,
            label: menu.label,
            items: getMenuItems(menu.id)
                .filter(i => !i.hidden)
                .map(i => ({
                    id: i.id,
                    label: i.label,
                    shortcut: i.shortcut ?? null,
                    separator: i.separator ?? false,
                    enabled: i.enabled ? i.enabled() : true,
                })),
        }));
    }

    private getSceneMetadata_(): unknown {
        const store = getEditorStore();
        const scene = store.scene;
        const designWidth = getSettingsValue<number>('project.designWidth') ?? 1080;
        const designHeight = getSettingsValue<number>('project.designHeight') ?? 1920;
        return {
            name: scene.name,
            filePath: store.filePath,
            isDirty: store.isDirty,
            entityCount: scene.entities.length,
            designResolution: { width: designWidth, height: designHeight },
            canUndo: store.canUndo,
            canRedo: store.canRedo,
            undoDescription: store.undoDescription ?? null,
            redoDescription: store.redoDescription ?? null,
        };
    }

    private toggleVisibility_(params: Record<string, unknown>): unknown {
        const store = getEditorStore();
        const id = this.resolveEntity_(params.id as number | undefined, params.name as string | undefined);
        if (id == null) throw new Error('Entity not found');
        store.toggleVisibility(id);
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    // =========================================================================
    // Scene
    // =========================================================================

    private async newScene_(): Promise<unknown> {
        const sceneService = getSceneService();
        await sceneService.newScene();
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private async openScene_(path: string): Promise<unknown> {
        if (!path) throw new Error('path is required');
        const sceneService = getSceneService();
        await sceneService.openSceneFromPath(path);
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private async instantiatePrefab_(params: Record<string, unknown>): Promise<unknown> {
        const store = getEditorStore();
        const prefabPath = params.path as string;
        if (!prefabPath) throw new Error('path is required');
        const parentRef = params.parent;
        const parent = parentRef == null ? null
            : typeof parentRef === 'string' ? this.resolveEntityByName_(parentRef)
            : parentRef as number;
        const entity = await store.instantiatePrefab(prefabPath, parent);
        if (entity == null) throw new Error('Failed to instantiate prefab');
        getSharedRenderContext().requestRender();
        return { ok: true, entityId: entity };
    }

    private async createScript_(params: Record<string, unknown>): Promise<unknown> {
        const name = params.name as string;
        if (!name) throw new Error('name is required');
        const content = params.content as string | undefined;
        const dir = params.dir as string | undefined;

        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const scriptsDir = dir ? `${projectDir}/${dir}` : `${projectDir}/src`;
        const fileName = name.endsWith('.ts') ? name : `${name}.ts`;
        const filePath = `${scriptsDir}/${fileName}`;

        const scriptContent = content ?? [
            `import { defineComponent, defineSystem, PreUpdate, type World, type Entity } from 'esengine';`,
            ``,
            `export const ${name.replace(/\.ts$/, '')} = defineComponent('${name.replace(/\.ts$/, '')}', {`,
            `});`,
            ``,
        ].join('\n');

        await fs.writeFile(filePath, scriptContent);
        return { ok: true, path: filePath };
    }

    // =========================================================================
    // Timeline
    // =========================================================================

    private async getTimelineData_(params: Record<string, unknown>): Promise<unknown> {
        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const ref = params.path as string | undefined ?? params.uuid as string | undefined;
        if (!ref) throw new Error('path or uuid is required');

        const db = getAssetDatabase();
        const relativePath = this.resolveAssetPath_(ref, db);
        const absPath = `${projectDir}/${relativePath}`;

        const content = await fs.readFile(absPath);
        if (!content) throw new Error(`Timeline file not found: ${relativePath}`);
        return JSON.parse(content);
    }

    private async updateTimelineData_(params: Record<string, unknown>): Promise<unknown> {
        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const ref = params.path as string | undefined ?? params.uuid as string | undefined;
        if (!ref) throw new Error('path or uuid is required');

        const db = getAssetDatabase();
        const relativePath = this.resolveAssetPath_(ref, db);
        const absPath = `${projectDir}/${relativePath}`;

        const content = await fs.readFile(absPath);
        if (!content) throw new Error(`Timeline file not found: ${relativePath}`);
        const data = JSON.parse(content) as Record<string, unknown>;

        if (params.tracks !== undefined) data.tracks = params.tracks;
        if (params.duration !== undefined) data.duration = params.duration;
        if (params.wrapMode !== undefined) data.wrapMode = params.wrapMode;

        await fs.writeFile(absPath, JSON.stringify(data, null, 2));

        // Re-select to trigger timeline panel reload
        const store = getEditorStore();
        const selectedId = [...store.selectedEntities][0];
        if (selectedId != null) {
            store.selectEntity(null);
            store.selectEntity(selectedId);
        }
        getSharedRenderContext().requestRender();
        return { ok: true };
    }

    private resolveAssetPath_(ref: string, db: ReturnType<typeof getAssetDatabase>): string {
        const entry = db.getEntry(ref) ?? db.getEntryByPath(ref);
        if (entry) return entry.path;
        return ref;
    }

    // =========================================================================
    // Asset Meta
    // =========================================================================

    private getAssetMeta_(params: Record<string, unknown>): unknown {
        const db = getAssetDatabase();
        const uuid = params.uuid as string | undefined;
        const path = params.path as string | undefined;
        const entry = uuid ? db.getEntry(uuid) : path ? db.getEntryByPath(path) : undefined;
        if (!entry) throw new Error('Asset not found');
        return {
            uuid: entry.uuid,
            path: entry.path,
            type: entry.type,
            labels: [...entry.labels],
            address: entry.address,
            group: entry.group,
            importer: entry.importer,
            platformOverrides: entry.platformOverrides,
            fileSize: entry.fileSize,
            lastModified: entry.lastModified,
        };
    }

    private async updateAssetMeta_(params: Record<string, unknown>): Promise<unknown> {
        const db = getAssetDatabase();
        const uuid = params.uuid as string;
        if (!uuid) throw new Error('uuid is required');
        const entry = db.getEntry(uuid);
        if (!entry) throw new Error(`Asset not found: ${uuid}`);

        const updates: Partial<Pick<AssetEntry, 'labels' | 'address' | 'group' | 'importer' | 'platformOverrides'>> = {};
        if (params.labels !== undefined) updates.labels = new Set(params.labels as string[]);
        if (params.address !== undefined) updates.address = params.address as string | null;
        if (params.group !== undefined) updates.group = params.group as string;
        if (params.importer !== undefined) updates.importer = params.importer as Record<string, unknown>;
        if (params.platformOverrides !== undefined) updates.platformOverrides = params.platformOverrides as Record<string, Record<string, unknown>>;

        await db.updateMeta(uuid, updates);
        return { ok: true };
    }

    private async ensureAssetMeta_(params: Record<string, unknown>): Promise<unknown> {
        const db = getAssetDatabase();
        const path = params.path as string;
        if (!path) throw new Error('path is required');
        const uuid = await db.ensureMeta(path);
        const entry = db.getEntry(uuid);
        return {
            uuid,
            path: entry?.path ?? path,
            type: entry?.type ?? 'unknown',
            created: !params.path || !db.getEntryByPath(path),
        };
    }

    private async createAsset_(params: Record<string, unknown>): Promise<unknown> {
        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const assetType = params.type as string;
        const name = params.name as string;
        const dir = params.dir as string | undefined;
        if (!assetType || !name) throw new Error('type and name are required');

        const parentDir = dir ? `${projectDir}/${dir}` : `${projectDir}/assets`;
        let fileName: string;
        let content: string;

        switch (assetType) {
            case 'material':
                fileName = name.endsWith('.esmaterial') ? name : `${name}.esmaterial`;
                content = JSON.stringify({ shader: 'standard', properties: {} }, null, 2);
                break;
            case 'scene':
                fileName = name.endsWith('.esscene') ? name : `${name}.esscene`;
                content = JSON.stringify({
                    version: '2.0', name: name.replace(/\.esscene$/, ''),
                    entities: [],
                }, null, 2);
                break;
            case 'shader':
                fileName = name.endsWith('.esshader') ? name : `${name}.esshader`;
                content = [
                    'precision mediump float;',
                    'varying vec2 v_uv;',
                    'uniform sampler2D u_texture;',
                    '',
                    'void main() {',
                    '    gl_FragColor = texture2D(u_texture, v_uv);',
                    '}',
                ].join('\n');
                break;
            case 'anim-clip':
                fileName = name.endsWith('.esanim') ? name : `${name}.esanim`;
                content = JSON.stringify({ version: '1.0', frames: [], fps: 12 }, null, 2);
                break;
            case 'timeline':
                fileName = name.endsWith('.estimeline') ? name : `${name}.estimeline`;
                content = JSON.stringify({ version: '1.0', duration: 1, tracks: [] }, null, 2);
                break;
            case 'bitmap-font':
                fileName = name.endsWith('.bmfont') ? name : `${name}.bmfont`;
                content = JSON.stringify({ chars: {}, kernings: {}, common: { lineHeight: 32 } }, null, 2);
                break;
            default:
                throw new Error(`Unknown asset type: ${assetType}. Supported: material, scene, shader, anim-clip, timeline, bitmap-font`);
        }

        const filePath = `${parentDir}/${fileName}`;
        await fs.writeFile(filePath, content);

        const relativePath = filePath.replace(`${projectDir}/`, '');
        const db = getAssetDatabase();
        const uuid = await db.ensureMeta(relativePath);

        return { ok: true, path: filePath, relativePath, uuid };
    }

    private async deleteAsset_(params: Record<string, unknown>): Promise<unknown> {
        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const db = getAssetDatabase();

        const uuid = params.uuid as string | undefined;
        const path = params.path as string | undefined;
        const entry = uuid ? db.getEntry(uuid) : path ? db.getEntryByPath(path) : undefined;
        if (!entry) throw new Error('Asset not found');

        const fullPath = `${projectDir}/${entry.path}`;
        const metaPath = `${fullPath}.meta`;

        await fs.removeFile(fullPath);
        try { await fs.removeFile(metaPath); } catch { /* meta may not exist */ }
        db.unregister(entry.path);
        return { ok: true, deleted: entry.path };
    }

    private async renameAsset_(params: Record<string, unknown>): Promise<unknown> {
        const fs = getEditorContext().fs;
        if (!fs) throw new Error('File system not available');
        if (!this.projectPath_) throw new Error('No project path');

        const projectDir = this.projectPath_.replace(/\/[^/]+$/, '');
        const db = getAssetDatabase();

        const uuid = params.uuid as string | undefined;
        const path = params.path as string | undefined;
        const newName = params.newName as string;
        if (!newName) throw new Error('newName is required');

        const entry = uuid ? db.getEntry(uuid) : path ? db.getEntryByPath(path) : undefined;
        if (!entry) throw new Error('Asset not found');

        const oldFullPath = `${projectDir}/${entry.path}`;
        const dirPart = entry.path.replace(/\/[^/]+$/, '');
        const newRelativePath = `${dirPart}/${newName}`;
        const newFullPath = `${projectDir}/${newRelativePath}`;

        await fs.renameFile(oldFullPath, newFullPath);
        const oldMetaPath = `${oldFullPath}.meta`;
        const newMetaPath = `${newFullPath}.meta`;
        if (await fs.exists(oldMetaPath)) {
            await fs.renameFile(oldMetaPath, newMetaPath);
        }

        db.updatePath(entry.path, newRelativePath);
        return { ok: true, oldPath: entry.path, newPath: newRelativePath };
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
