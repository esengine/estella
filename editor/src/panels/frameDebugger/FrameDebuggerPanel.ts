import { FlushReason, RenderType, type DrawCallInfo, type FrameCaptureData } from 'esengine';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import {
    CHANNEL_FRAME_DEBUGGER_DATA,
    CHANNEL_FRAME_DEBUGGER_REPLAY_REQ,
    CHANNEL_FRAME_DEBUGGER_SNAPSHOT,
    type FrameDebuggerDataMessage,
    type FrameDebuggerSnapshotMessage,
} from '../../multiwindow/protocol';
import { getFrameDebuggerService } from '../../services';
import type { PanelInstance } from '../PanelRegistry';

const STAGE_LABELS = ['BG', 'OP', 'TR', 'OV'];
const STAGE_NAMES = ['Background', 'Opaque', 'Transparent', 'Overlay'];
const STAGE_COLORS = ['#6b7280', '#3b82f6', '#22c55e', '#f59e0b'];
const TYPE_LABELS: Record<number, string> = {
    [RenderType.Sprite]: 'Sprite',
    [RenderType.Spine]: 'Spine',
    [RenderType.Mesh]: 'Mesh',
    [RenderType.ExternalMesh]: 'ExtMesh',
    [RenderType.Text]: 'Text',
    [RenderType.Particle]: 'Particle',
    [RenderType.Shape]: 'Shape',
    [RenderType.UIElement]: 'UIElem',
};
const FLUSH_LABELS: Record<number, string> = {
    [FlushReason.BatchFull]: 'BatchFull',
    [FlushReason.TextureSlotsFull]: 'TexSlotsFull',
    [FlushReason.ScissorChange]: 'Scissor',
    [FlushReason.StencilChange]: 'Stencil',
    [FlushReason.MaterialChange]: 'Material',
    [FlushReason.BlendModeChange]: 'BlendMode',
    [FlushReason.StageEnd]: 'StageEnd',
    [FlushReason.TypeChange]: 'TypeChange',
    [FlushReason.FrameEnd]: 'FrameEnd',
};
const FLUSH_COLORS: Record<number, string> = {
    [FlushReason.BatchFull]: '#ef4444',
    [FlushReason.TextureSlotsFull]: '#f97316',
    [FlushReason.ScissorChange]: '#8b5cf6',
    [FlushReason.StencilChange]: '#ec4899',
    [FlushReason.MaterialChange]: '#06b6d4',
    [FlushReason.BlendModeChange]: '#14b8a6',
    [FlushReason.StageEnd]: '#6b7280',
    [FlushReason.TypeChange]: '#a3a3a3',
    [FlushReason.FrameEnd]: '#4b5563',
};
const BLEND_LABELS = ['Normal', 'Additive', 'Multiply', 'Screen', 'PremulAlpha', 'PmaAdd'];

const REPLAY_DEBOUNCE_MS = 150;

const enum Mode { Live, Paused }

export class FrameDebuggerPanel implements PanelInstance {
    private container_: HTMLElement;
    private captureData_: FrameCaptureData | null = null;
    private selectedIndex_ = -1;
    private mode_ = Mode.Live;
    private disposed_ = false;
    private replayTimer_ = 0;

    private dataUnlisten_: UnlistenFn | null = null;
    private snapshotUnlisten_: UnlistenFn | null = null;

    private listEl_!: HTMLElement;
    private detailEl_!: HTMLElement;
    private summaryEl_!: HTMLElement;
    private pipelineEl_!: HTMLElement;
    private previewCanvas_!: HTMLCanvasElement;
    private previewCtx_!: CanvasRenderingContext2D;
    private btnToggle_!: HTMLButtonElement;
    private btnPrev_!: HTMLButtonElement;
    private btnNext_!: HTMLButtonElement;
    private batchStatsEl_!: HTMLElement;

    constructor(container: HTMLElement) {
        this.container_ = container;
        this.buildUI_();
        this.startListening_();
        getFrameDebuggerService()?.start();
    }

    dispose(): void {
        this.disposed_ = true;
        if (this.replayTimer_) clearTimeout(this.replayTimer_);
        this.dataUnlisten_?.();
        this.snapshotUnlisten_?.();
        this.dataUnlisten_ = null;
        this.snapshotUnlisten_ = null;
        this.container_.innerHTML = '';
        getFrameDebuggerService()?.stop();
    }

