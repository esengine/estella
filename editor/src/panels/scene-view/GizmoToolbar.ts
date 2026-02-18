import { GizmoManager, getAllGizmos } from '../../gizmos';
import { getSettingsValue, setSettingsValue, onSettingsChange } from '../../settings/SettingsRegistry';
import { icons } from '../../utils/icons';

export class GizmoToolbar {
    private container_: HTMLElement;
    private gizmoManager_: GizmoManager;
    private settingsDropdown_: HTMLElement | null = null;
    private settingsDropdownClickHandler_: ((e: MouseEvent) => void) | null = null;
    private unsubscribeSettings_: (() => void) | null = null;
    private onRender_: () => void;

    constructor(container: HTMLElement, gizmoManager: GizmoManager, onRender: () => void) {
        this.container_ = container;
        this.gizmoManager_ = gizmoManager;
        this.onRender_ = onRender;
    }

    buildToolbarHTML(): string {
        const gizmos = getAllGizmos();
        return gizmos.map(g => {
            const isActive = g.id === this.gizmoManager_.getActiveId();
            const shortcutLabel = g.shortcut ? ` (${g.shortcut.toUpperCase()})` : '';
            return `<button class="es-btn es-btn-icon es-gizmo-btn${isActive ? ' es-active' : ''}" data-mode="${g.id}" title="${g.name}${shortcutLabel}">${g.icon}</button>`;
        }).join('');
    }

    buildSettingsHTML(): string {
        return `
            <div class="es-gizmo-settings-wrapper">
                <button class="es-btn es-btn-icon" data-action="gizmo-settings" title="Gizmo Settings">${icons.settings(14)}</button>
                <div class="es-gizmo-settings-dropdown" style="display: none;">
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.showGrid" ${getSettingsValue<boolean>('scene.showGrid') ? 'checked' : ''}>
                            <span>Show Grid</span>
                        </label>
                    </div>
                    <div class="es-settings-row">
                        <label class="es-settings-label">Grid Color</label>
                        <input type="color" data-setting="scene.gridColor" value="${getSettingsValue<string>('scene.gridColor')}" class="es-color-input">
                    </div>
                    <div class="es-settings-row">
                        <label class="es-settings-label">Grid Opacity</label>
                        <input type="range" data-setting="scene.gridOpacity" min="0" max="1" step="0.1" value="${getSettingsValue<number>('scene.gridOpacity')}" class="es-slider-input">
                    </div>
                    <div class="es-settings-row">
                        <label class="es-settings-label">Grid Size</label>
                        <input type="number" data-setting="scene.gridSize" min="1" max="500" step="1" value="${getSettingsValue<number>('scene.gridSize') ?? 50}" class="es-number-input">
                    </div>
                    <div class="es-settings-divider"></div>
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.showGizmos" ${getSettingsValue<boolean>('scene.showGizmos') ? 'checked' : ''}>
                            <span>Show Gizmos</span>
                        </label>
                    </div>
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.showSelectionBox" ${getSettingsValue<boolean>('scene.showSelectionBox') ? 'checked' : ''}>
                            <span>Show Selection Box</span>
                        </label>
                    </div>
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.showColliders" ${getSettingsValue<boolean>('scene.showColliders') ? 'checked' : ''}>
                            <span>Show Colliders</span>
                        </label>
                    </div>
                    <div class="es-settings-divider"></div>
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.showStats" ${getSettingsValue<boolean>('scene.showStats') ? 'checked' : ''}>
                            <span>Show Stats</span>
                        </label>
                    </div>
                    <div class="es-settings-divider"></div>
                    <div class="es-settings-row">
                        <label class="es-settings-checkbox">
                            <input type="checkbox" data-setting="scene.livePreview" ${getSettingsValue<boolean>('scene.livePreview') ? 'checked' : ''}>
                            <span>Live Preview</span>
                        </label>
                    </div>
                </div>
            </div>`;
    }

    setupEvents(): void {
        const gizmoButtons = this.container_.querySelectorAll('.es-gizmo-btn');
        gizmoButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).dataset.mode;
                if (mode) this.setMode(mode);
            });
        });

        this.setupSettingsDropdown();
    }

    setMode(mode: string): void {
        this.gizmoManager_.setActive(mode);
        const buttons = this.container_.querySelectorAll('.es-gizmo-btn');
        buttons.forEach(btn => {
            const btnMode = (btn as HTMLElement).dataset.mode;
            btn.classList.toggle('es-active', btnMode === mode);
        });
        this.onRender_();
    }

    handleKeyShortcut(key: string): boolean {
        const gizmos = getAllGizmos();
        for (const g of gizmos) {
            if (g.shortcut && key.toLowerCase() === g.shortcut) {
                this.setMode(g.id);
                return true;
            }
        }
        return false;
    }

    updateZoomDisplay(zoom: number): void {
        const display = this.container_.querySelector('.es-zoom-display');
        if (display) {
            display.textContent = `${Math.round(zoom * 100)}%`;
        }
    }

    updateSnapIndicator(active: boolean): void {
        const indicator = this.container_.querySelector('.es-snap-indicator') as HTMLElement | null;
        if (indicator) {
            indicator.style.display = active ? 'inline' : 'none';
        }
    }

    private setupSettingsDropdown(): void {
        const settingsBtn = this.container_.querySelector('[data-action="gizmo-settings"]');
        this.settingsDropdown_ = this.container_.querySelector('.es-gizmo-settings-dropdown');

        if (!settingsBtn || !this.settingsDropdown_) return;

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = this.settingsDropdown_!.style.display !== 'none';
            this.settingsDropdown_!.style.display = isVisible ? 'none' : 'block';
        });

        this.settingsDropdownClickHandler_ = (e: MouseEvent) => {
            if (this.settingsDropdown_ && !this.settingsDropdown_.contains(e.target as Node) &&
                !settingsBtn.contains(e.target as Node)) {
                this.settingsDropdown_.style.display = 'none';
            }
        };
        document.addEventListener('click', this.settingsDropdownClickHandler_);

        this.settingsDropdown_.querySelectorAll('input').forEach(input => {
            const settingId = input.dataset.setting;
            if (!settingId) return;

            input.addEventListener('change', () => {
                if (input.type === 'checkbox') {
                    setSettingsValue(settingId, input.checked);
                } else if (input.type === 'range' || input.type === 'number') {
                    setSettingsValue(settingId, parseFloat(input.value));
                } else if (input.type === 'color') {
                    setSettingsValue(settingId, input.value);
                }
                this.onRender_();
            });

            if (input.type === 'range') {
                input.addEventListener('input', () => {
                    setSettingsValue(settingId, parseFloat(input.value));
                    this.onRender_();
                });
            }
        });

        this.unsubscribeSettings_ = onSettingsChange((id, value) => {
            if (!id.startsWith('scene.')) return;
            const input = this.settingsDropdown_?.querySelector(`[data-setting="${id}"]`) as HTMLInputElement | null;
            if (!input) return;
            if (input.type === 'checkbox') {
                input.checked = value as boolean;
            } else {
                input.value = String(value);
            }
            this.onRender_();
        });
    }

    dispose(): void {
        if (this.settingsDropdownClickHandler_) {
            document.removeEventListener('click', this.settingsDropdownClickHandler_);
            this.settingsDropdownClickHandler_ = null;
        }
        if (this.unsubscribeSettings_) {
            this.unsubscribeSettings_();
            this.unsubscribeSettings_ = null;
        }
    }
}
