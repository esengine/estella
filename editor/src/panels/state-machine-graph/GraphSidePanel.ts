import { showContextMenu } from '../../ui/ContextMenu';

const REMOVE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const SIDE_WIDTH = 200;

const EVENT_OPTIONS = ['pointerEnter', 'pointerExit', 'pointerDown', 'pointerUp'];
const ACTION_OPTIONS = ['set', 'reset', 'toggle'];

interface InputDef {
    name: string;
    type: 'bool' | 'number' | 'trigger';
    defaultValue?: boolean | number;
}

interface ListenerDef {
    event: string;
    inputName: string;
    action: string;
    value?: boolean | number;
}

export interface SidePanelCallbacks {
    onAddInput(type: 'bool' | 'number' | 'trigger'): void;
    onRemoveInput(index: number): void;
    onUpdateInput(index: number, field: 'name' | 'type' | 'defaultValue', value: unknown): void;
    onAddListener(): void;
    onRemoveListener(index: number): void;
    onUpdateListener(index: number, field: 'event' | 'inputName' | 'action', value: string): void;
}

type TabId = 'inputs' | 'listeners';

export class GraphSidePanel {
    private el_: HTMLElement;
    private contentEl_: HTMLElement;
    private callbacks_: SidePanelCallbacks;
    private activeTab_: TabId | null = null;
    private inputsTabBtn_: HTMLButtonElement;
    private listenersTabBtn_: HTMLButtonElement;

    private inputs_: InputDef[] = [];
    private listeners_: ListenerDef[] = [];

    constructor(
        tabBar: HTMLElement,
        bodyRow: HTMLElement,
        callbacks: SidePanelCallbacks,
    ) {
        this.callbacks_ = callbacks;

        this.inputsTabBtn_ = this.createTabButton(tabBar, 'Inputs', 'inputs');
        this.listenersTabBtn_ = this.createTabButton(tabBar, 'Listeners', 'listeners');

        this.el_ = document.createElement('div');
        this.el_.style.cssText = `display:none;width:${SIDE_WIDTH}px;height:100%;flex-shrink:0;background:var(--es-bg-secondary, #252526);border-right:1px solid var(--es-border, #333);overflow:hidden;`;
        bodyRow.insertBefore(this.el_, bodyRow.firstChild);

        this.contentEl_ = document.createElement('div');
        this.contentEl_.style.cssText = 'height:100%;overflow-y:auto;overflow-x:hidden;padding:8px;';
        this.el_.appendChild(this.contentEl_);
    }

    get visible(): boolean {
        return this.activeTab_ !== null;
    }

    dispose(): void {
        this.el_.remove();
        this.inputsTabBtn_.remove();
        this.listenersTabBtn_.remove();
    }

    update(inputs: InputDef[], listeners: ListenerDef[]): void {
        this.inputs_ = inputs;
        this.listeners_ = listeners;
        this.updateBadges();
        if (this.activeTab_) this.renderContent();
    }

    private createTabButton(tabBar: HTMLElement, label: string, tab: TabId): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'es-btn es-btn-clear';
        btn.style.cssText = 'font-size:11px;padding:2px 10px;height:24px;border-radius:3px;color:var(--es-text-muted, #888);position:relative;';

        const textSpan = document.createElement('span');
        textSpan.textContent = label;
        btn.appendChild(textSpan);

        const badge = document.createElement('span');
        badge.className = 'es-side-tab-badge';
        badge.style.cssText = 'font-size:9px;color:var(--es-text-muted, #666);margin-left:3px;';
        btn.appendChild(badge);

