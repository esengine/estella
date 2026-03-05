import type { App } from 'esengine';
import type { SpineModuleController } from 'esengine/spine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';
import type { EditorAssetServer } from '../asset/EditorAssetServer';
import { getEditorContainer } from '../container';
import { PANEL } from '../container/tokens';

export type PanelPosition = 'left' | 'right' | 'center' | 'bottom';

export interface PanelDescriptor {
    id: string;
    title: string;
    icon?: string;
    position: PanelPosition;
    defaultVisible?: boolean;
    detachOnly?: boolean;
    order?: number;
    factory: PanelFactory;
}

export interface PanelHooks {
    setBridge?: (bridge: EditorBridge) => void;
    setApp?: (app: App | null) => void;
    resize?: () => void;
    getAssetServer?: () => EditorAssetServer | null;
    navigateToAsset?: (path: string) => Promise<void>;
    appendOutput?: (text: string, type: string) => void;
    setSpineController?: (ctrl: SpineModuleController | null) => void;
    getSpineSkeletonInfo?: (entityId: number) => { animations: string[]; skins: string[] } | null;
    onSpineInstanceReady?: (listener: (entityId: number) => void) => () => void;
    saveAsset?: () => Promise<boolean>;
    isDirty?: () => boolean;
}

export interface PanelFactoryResult {
    instance: PanelInstance;
    hooks?: PanelHooks;
}

export type PanelFactory = (container: HTMLElement, store: EditorStore) => PanelFactoryResult;

export interface PanelInstance {
    dispose(): void;
    onShow?(): void;
    onHide?(): void;
}

export function registerPanel(descriptor: PanelDescriptor): void {
    getEditorContainer().provide(PANEL, descriptor.id, descriptor);
}

export function getPanel(id: string): PanelDescriptor | undefined {
    return getEditorContainer().get(PANEL, id);
}

export function getAllPanels(): PanelDescriptor[] {
    return Array.from(getEditorContainer().getAll(PANEL).values())
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getPanelsByPosition(position: PanelPosition): PanelDescriptor[] {
    return getAllPanels().filter(p => p.position === position && !p.detachOnly);
}