    private buildUI_(): void {
        this.container_.innerHTML = `
            <div class="es-fd-panel">
                <div class="es-fd-toolbar">
                    <button class="es-fd-btn es-fd-btn-toggle">● Live</button>
                    <button class="es-fd-btn es-fd-btn-prev" disabled>◀</button>
                    <button class="es-fd-btn es-fd-btn-next" disabled>▶</button>
                    <span class="es-fd-summary"></span>
                </div>
                <div class="es-fd-pipeline"></div>
                <div class="es-fd-body">
                    <div class="es-fd-list"></div>
                    <div class="es-fd-detail">
                        <canvas class="es-fd-preview"></canvas>
                        <div class="es-fd-detail-info"></div>
                        <div class="es-fd-batch-stats"></div>
                    </div>
                </div>
            </div>
        `;

        this.btnToggle_ = this.container_.querySelector('.es-fd-btn-toggle') as HTMLButtonElement;
        this.btnPrev_ = this.container_.querySelector('.es-fd-btn-prev') as HTMLButtonElement;
        this.btnNext_ = this.container_.querySelector('.es-fd-btn-next') as HTMLButtonElement;
        this.summaryEl_ = this.container_.querySelector('.es-fd-summary') as HTMLElement;
        this.pipelineEl_ = this.container_.querySelector('.es-fd-pipeline') as HTMLElement;
        this.listEl_ = this.container_.querySelector('.es-fd-list') as HTMLElement;
        this.detailEl_ = this.container_.querySelector('.es-fd-detail-info') as HTMLElement;
        this.previewCanvas_ = this.container_.querySelector('.es-fd-preview') as HTMLCanvasElement;
        this.previewCtx_ = this.previewCanvas_.getContext('2d')!;
        this.batchStatsEl_ = this.container_.querySelector('.es-fd-batch-stats') as HTMLElement;

        this.btnToggle_.addEventListener('click', () => this.toggleMode_());
        this.btnPrev_.addEventListener('click', () => this.stepDrawCall_(-1));
        this.btnNext_.addEventListener('click', () => this.stepDrawCall_(1));

        this.listEl_.addEventListener('mousedown', (e) => {
            const item = (e.target as HTMLElement).closest('.es-fd-item') as HTMLElement | null;
            if (!item) return;
            const idx = parseInt(item.dataset.index!, 10);
            if (!isNaN(idx)) this.selectDrawCall_(idx);
        });

        this.pipelineEl_.addEventListener('mousedown', (e) => {
            const bar = (e.target as HTMLElement).closest('.es-fd-pipe-bar') as HTMLElement | null;
            if (!bar) return;
            const idx = parseInt(bar.dataset.index!, 10);
            if (!isNaN(idx)) this.selectDrawCall_(idx);
        });
    }

    private async startListening_(): Promise<void> {
        this.dataUnlisten_ = await listen<FrameDebuggerDataMessage>(
            CHANNEL_FRAME_DEBUGGER_DATA,
            (event) => {
                if (this.disposed_ || this.mode_ !== Mode.Live) return;
                this.captureData_ = event.payload;
                this.renderList_();
                this.renderSummary_();
                this.renderPipeline_();
                this.renderBatchStats_();
                if (this.selectedIndex_ >= 0) this.renderDetail_();
            },
        );

        this.snapshotUnlisten_ = await listen<FrameDebuggerSnapshotMessage>(
            CHANNEL_FRAME_DEBUGGER_SNAPSHOT,
            (event) => {
                if (this.disposed_) return;
                const { dataUrl, width, height } = event.payload;
                if (!dataUrl || width === 0 || height === 0) {
                    this.clearPreview_();
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    this.previewCanvas_.width = width;
                    this.previewCanvas_.height = height;
                    this.previewCanvas_.style.display = 'block';
                    this.previewCtx_.drawImage(img, 0, 0);
                };
                img.src = dataUrl;
            },
        );
    }

    private toggleMode_(): void {
        if (this.mode_ === Mode.Live) {
            this.mode_ = Mode.Paused;
            this.btnToggle_.textContent = '▶ Paused';
            this.btnToggle_.classList.add('es-fd-btn-active');
        } else {
            this.mode_ = Mode.Live;
            this.selectedIndex_ = -1;
            this.btnToggle_.textContent = '● Live';
            this.btnToggle_.classList.remove('es-fd-btn-active');
            this.clearPreview_();
        }
        this.updateNavButtons_();
    }

    private stepDrawCall_(delta: number): void {
        if (!this.captureData_ || this.mode_ !== Mode.Paused) return;
        const newIdx = this.selectedIndex_ + delta;
        if (newIdx < 0 || newIdx >= this.captureData_.drawCalls.length) return;
        this.selectedIndex_ = newIdx;
        this.renderList_();
        this.renderDetail_();
        this.scheduleReplay_();
        this.updateNavButtons_();
    }

