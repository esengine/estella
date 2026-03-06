import type { PanelInstance } from '../PanelRegistry';
import type { EditorStore } from '../../store/EditorStore';
import type { PropertyChangeEvent } from '../../store/EditorStore';
import type { Command } from '../../commands/Command';
import { TimelineState, DEFAULT_DURATION, type TimelineTrackState } from './TimelineState';
import { TimelineToolbar } from './TimelineToolbar';
import { TimelineTrackList } from './TimelineTrackList';
import { TimelineKeyframeArea, type TimelineAssetData, type TimelineTrackData } from './TimelineKeyframeArea';
import { TimelineCurveEditor } from './TimelineCurveEditor';
import { AddKeyframeCommand, ReorderTrackCommand, RenameTrackCommand } from './TimelineCommands';
import { getEditorContext } from '../../context/EditorContext';
import { getProjectService, getSceneService } from '../../services';
import { getAssetDatabase as getAssetLibrary, isUUID } from '../../asset';
import { DisposableStore } from '../../utils/Disposable';

const PLAYBACK_INTERVAL_MS = 16;

export class TimelinePanel implements PanelInstance {
    private container_: HTMLElement;
    private disposables_ = new DisposableStore();
    private store_: EditorStore;
    private state_: TimelineState;
    private toolbar_: TimelineToolbar | null = null;
    private trackList_: TimelineTrackList | null = null;
    private keyframeArea_: TimelineKeyframeArea | null = null;
    private curveEditor_: TimelineCurveEditor | null = null;
    private emptyEl_: HTMLElement | null = null;
    private bodyEl_: HTMLElement | null = null;
    private isRecordingKeyframe_ = false;
    private isScrubPreview_ = false;
    private lastPreviewTime_ = -1;
    private playbackTimer_: number | null = null;
    private lastPlaybackTime_: number = 0;
    private assetData_: TimelineAssetData | null = null;
    private assetPath_: string | null = null;
    private dirty_ = false;
    private boundEntityId_: number | null = null;
    private disposeDirtyReg_: (() => void) | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;
        this.state_ = new TimelineState();
        this.render();

        this.disposables_.add(store.subscribe((_state, dirtyFlags) => {
            if (!dirtyFlags || dirtyFlags.has('selection') || dirtyFlags.has('scene')) {
                this.onSelectionOrSceneChanged();
            }
        }));

        this.disposables_.add(store.subscribeToPropertyChanges(
            (event) => this.onPropertyChanged(event),
        ));

        this.disposables_.add(this.state_.onChange(() => {
            if (this.state_.playing && this.playbackTimer_ === null) {
                this.startPlayback();
            } else if (!this.state_.playing && this.playbackTimer_ !== null) {
                this.stopPlayback();
            }
            this.applyScrubPreview();
        }));

