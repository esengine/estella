import type { App } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import type { EditorBridge } from '../bridge/EditorBridge';

export type PanelPosition = 'left' | 'right' | 'center' | 'bottom';

export interface PanelDescriptor {
    id: string;
    title: string;
    icon?: string;
    position: PanelPosition;
    defaultVisible?: boolean;
    order?: number;
    factory: PanelFactory;
}

export type PanelFactory = (container: HTMLElement, store: EditorStore) => PanelInstance;

export interface PanelInstance {
    dispose(): void;
    onShow?(): void;
    onHide?(): void;
}

export interface Resizable {
    resize(): void;
}

export interface BridgeAware {
    setBridge(bridge: EditorBridge): void;
}

export interface AppAware {
    setApp(app: App): void;
}

export interface AssetServerProvider {
    readonly assetServer: unknown;
}

export interface AssetNavigable {
    navigateToAsset(path: string): Promise<void>;
}

export interface OutputAppendable {
    appendOutput(text: string, type: 'command' | 'stdout' | 'stderr' | 'error' | 'success'): void;
    clear(): void;
}

export function isResizable(p: PanelInstance): p is PanelInstance & Resizable {
    return typeof (p as any).resize === 'function';
}

export function isBridgeAware(p: PanelInstance): p is PanelInstance & BridgeAware {
    return typeof (p as any).setBridge === 'function';
}

export function isAppAware(p: PanelInstance): p is PanelInstance & AppAware {
    return typeof (p as any).setApp === 'function';
}

export function isAssetServerProvider(p: PanelInstance): p is PanelInstance & AssetServerProvider {
    return 'assetServer' in p;
}

export function isAssetNavigable(p: PanelInstance): p is PanelInstance & AssetNavigable {
    return typeof (p as any).navigateToAsset === 'function';
}

export function isOutputAppendable(p: PanelInstance): p is PanelInstance & OutputAppendable {
    return typeof (p as any).appendOutput === 'function';
}

const panels = new Map<string, PanelDescriptor>();

export function registerPanel(descriptor: PanelDescriptor): void {
    panels.set(descriptor.id, descriptor);
}

export function getPanel(id: string): PanelDescriptor | undefined {
    return panels.get(id);
}

export function getAllPanels(): PanelDescriptor[] {
    return Array.from(panels.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getPanelsByPosition(position: PanelPosition): PanelDescriptor[] {
    return getAllPanels().filter(p => p.position === position);
}