    private updateNavButtons_(): void {
        const paused = this.mode_ === Mode.Paused;
        const count = this.captureData_?.drawCalls.length ?? 0;
        this.btnPrev_.disabled = !paused || this.selectedIndex_ <= 0;
        this.btnNext_.disabled = !paused || this.selectedIndex_ >= count - 1;
    }

    private renderPipeline_(): void {
        if (!this.captureData_) {
            this.pipelineEl_.innerHTML = '';
            return;
        }

        const { drawCalls } = this.captureData_;
        const maxTri = Math.max(1, ...drawCalls.map(dc => dc.triangleCount));

        const stageGroups = new Map<number, DrawCallInfo[]>();
        for (const dc of drawCalls) {
            let arr = stageGroups.get(dc.stage);
            if (!arr) { arr = []; stageGroups.set(dc.stage, arr); }
            arr.push(dc);
        }

        let html = '';
        for (const [stage, dcs] of stageGroups) {
            const label = STAGE_LABELS[stage] ?? '??';
            const color = STAGE_COLORS[stage] ?? '#888';
            html += `<div class="es-fd-pipe-row"><span class="es-fd-pipe-label" style="color:${color}">${label}</span><div class="es-fd-pipe-bars">`;
            for (const dc of dcs) {
                const widthPct = Math.max(2, (dc.triangleCount / maxTri) * 100);
                const bg = FLUSH_COLORS[dc.flushReason] ?? '#4b5563';
                const sel = dc.index === this.selectedIndex_ ? ' es-fd-pipe-sel' : '';
                html += `<div class="es-fd-pipe-bar${sel}" data-index="${dc.index}" style="width:${widthPct}%;background:${bg}" title="#${dc.index} ${TYPE_LABELS[dc.type] ?? ''} ${dc.triangleCount}tri ${FLUSH_LABELS[dc.flushReason] ?? ''}"></div>`;
            }
            html += '</div></div>';
        }

        this.pipelineEl_.innerHTML = html;
    }

    private selectDrawCall_(index: number): void {
        if (this.mode_ === Mode.Live) {
            this.mode_ = Mode.Paused;
            this.btnToggle_.textContent = '▶ Paused';
            this.btnToggle_.classList.add('es-fd-btn-active');
        }
        this.selectedIndex_ = index;
        this.renderList_();
        this.renderDetail_();
        this.renderPipeline_();
        this.scheduleReplay_();
        this.updateNavButtons_();
    }

    private renderList_(): void {
        if (!this.captureData_) {
            this.listEl_.innerHTML = '<div class="es-fd-empty">No capture data</div>';
            return;
        }

        const { drawCalls } = this.captureData_;
        const stageGroups = new Map<number, DrawCallInfo[]>();
        for (const dc of drawCalls) {
            let arr = stageGroups.get(dc.stage);
            if (!arr) { arr = []; stageGroups.set(dc.stage, arr); }
            arr.push(dc);
        }

        let html = '';
        for (const [stage, dcs] of stageGroups) {
            const stageName = STAGE_NAMES[stage] ?? 'Unknown';
            const stageColor = STAGE_COLORS[stage] ?? '#888';
            const tri = dcs.reduce((s, dc) => s + dc.triangleCount, 0);
            html += `<div class="es-fd-stage-group">`;
            html += `<div class="es-fd-stage-header" style="color:${stageColor}">${stageName} (${dcs.length} draws, ${tri} tri)</div>`;

            for (const dc of dcs) {
                const typeLabel = TYPE_LABELS[dc.type] ?? 'Unknown';
                const selected = dc.index === this.selectedIndex_ ? ' es-fd-item-selected' : '';
                const flushTag = dc.flushReason !== FlushReason.FrameEnd && dc.flushReason !== FlushReason.StageEnd
                    ? `<span class="es-fd-flush-tag" style="color:${FLUSH_COLORS[dc.flushReason] ?? '#888'}">⚡${FLUSH_LABELS[dc.flushReason] ?? ''}</span>`
                    : '';
                html += `<div class="es-fd-item${selected}" data-index="${dc.index}">
                    <span class="es-fd-index">#${dc.index}</span>
                    <span class="es-fd-type">${typeLabel}</span>
                    <span class="es-fd-tri">${dc.triangleCount}tri</span>
                    ${flushTag}
                </div>`;
            }
            html += '</div>';
        }

        this.listEl_.innerHTML = html;
    }