        btn.addEventListener('click', () => this.toggleTab(tab));
        tabBar.appendChild(btn);
        return btn;
    }

    private updateBadges(): void {
        const iBadge = this.inputsTabBtn_.querySelector('.es-side-tab-badge') as HTMLElement;
        const lBadge = this.listenersTabBtn_.querySelector('.es-side-tab-badge') as HTMLElement;
        if (iBadge) iBadge.textContent = this.inputs_.length > 0 ? String(this.inputs_.length) : '';
        if (lBadge) lBadge.textContent = this.listeners_.length > 0 ? String(this.listeners_.length) : '';
    }

    private toggleTab(tab: TabId): void {
        if (this.activeTab_ === tab) {
            this.activeTab_ = null;
            this.el_.style.display = 'none';
            this.inputsTabBtn_.style.color = 'var(--es-text-muted, #888)';
            this.listenersTabBtn_.style.color = 'var(--es-text-muted, #888)';
        } else {
            this.activeTab_ = tab;
            this.el_.style.display = 'block';
            this.inputsTabBtn_.style.color = tab === 'inputs' ? 'var(--es-text-primary, #ddd)' : 'var(--es-text-muted, #888)';
            this.listenersTabBtn_.style.color = tab === 'listeners' ? 'var(--es-text-primary, #ddd)' : 'var(--es-text-muted, #888)';
            this.renderContent();
        }
    }

    private renderContent(): void {
        this.contentEl_.innerHTML = '';
        if (this.activeTab_ === 'inputs') {
            this.renderInputs();
        } else if (this.activeTab_ === 'listeners') {
            this.renderListeners();
        }
    }

    // =========================================================================
    // Inputs
    // =========================================================================

    private renderInputs(): void {
        const header = this.createSectionHeader('Inputs', (e) => {
            showContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                    { label: 'Bool', onClick: () => this.callbacks_.onAddInput('bool') },
                    { label: 'Number', onClick: () => this.callbacks_.onAddInput('number') },
                    { label: 'Trigger', onClick: () => this.callbacks_.onAddInput('trigger') },
                ],
            });
        });
        this.contentEl_.appendChild(header);

        if (this.inputs_.length === 0) {
            this.appendEmptyHint('No inputs defined');
            return;
        }

        for (let i = 0; i < this.inputs_.length; i++) {
            this.renderInputRow(i, this.inputs_[i]);
        }
    }

    private renderInputRow(index: number, input: InputDef): void {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 0;';

        if (input.type === 'bool') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!input.defaultValue;
            cb.style.cssText = 'flex-shrink:0;margin:0;';
            cb.addEventListener('change', () => {
                this.callbacks_.onUpdateInput(index, 'defaultValue', cb.checked);
            });
            row.appendChild(cb);
        } else if (input.type === 'number') {
            const num = document.createElement('input');
            num.className = 'es-input es-input-number';
            num.type = 'number';
            num.step = '0.1';
            num.style.cssText = 'width:40px;flex-shrink:0;font-size:10px;padding:1px 3px;height:18px;';
            num.value = String(input.defaultValue ?? 0);
            num.addEventListener('change', () => {
                this.callbacks_.onUpdateInput(index, 'defaultValue', parseFloat(num.value) || 0);
            });
            row.appendChild(num);
        } else {
            const trigBtn = document.createElement('button');
            trigBtn.className = 'es-btn es-btn-clear';
            trigBtn.style.cssText = 'width:18px;height:18px;padding:0;flex-shrink:0;font-size:10px;line-height:18px;';
            trigBtn.textContent = '\u25B6';
            trigBtn.title = 'Fire trigger';
            row.appendChild(trigBtn);
        }

        const nameInput = document.createElement('input');
        nameInput.className = 'es-input';
        nameInput.style.cssText = 'flex:1;min-width:0;font-size:11px;padding:1px 4px;height:18px;';
        nameInput.value = input.name;
        nameInput.addEventListener('change', () => {
            const newName = nameInput.value.trim();
            if (newName && newName !== input.name) {
                this.callbacks_.onUpdateInput(index, 'name', newName);
            } else {
                nameInput.value = input.name;
            }
        });
        row.appendChild(nameInput);

        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:9px;color:var(--es-text-muted, #666);flex-shrink:0;padding:1px 4px;border-radius:2px;background:var(--es-bg-tertiary, #2d2d2d);';
        badge.textContent = input.type;
        row.appendChild(badge);

        const removeBtn = this.createRemoveBtn(() => {
            this.callbacks_.onRemoveInput(index);
        });
        row.appendChild(removeBtn);

        this.contentEl_.appendChild(row);
    }

    // =========================================================================
    // Listeners
    // =========================================================================

    private renderListeners(): void {
        const header = this.createSectionHeader('Listeners', () => {
            this.callbacks_.onAddListener();
        });
        this.contentEl_.appendChild(header);

        if (this.listeners_.length === 0) {
            this.appendEmptyHint('No listeners defined');
            return;
        }

        for (let i = 0; i < this.listeners_.length; i++) {
            this.renderListenerRow(i, this.listeners_[i]);
        }
    }

    private renderListenerRow(index: number, listener: ListenerDef): void {
        const row = document.createElement('div');
        row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--es-border, #333);';

        const eventSel = this.createSmallSelect(EVENT_OPTIONS, listener.event, (val) => {
            this.callbacks_.onUpdateListener(index, 'event', val);
        });
        eventSel.style.width = '100%';
        eventSel.style.marginBottom = '3px';
        row.appendChild(eventSel);

        const actionRow = document.createElement('div');
        actionRow.style.cssText = 'display:flex;align-items:center;gap:3px;';

        const arrow = document.createElement('span');
        arrow.style.cssText = 'color:var(--es-text-muted, #888);font-size:10px;flex-shrink:0;';
        arrow.textContent = '\u2192';
        actionRow.appendChild(arrow);

        const inputNames = this.inputs_.map(i => i.name);
        const inputSel = this.createSmallSelect(
            inputNames.length > 0 ? inputNames : ['(no inputs)'],
            listener.inputName,
            (val) => { this.callbacks_.onUpdateListener(index, 'inputName', val); },
        );
        inputSel.style.cssText += 'flex:1;min-width:0;';
        actionRow.appendChild(inputSel);

        const eq = document.createElement('span');
        eq.style.cssText = 'color:var(--es-text-muted, #888);font-size:10px;flex-shrink:0;';
        eq.textContent = '=';
        actionRow.appendChild(eq);

        const actionSel = this.createSmallSelect(ACTION_OPTIONS, listener.action, (val) => {
            this.callbacks_.onUpdateListener(index, 'action', val);
        });
        actionSel.style.cssText += 'width:56px;flex-shrink:0;';
        actionRow.appendChild(actionSel);

        const removeBtn = this.createRemoveBtn(() => {
            this.callbacks_.onRemoveListener(index);
        });
        actionRow.appendChild(removeBtn);

        row.appendChild(actionRow);
        this.contentEl_.appendChild(row);
    }

    // =========================================================================
    // DOM Helpers
    // =========================================================================

    private createSectionHeader(title: string, onAdd: (e: MouseEvent) => void): HTMLElement {
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;';

        const label = document.createElement('span');
        label.style.cssText = 'flex:1;font-size:11px;font-weight:600;color:var(--es-text-secondary, #ccc);text-transform:uppercase;letter-spacing:0.5px;';
        label.textContent = title;
        header.appendChild(label);

        const addBtn = document.createElement('button');
        addBtn.className = 'es-btn es-btn-clear';
        addBtn.style.cssText = 'font-size:14px;width:20px;height:20px;padding:0;line-height:20px;flex-shrink:0;';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', onAdd);
        header.appendChild(addBtn);

        return header;
    }

    private createSmallSelect(options: string[], value: string, onChange: (val: string) => void): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.className = 'es-input es-input-select';
        sel.style.cssText = 'font-size:10px;padding:1px 2px;height:18px;box-sizing:border-box;';
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            sel.appendChild(o);
        }
        sel.value = value;
        sel.addEventListener('change', () => onChange(sel.value));
        return sel;
    }

    private createRemoveBtn(onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'es-btn es-btn-icon es-btn-clear';
        btn.style.cssText = 'width:16px;height:16px;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;opacity:0.5;';
        btn.innerHTML = REMOVE_SVG;
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.5'; });
        btn.addEventListener('click', onClick);
        return btn;
    }

    private appendEmptyHint(text: string): void {
        const el = document.createElement('div');
        el.style.cssText = 'color:var(--es-text-muted, #666);font-size:10px;font-style:italic;padding:4px 0;';
        el.textContent = text;
        this.contentEl_.appendChild(el);
    }
}
