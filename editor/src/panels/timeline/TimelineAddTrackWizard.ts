import type { EditorStore } from '../../store/EditorStore';
import type { TimelineTrackData } from './TimelineKeyframeArea';
import type { TrackType } from './TimelineState';
import { getComponentSchema } from '../../schemas/ComponentSchemas';
import { icons } from '../../utils/icons';

interface EntityNode {
    id: number;
    name: string;
    path: string;
    depth: number;
    componentTypes: string[];
}

interface AnimatableProperty {
    name: string;
    type: string;
    channels: string[];
}

const ANIMATABLE_TYPES = new Set(['number', 'vec2', 'vec3', 'vec4', 'color', 'euler']);

const CHANNEL_SUFFIXES: Record<string, string[]> = {
    number: [''],
    vec2: ['.x', '.y'],
    vec3: ['.x', '.y', '.z'],
    vec4: ['.x', '.y', '.z', '.w'],
    color: ['.r', '.g', '.b', '.a'],
    euler: ['.x', '.y', '.z'],
};

const TRACK_TYPE_OPTIONS: { type: TrackType; label: string; icon: (s: number) => string; needsEntity: boolean; componentFilter?: string }[] = [
    { type: 'property', label: 'Property', icon: icons.settings, needsEntity: true },
    { type: 'spine', label: 'Spine', icon: icons.box, needsEntity: true, componentFilter: 'SpineAnimation' },
    { type: 'spriteAnim', label: 'Sprite Anim', icon: icons.film, needsEntity: true, componentFilter: 'SpriteAnimator' },
    { type: 'audio', label: 'Audio', icon: icons.volume, needsEntity: false },
    { type: 'activation', label: 'Activation', icon: icons.eye, needsEntity: true },
];

const SKIP_COMPONENTS = new Set(['Name', 'Parent', 'Children', 'UIInteraction']);

type WizardStep = 'type' | 'entity' | 'component' | 'property';

export type WizardCompleteCallback = (track: TimelineTrackData) => void;

export class TimelineAddTrackWizard {
    private el_: HTMLElement | null = null;
    private step_: WizardStep = 'type';
    private selectedType_: TrackType | null = null;
    private selectedEntity_: EntityNode | null = null;
    private selectedComponent_: string | null = null;
    private entityNodes_: EntityNode[] = [];
    private dismiss_: ((e: MouseEvent) => void) | null = null;

    constructor(
        private store_: EditorStore,
        private rootEntityId_: number | null,
        private onComplete_: WizardCompleteCallback,
    ) {}