    private renderDetail_(): void {
        if (!this.captureData_ || this.selectedIndex_ < 0) {
            this.detailEl_.innerHTML = '<div class="es-fd-empty">Select a draw call</div>';
            return;
        }

        const dc: DrawCallInfo | undefined = this.captureData_.drawCalls.find(
            d => d.index === this.selectedIndex_,
        ) ?? this.captureData_.drawCalls[this.selectedIndex_];
        if (!dc) {
            this.detailEl_.innerHTML = '<div class="es-fd-empty">Draw call not found</div>';
            return;
        }
        const rows = [
            ['Stage', STAGE_NAMES[dc.stage] ?? dc.stage],
            ['Type', TYPE_LABELS[dc.type] ?? dc.type],
            ['Texture', dc.textureId],
            ['Material', dc.materialId || '(default)'],
            ['Shader', dc.shaderId || '(batch)'],
            ['Vertices', dc.vertexCount],
            ['Triangles', dc.triangleCount],
            ['Entities', dc.entityCount],
            ['Layer', dc.layer],
            ['BlendMode', BLEND_LABELS[dc.blendMode] ?? dc.blendMode],
            ['Flush Reason', FLUSH_LABELS[dc.flushReason] ?? dc.flushReason],
            ['Tex Slots', `${dc.textureSlotUsage}/8`],
        ];

        if (dc.scissorEnabled) {
            rows.push(['Scissor', `${dc.scissorX},${dc.scissorY} ${dc.scissorW}x${dc.scissorH}`]);
        }
        if (dc.stencilWrite) rows.push(['Stencil', `Write ref=${dc.stencilRef}`]);
        if (dc.stencilTest) rows.push(['Stencil', `Test ref=${dc.stencilRef}`]);

        let html = '<table class="es-fd-table">';
        for (const [label, value] of rows) {
            html += `<tr><td class="es-fd-label">${label}</td><td class="es-fd-value">${value}</td></tr>`;
        }
        html += '</table>';

        if (dc.entities.length > 0) {
            html += `<div class="es-fd-entities-title">Entities (${dc.entities.length})</div><div class="es-fd-entities">`;
            for (const eid of dc.entities) {
                html += `<div class="es-fd-entity">${eid}</div>`;
            }
            html += '</div>';
        }

        this.detailEl_.innerHTML = html;
    }

    private renderSummary_(): void {
        if (!this.captureData_) {
            this.summaryEl_.textContent = '';
            return;
        }

        const { drawCalls } = this.captureData_;
        const totalTri = drawCalls.reduce((s, dc) => s + dc.triangleCount, 0);
        const totalEnt = drawCalls.reduce((s, dc) => s + dc.entityCount, 0);

        this.summaryEl_.textContent = `${drawCalls.length} draws | ${totalTri} tri | ${totalEnt} ent`;
    }

    private renderBatchStats_(): void {
        if (!this.captureData_) {
            this.batchStatsEl_.innerHTML = '';
            return;
        }

        const { drawCalls } = this.captureData_;
        const reasonCounts = new Map<number, number>();
        for (const dc of drawCalls) {
            if (dc.flushReason === FlushReason.FrameEnd || dc.flushReason === FlushReason.StageEnd) continue;
            reasonCounts.set(dc.flushReason, (reasonCounts.get(dc.flushReason) ?? 0) + 1);
        }

        if (reasonCounts.size === 0) {
            this.batchStatsEl_.innerHTML = '';
            return;
        }

        const sorted = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
        const maxCount = sorted[0][1];

        let html = '<div class="es-fd-stats-title">Batch Breaks</div>';
        for (const [reason, count] of sorted) {
            const label = FLUSH_LABELS[reason] ?? `${reason}`;
            const color = FLUSH_COLORS[reason] ?? '#4b5563';
            const pct = (count / maxCount) * 100;
            html += `<div class="es-fd-stat-row">
                <span class="es-fd-stat-label">${label}</span>
                <div class="es-fd-stat-bar-bg"><div class="es-fd-stat-bar" style="width:${pct}%;background:${color}"></div></div>
                <span class="es-fd-stat-count">${count}</span>
            </div>`;
        }

        this.batchStatsEl_.innerHTML = html;
    }

    private scheduleReplay_(): void {
        if (this.replayTimer_) clearTimeout(this.replayTimer_);
        this.replayTimer_ = window.setTimeout(() => {
            this.doReplay_();
        }, REPLAY_DEBOUNCE_MS);
    }

    private doReplay_(): void {
        if (this.selectedIndex_ < 0 || this.mode_ !== Mode.Paused) {
            this.clearPreview_();
            return;
        }

        emit(CHANNEL_FRAME_DEBUGGER_REPLAY_REQ, { drawCallIndex: this.selectedIndex_ });
    }

    private clearPreview_(): void {
        this.previewCanvas_.style.display = 'none';
    }
}