        this.updateEmptyState();
        const sceneService = getSceneService();
        if (sceneService) {
            this.disposeDirtyReg_ = sceneService.registerDirtyChecker(() => ({
                isDirty: this.isDirty,
                save: () => this.saveAsset(),
            }));
        }
    }

    dispose(): void {
        this.disposeDirtyReg_?.();
        this.stopPlayback();
        this.toolbar_?.dispose();
        this.trackList_?.dispose();
        this.keyframeArea_?.dispose();
        this.curveEditor_?.dispose();
        this.disposables_.dispose();
        this.container_.innerHTML = '';
    }

    resize(): void {
        this.keyframeArea_?.draw();
        if (this.curveEditor_?.isVisible) {
            this.curveEditor_.draw();
        }
    }

    get assetData(): TimelineAssetData | null {
        return this.assetData_;
    }

    get assetPath(): string | null {
        return this.assetPath_;
    }

    get isDirty(): boolean {
        return this.dirty_;
    }

    async saveAsset(): Promise<boolean> {
        return this.saveTimeline();
    }

    executeCommand(cmd: Command): void {
        this.store_.executeCommand(cmd);
        this.dirty_ = true;
    }

    onAssetDataChanged(): void {
        this.dirty_ = true;
        this.syncTracksFromData();
        this.trackList_?.setAssetData(this.assetData_);
        this.keyframeArea_?.draw();
        if (this.curveEditor_?.isVisible) {
            this.curveEditor_.draw();
        }
        this.state_.notify();
    }

    showCurveEditor(trackIndex: number, channelIndex: number): void {
        this.curveEditor_?.setAssetData(this.assetData_);
        this.curveEditor_?.showChannel(trackIndex, channelIndex);
    }

    hideCurveEditor(): void {
        this.curveEditor_?.hide();
    }

    loadTimeline(data: TimelineAssetData, duration: number, path?: string): void {
        this.assetData_ = data;
        this.assetPath_ = path ?? null;
        this.dirty_ = false;
        this.lastPreviewTime_ = -1;
        this.state_.duration = duration;
        this.state_.playheadTime = 0;
        this.state_.playing = false;
        this.state_.selectedTrackIndex = -1;
        this.state_.selectedKeyframes.clear();

        this.syncTracksFromData();
        this.trackList_?.setAssetData(data);
        this.keyframeArea_?.setAssetData(data);
        this.curveEditor_?.setAssetData(data);
        this.curveEditor_?.hide();
        this.updateEmptyState();
        this.state_.notify();
    }

    clearTimeline(): void {
        this.stopPlayback();
        this.assetData_ = null;
        this.assetPath_ = null;
        this.dirty_ = false;
        this.lastPreviewTime_ = -1;
        this.boundEntityId_ = null;
        this.toolbar_?.setBoundEntity(null);
        this.state_.tracks = [];
        this.state_.duration = DEFAULT_DURATION;
        this.state_.playheadTime = 0;
        this.state_.playing = false;
        this.state_.recording = false;
        this.trackList_?.setAssetData(null);
        this.keyframeArea_?.setAssetData(null);
        this.curveEditor_?.setAssetData(null);
        this.curveEditor_?.hide();
        this.updateEmptyState();
        this.state_.notify();
    }

    readPropertyValue(trackIndex: number, channelIndex: number): number {
        const track = this.assetData_?.tracks[trackIndex];
        if (!track || track.type !== 'property') return 0;

        const channel = track.channels?.[channelIndex];
        if (!channel) return 0;

        const entityId = this.resolveChildEntity(track.childPath ?? '');
        if (entityId === null) return 0;

        const entityData = this.store_.getEntityData(entityId as number);
        if (!entityData) return 0;

        const comp = entityData.components.find(c => c.type === track.component);
        if (!comp) return 0;

        return this.extractValue(comp.data, channel.property);
    }

    private resolveChildEntity(childPath: string): number | null {
        if (this.boundEntityId_ === null) return null;
        if (!childPath) return this.boundEntityId_;

        const parts = childPath.split('/');
        let currentId = this.boundEntityId_;

        for (const name of parts) {
            const entityData = this.store_.getEntityData(currentId as number);
            if (!entityData) return null;

            let found = false;
            for (const childId of entityData.children) {
                const child = this.store_.getEntityData(childId);
                if (child?.name === name) {
                    currentId = childId;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }

        return currentId;
    }

    private extractValue(data: Record<string, unknown>, property: string): number {
        const parts = property.split('.');
        let current: unknown = data;
        for (const part of parts) {
            if (current == null || typeof current !== 'object') return 0;
            current = (current as Record<string, unknown>)[part];
        }
        return typeof current === 'number' ? current : 0;
    }

    private syncTracksFromData(): void {
        if (!this.assetData_) return;
        this.state_.tracks = this.assetData_.tracks.map((track, i) => ({
            index: i,
            name: track.name,
            type: track.type as TimelineTrackState['type'],
            expanded: this.state_.tracks[i]?.expanded ?? false,
            channelCount: track.channels?.length ?? 0,
        }));
    }

    private onPropertyChanged(event: PropertyChangeEvent): void {
        if (!this.state_.recording || !this.assetData_ || this.isRecordingKeyframe_ || this.isScrubPreview_) return;
        if (this.boundEntityId_ === null) return;

        const entityChildPath = this.resolveEntityToChildPath(event.entity);
        if (entityChildPath === null) return;

        const time = this.state_.playheadTime;

        for (let ti = 0; ti < this.assetData_.tracks.length; ti++) {
            const track = this.assetData_.tracks[ti];
            if (track.type !== 'property' || !track.channels) continue;
            if (track.component !== event.componentType) continue;
            if ((track.childPath ?? '') !== entityChildPath) continue;

            for (let ci = 0; ci < track.channels.length; ci++) {
                const channel = track.channels[ci];
                const value = this.extractRecordValue(
                    event.propertyName, event.newValue, channel.property,
                );
                if (value === null) continue;

                const existingIdx = channel.keyframes.findIndex(
                    k => Math.abs(k.time - time) < 0.001,
                );
                if (existingIdx >= 0) {
                    channel.keyframes[existingIdx].value = value;
                } else {
                    this.isRecordingKeyframe_ = true;
                    const cmd = new AddKeyframeCommand(
                        this.assetData_!, ti, ci,
                        { time, value },
                        () => this.onAssetDataChanged(),
                    );
                    this.executeCommand(cmd);
                    this.isRecordingKeyframe_ = false;
                }
            }
        }

        this.onAssetDataChanged();
    }

    private extractRecordValue(
        propertyName: string, newValue: unknown, channelProperty: string,
    ): number | null {
        if (channelProperty === propertyName) {
            return typeof newValue === 'number' ? newValue : null;
        }
        if (!channelProperty.startsWith(propertyName + '.')) return null;

        const subPath = channelProperty.slice(propertyName.length + 1);
        if (newValue == null || typeof newValue !== 'object') return null;

        let current: unknown = newValue;
        for (const part of subPath.split('.')) {
            if (current == null || typeof current !== 'object') return null;
            current = (current as Record<string, unknown>)[part];
        }
        return typeof current === 'number' ? current : null;
    }

    private resolveEntityToChildPath(entityId: number): string | null {
        if (this.boundEntityId_ === null) return null;
        if (entityId === this.boundEntityId_) return '';

        const path: string[] = [];
        let currentId = entityId;

        while (currentId !== this.boundEntityId_) {
            const entityData = this.store_.getEntityData(currentId);
            if (!entityData) return null;
            path.unshift(entityData.name);

            if (entityData.parent === null) return null;
            currentId = entityData.parent;
        }

        return path.join('/');
    }

    private applyScrubPreview(): void {
        if (!this.assetData_ || this.boundEntityId_ === null) return;

        const time = this.state_.playheadTime;
        if (time === this.lastPreviewTime_) return;
        this.lastPreviewTime_ = time;

        this.isScrubPreview_ = true;

        for (const track of this.assetData_.tracks) {
            if (track.type !== 'property' || !track.channels || !track.component) continue;

            const entityId = this.resolveChildEntity(track.childPath ?? '');
            if (entityId === null) continue;

            const propGroups = new Map<string, Map<string, number>>();
            for (const channel of track.channels) {
                const value = this.evaluateChannelAtTime(channel.keyframes, time);
                if (value === null) continue;

                const topProp = channel.property.split('.')[0];
                if (!propGroups.has(topProp)) propGroups.set(topProp, new Map());
                propGroups.get(topProp)!.set(channel.property, value);
            }

            for (const [topProp, subValues] of propGroups) {
                const entityData = this.store_.getEntityData(entityId as number);
                if (!entityData) continue;
                const comp = entityData.components.find(c => c.type === track.component);
                if (!comp) continue;

                if (subValues.size === 1 && subValues.has(topProp)) {
                    this.store_.updatePropertyDirect(
                        entityId, track.component!, topProp, subValues.get(topProp)!,
                    );
                } else {
                    const current = comp.data[topProp];
                    if (current != null && typeof current === 'object') {
                        const updated = { ...(current as Record<string, unknown>) };
                        for (const [fullProp, val] of subValues) {
                            const subPath = fullProp.slice(topProp.length + 1);
                            this.setNestedValue(updated, subPath, val);
                        }
                        this.store_.updatePropertyDirect(
                            entityId, track.component!, topProp, updated,
                        );
                    }
                }
            }
        }

        this.isScrubPreview_ = false;
        this.store_.invalidateAllTransforms();
    }

    private evaluateChannelAtTime(
        keyframes: { time: number; value: number; inTangent?: number; outTangent?: number }[],
        time: number,
    ): number | null {
        if (keyframes.length === 0) return null;
        if (keyframes.length === 1) return keyframes[0].value;
        if (time <= keyframes[0].time) return keyframes[0].value;
        if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

        let i = 0;
        while (i < keyframes.length - 1 && keyframes[i + 1].time <= time) i++;

        const k0 = keyframes[i];
        const k1 = keyframes[i + 1];
        const dt = k1.time - k0.time;
        if (dt <= 0) return k0.value;

        const t = (time - k0.time) / dt;
        const m0 = (k0.outTangent ?? 0) * dt;
        const m1 = (k1.inTangent ?? 0) * dt;
        const t2 = t * t;
        const t3 = t2 * t;

        return (2 * t3 - 3 * t2 + 1) * k0.value
            + (t3 - 2 * t2 + t) * m0
            + (-2 * t3 + 3 * t2) * k1.value
            + (t3 - t2) * m1;
    }

    private setNestedValue(obj: Record<string, unknown>, path: string, value: number): void {
        const parts = path.split('.');
        let target: Record<string, unknown> = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const next = target[parts[i]];
            if (next == null || typeof next !== 'object') return;
            target = next as Record<string, unknown>;
        }
        target[parts[parts.length - 1]] = value;
    }

    private resolveAssetRefToAbsPath(ref: string): string | null {
        let relativePath = ref;
        if (isUUID(ref)) {
            const resolved = getAssetLibrary().getPath(ref);
            if (!resolved) return null;
            relativePath = resolved;
        }
        const projectPath = getProjectService()?.projectPath;
        if (!projectPath) return null;
        const projectDir = projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        return `${projectDir}/${relativePath}`;
    }

    private startPlayback(): void {
        this.lastPlaybackTime_ = performance.now();
        this.playbackTimer_ = window.setInterval(() => this.tickPlayback(), PLAYBACK_INTERVAL_MS);
    }

    private stopPlayback(): void {
        if (this.playbackTimer_ !== null) {
            clearInterval(this.playbackTimer_);
            this.playbackTimer_ = null;
        }
    }

    private tickPlayback(): void {
        const now = performance.now();
        const dt = (now - this.lastPlaybackTime_) / 1000 * this.state_.playbackSpeed;
        this.lastPlaybackTime_ = now;

        let newTime = this.state_.playheadTime + dt;

        if (newTime >= this.state_.duration) {
            switch (this.state_.wrapMode) {
                case 'loop':
                    newTime = newTime % this.state_.duration;
                    break;
                case 'pingPong':
                    const cycle = Math.floor(newTime / this.state_.duration);
                    const frac = newTime % this.state_.duration;
                    newTime = cycle % 2 === 0 ? frac : this.state_.duration - frac;
                    break;
                default:
                    newTime = this.state_.duration;
                    this.state_.playing = false;
                    break;
            }
        }

        this.state_.playheadTime = newTime;
        this.autoScrollPlayhead();
        this.state_.notify();
    }

    private autoScrollPlayhead(): void {
        const x = this.state_.timeToX(this.state_.playheadTime);
        const visibleWidth = this.container_.querySelector('.es-timeline-keyframes-pane')?.clientWidth ?? 600;
        if (x > visibleWidth) {
            this.state_.scrollX = this.state_.playheadTime * this.state_.pixelsPerSecond - visibleWidth * 0.2;
        }
    }

    private render(): void {
        this.container_.innerHTML = `
            <div class="es-timeline-panel">
                <div class="es-timeline-empty-state">
                    <div class="es-timeline-empty-text">
                        Select an entity with <strong>TimelinePlayer</strong> component to edit its timeline
                    </div>
                </div>
                <div class="es-timeline-editor" style="display:none">
                    <div class="es-timeline-toolbar-container"></div>
                    <div class="es-timeline-body">
                        <div class="es-timeline-tracks-pane"></div>
                        <div class="es-timeline-keyframes-pane"></div>
                    </div>
                    <div class="es-timeline-curve-pane"></div>
                </div>
            </div>
        `;

        this.emptyEl_ = this.container_.querySelector('.es-timeline-empty-state');
        this.bodyEl_ = this.container_.querySelector('.es-timeline-editor');

        const toolbarEl = this.container_.querySelector('.es-timeline-toolbar-container') as HTMLElement;
        const tracksEl = this.container_.querySelector('.es-timeline-tracks-pane') as HTMLElement;
        const keyframesEl = this.container_.querySelector('.es-timeline-keyframes-pane') as HTMLElement;
        const curveEl = this.container_.querySelector('.es-timeline-curve-pane') as HTMLElement;

        this.toolbar_ = new TimelineToolbar(
            toolbarEl, this.state_, this.store_,
            (track) => this.addTrack(track),
            (ti, ci, ki, val) => this.keyframeArea_?.updateKeyframeValue(ti, ci, ki, val),
            (dur) => { this.dirty_ = true; this.state_.duration = dur; },
        );
        this.trackList_ = new TimelineTrackList(
            tracksEl, this.state_,
            (from, to) => this.reorderTrack(from, to),
            (idx, oldName, newName) => this.renameTrack(idx, oldName, newName),
            (ti, ci) => this.showCurveEditor(ti, ci),
        );
        this.keyframeArea_ = new TimelineKeyframeArea(keyframesEl, this.state_, this);
        this.keyframeArea_.onKeyframeSelectionChange = (summary) => this.toolbar_?.setSelectionSummary(summary);
        this.curveEditor_ = new TimelineCurveEditor(curveEl, this.state_, this);
    }

    private updateEmptyState(): void {
        const hasFile = this.boundEntityId_ !== null && this.assetPath_ !== null;
        if (this.emptyEl_) {
            this.emptyEl_.style.display = hasFile ? 'none' : 'flex';
            const textEl = this.emptyEl_.querySelector('.es-timeline-empty-text');
            if (textEl) {
                if (this.boundEntityId_ !== null && this.assetPath_ === null) {
                    textEl.innerHTML = `
                        No timeline file assigned.<br>
                        Drag a <strong>.estimeline</strong> file to the <strong>TimelinePlayer</strong> component,<br>
                        or <button class="es-btn es-btn-sm es-timeline-create-btn">Create Timeline</button>
                    `;
                    textEl.querySelector('.es-timeline-create-btn')?.addEventListener('click', () => {
                        this.createNewTimeline();
                    });
                } else {
                    textEl.innerHTML = 'Select an entity with <strong>TimelinePlayer</strong> component to edit its timeline';
                }
            }
        }
        if (this.bodyEl_) {
            this.bodyEl_.style.display = hasFile ? 'flex' : 'none';
        }
    }

    private async createNewTimeline(): Promise<void> {
        if (this.boundEntityId_ === null) return;

        const fs = getEditorContext().fs;
        if (!fs) return;

        const projectPath = getProjectService()?.projectPath;
        if (!projectPath) return;

        const projectDir = projectPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        const entityData = this.store_.getEntityData(this.boundEntityId_ as number);
        const name = entityData?.name ?? 'timeline';
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const relativePath = `assets/${safeName}.estimeline`;
        const absPath = `${projectDir}/${relativePath}`;

        const data: TimelineAssetData = { tracks: [], duration: DEFAULT_DURATION };
        const saveData = { version: '1.0', type: 'timeline', duration: DEFAULT_DURATION, wrapMode: 'once', tracks: [] };

        try {
            await fs.writeFile(absPath, JSON.stringify(saveData, null, 2));
            this.store_.updatePropertyDirect(
                this.boundEntityId_, 'TimelinePlayer', 'timeline', relativePath,
            );
            this.loadTimeline(data, DEFAULT_DURATION, relativePath);
        } catch (err) {
            console.error('Failed to create timeline:', err);
        }
    }

    private reorderTrack(fromIndex: number, toIndex: number): void {
        if (!this.assetData_) return;
        const cmd = new ReorderTrackCommand(
            this.assetData_, fromIndex, toIndex,
            () => this.onAssetDataChanged(),
        );
        this.executeCommand(cmd);
    }

    private renameTrack(trackIndex: number, oldName: string, newName: string): void {
        if (!this.assetData_) return;
        const cmd = new RenameTrackCommand(
            this.assetData_, trackIndex, oldName, newName,
            () => this.onAssetDataChanged(),
        );
        this.executeCommand(cmd);
    }

    private addTrack(track: TimelineTrackData): void {
        if (!this.assetData_) {
            this.assetData_ = { tracks: [], duration: this.state_.duration };
            this.keyframeArea_?.setAssetData(this.assetData_);
            this.curveEditor_?.setAssetData(this.assetData_);
        }
        this.assetData_.tracks.push(track);
        this.onAssetDataChanged();
    }

    async openTimelineFile(ref: string): Promise<void> {
        if (this.dirty_) {
            await this.saveTimeline();
        }
        const fs = getEditorContext().fs;
        if (!fs) return;
        const absPath = this.resolveAssetRefToAbsPath(ref);
        if (!absPath) return;
        try {
            const content = await fs.readFile(absPath);
            if (!content) return;
            const data = JSON.parse(content) as TimelineAssetData & { duration?: number };
            const duration = data.duration ?? DEFAULT_DURATION;
            this.loadTimeline(data, duration, ref);
        } catch (err) {
            console.error('Failed to open timeline:', err);
        }
    }

    async saveTimeline(): Promise<boolean> {
        if (!this.assetData_ || !this.assetPath_ || !this.dirty_) return false;
        const fs = getEditorContext().fs;
        if (!fs) return false;
        try {
            const saveData = {
                version: '1.0',
                type: 'timeline',
                duration: this.state_.duration,
                wrapMode: (this.assetData_ as any).wrapMode ?? 'once',
                tracks: this.assetData_.tracks,
            };
            const absPath = this.resolveAssetRefToAbsPath(this.assetPath_);
            if (!absPath) return false;
            const success = await fs.writeFile(absPath, JSON.stringify(saveData, null, 2));
            if (success) {
                this.dirty_ = false;
            }
            return success;
        } catch (err) {
            console.error('Failed to save timeline:', err);
            return false;
        }
    }

    private onSelectionOrSceneChanged(): void {
        const entityData = this.store_.getSelectedEntityData();
        if (!entityData) return;

        const timelineComp = entityData.components.find(c => c.type === 'TimelinePlayer');
        if (!timelineComp) {
            if (this.boundEntityId_ === entityData.id) {
                this.clearTimeline();
            }
            return;
        }

        const wasUnbound = this.boundEntityId_ === null;
        this.boundEntityId_ = entityData.id;
        this.toolbar_?.setBoundEntity(entityData.id);

        const timelinePath = timelineComp.data['timeline'] as string | undefined;
        if (timelinePath && timelinePath !== this.assetPath_) {
            this.openTimelineFile(timelinePath);
        } else if (!timelinePath) {
            if (this.assetPath_ !== null) {
                this.clearTimeline();
                this.boundEntityId_ = entityData.id;
                this.toolbar_?.setBoundEntity(entityData.id);
            }
            this.updateEmptyState();
        } else if (wasUnbound) {
            this.updateEmptyState();
        }
    }
}