    show(anchor: HTMLElement): void {
        this.hide();
        this.step_ = 'type';
        this.selectedType_ = null;
        this.selectedEntity_ = null;
        this.selectedComponent_ = null;

        if (this.rootEntityId_ !== null) {
            this.entityNodes_ = this.flattenEntityTree();
        }

        this.el_ = document.createElement('div');
        this.el_.className = 'es-timeline-dropdown';

        const rect = anchor.getBoundingClientRect();
        this.el_.style.position = 'fixed';
        this.el_.style.left = `${rect.left}px`;
        this.el_.style.top = `${rect.bottom + 2}px`;
        document.body.appendChild(this.el_);

        this.renderStep();

        this.dismiss_ = (e: MouseEvent) => {
            if (this.el_ && !this.el_.contains(e.target as Node)) {
                this.hide();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', this.dismiss_!, true), 0);
    }

    hide(): void {
        if (this.dismiss_) {
            document.removeEventListener('mousedown', this.dismiss_, true);
            this.dismiss_ = null;
        }
        if (this.el_) {
            this.el_.remove();
            this.el_ = null;
        }
    }

    private renderStep(): void {
        if (!this.el_) return;

        switch (this.step_) {
            case 'type': this.renderTypeStep(); break;
            case 'entity': this.renderEntityStep(); break;
            case 'component': this.renderComponentStep(); break;
            case 'property': this.renderPropertyStep(); break;
        }
    }

    private renderTypeStep(): void {
        const el = this.el_!;
        el.innerHTML = '';

        this.addHeader('Add Track');

        for (const opt of TRACK_TYPE_OPTIONS) {
            const hasMatch = !opt.needsEntity || this.entityNodes_.length > 0;
            const item = this.createItem(opt.icon(12), opt.label, hasMatch);
            if (!hasMatch) continue;

            item.addEventListener('click', () => {
                this.selectedType_ = opt.type;

                if (!opt.needsEntity) {
                    this.complete(this.buildAudioTrack());
                    return;
                }

                if (this.rootEntityId_ === null) {
                    return;
                }

                this.step_ = 'entity';
                this.renderStep();
            });
            el.appendChild(item);
        }
    }

    private renderEntityStep(): void {
        const el = this.el_!;
        el.innerHTML = '';

        const opt = TRACK_TYPE_OPTIONS.find(o => o.type === this.selectedType_)!;

        this.addBackButton('type');
        this.addHeader('Select Entity');

        let nodes = this.entityNodes_;
        if (opt.componentFilter) {
            nodes = nodes.filter(n => n.componentTypes.includes(opt.componentFilter!));
        }

        if (nodes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'es-timeline-dropdown-empty';
            empty.textContent = opt.componentFilter
                ? `No entity with ${opt.componentFilter}`
                : 'No child entities';
            el.appendChild(empty);
            return;
        }

        for (const node of nodes) {
            const label = node.path === '' ? `(self) ${node.name}` : node.name;
            const indent = node.depth * 12;
            const item = this.createItem('', label, true);
            (item.firstElementChild as HTMLElement).style.paddingLeft = `${12 + indent}px`;

            item.addEventListener('click', () => {
                this.selectedEntity_ = node;

                if (this.selectedType_ === 'property') {
                    this.step_ = 'component';
                    this.renderStep();
                } else {
                    this.complete(this.buildTrack());
                }
            });
            el.appendChild(item);
        }
    }

    private renderComponentStep(): void {
        const el = this.el_!;
        el.innerHTML = '';

        this.addBackButton('entity');
        this.addHeader(`${this.selectedEntity_!.path || this.selectedEntity_!.name} — Component`);

        const components = this.selectedEntity_!.componentTypes
            .filter(t => !SKIP_COMPONENTS.has(t))
            .filter(t => {
                const schema = getComponentSchema(t);
                if (!schema) return false;
                return schema.properties.some(p => ANIMATABLE_TYPES.has(p.type));
            });

        if (components.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'es-timeline-dropdown-empty';
            empty.textContent = 'No animatable components';
            el.appendChild(empty);
            return;
        }

        for (const comp of components) {
            const item = this.createItem(icons.settings(12), comp, true);
            item.addEventListener('click', () => {
                this.selectedComponent_ = comp;
                this.step_ = 'property';
                this.renderStep();
            });
            el.appendChild(item);
        }
    }

    private renderPropertyStep(): void {
        const el = this.el_!;
        el.innerHTML = '';

        this.addBackButton('component');
        this.addHeader(`${this.selectedComponent_} — Property`);

        const props = this.getAnimatableProperties(this.selectedComponent_!);

        for (const prop of props) {
            const channelLabel = prop.type === 'number' ? '' : ` (${prop.channels.length}ch)`;
            const item = this.createItem('', `${prop.name}${channelLabel}`, true);
            item.addEventListener('click', () => {
                this.complete(this.buildPropertyTrack(prop));
            });
            el.appendChild(item);
        }
    }

    private addHeader(text: string): void {
        const header = document.createElement('div');
        header.className = 'es-timeline-dropdown-header';
        header.textContent = text;
        this.el_!.appendChild(header);
    }

    private addBackButton(targetStep: WizardStep): void {
        const back = document.createElement('div');
        back.className = 'es-timeline-dropdown-item es-timeline-dropdown-back';
        back.innerHTML = `${icons.chevronRight(10)} Back`;
        back.addEventListener('click', () => {
            this.step_ = targetStep;
            this.renderStep();
        });
        this.el_!.appendChild(back);
    }

    private createItem(icon: string, label: string, enabled: boolean): HTMLElement {
        const wrapper = document.createElement('div');
        const item = document.createElement('div');
        item.className = 'es-timeline-dropdown-item';
        if (!enabled) item.classList.add('es-disabled');
        if (icon) {
            item.innerHTML = `<span class="es-timeline-dropdown-icon">${icon}</span> ${label}`;
        } else {
            item.textContent = label;
        }
        wrapper.appendChild(item);
        return wrapper;
    }

    private complete(track: TimelineTrackData): void {
        this.hide();
        this.onComplete_(track);
    }

    private buildPropertyTrack(prop: AnimatableProperty): TimelineTrackData {
        const entity = this.selectedEntity_!;
        const comp = this.selectedComponent_!;
        const prefix = entity.path ? `${entity.path} / ` : '';
        const name = `${prefix}${comp}.${prop.name}`;

        return {
            type: 'property',
            name,
            childPath: entity.path,
            component: comp,
            channels: prop.channels.map(ch => ({
                property: ch,
                keyframes: [],
            })),
        };
    }

    private buildAudioTrack(): TimelineTrackData {
        return {
            type: 'audio',
            name: 'Audio Events',
            events: [],
        };
    }

    private buildTrack(): TimelineTrackData {
        const entity = this.selectedEntity_!;
        const type = this.selectedType_!;
        const prefix = entity.path ? `${entity.path} / ` : '';

        const base: TimelineTrackData = {
            type,
            name: `${prefix}${type.charAt(0).toUpperCase() + type.slice(1)}`,
            childPath: entity.path,
        };

        switch (type) {
            case 'spine':
                base.clips = [];
                break;
            case 'spriteAnim':
                base.clip = '';
                base.startTime = 0;
                break;
            case 'activation':
                base.ranges = [];
                break;
        }

        return base;
    }

    private flattenEntityTree(): EntityNode[] {
        if (this.rootEntityId_ === null) return [];

        const result: EntityNode[] = [];
        const rootData = this.store_.getEntityData(this.rootEntityId_ as number);
        if (!rootData) return result;

        result.push({
            id: rootData.id,
            name: rootData.name,
            path: '',
            depth: 0,
            componentTypes: rootData.components.map(c => c.type),
        });

        const walk = (parentId: number, parentPath: string, depth: number): void => {
            const parentData = this.store_.getEntityData(parentId);
            if (!parentData) return;
            for (const childId of parentData.children) {
                const childData = this.store_.getEntityData(childId);
                if (!childData) continue;
                const childPath = parentPath ? `${parentPath}/${childData.name}` : childData.name;
                result.push({
                    id: childData.id,
                    name: childData.name,
                    path: childPath,
                    depth,
                    componentTypes: childData.components.map(c => c.type),
                });
                walk(childId, childPath, depth + 1);
            }
        };

        walk(this.rootEntityId_ as number, '', 1);
        return result;
    }

    private getAnimatableProperties(componentType: string): AnimatableProperty[] {
        const schema = getComponentSchema(componentType);
        if (!schema) return [];

        return schema.properties
            .filter(p => ANIMATABLE_TYPES.has(p.type))
            .map(p => ({
                name: p.name,
                type: p.type,
                channels: (CHANNEL_SUFFIXES[p.type] ?? ['']).map(s =>
                    s ? `${p.name}${s}` : p.name
                ),
            }));
    }
}
