import { getEditorContainer } from '../container';
import { PANEL } from '../container/tokens';

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

export interface PanelFactoryResult {
    instance: PanelInstance;
}

export type PanelFactory = (container: HTMLElement) => PanelFactoryResult;

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
    return getEditorContainer().getOrdered(PANEL);
}

export function getPanelsByPosition(position: PanelPosition): PanelDescriptor[] {
    return getAllPanels().filter(p => p.position === position);
}
