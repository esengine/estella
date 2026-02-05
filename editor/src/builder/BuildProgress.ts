/**
 * @file    BuildProgress.ts
 * @brief   Build progress reporting system
 */

// =============================================================================
// Types
// =============================================================================

export type BuildPhase =
    | 'preparing'
    | 'compiling'
    | 'processing_assets'
    | 'assembling'
    | 'writing'
    | 'completed'
    | 'failed';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface BuildLogEntry {
    timestamp: number;
    level: LogLevel;
    message: string;
    phase?: BuildPhase;
}

export interface BuildProgress {
    phase: BuildPhase;
    overallProgress: number;
    currentTask: string;
    currentTaskProgress: number;
    logs: BuildLogEntry[];
    startTime: number;
    estimatedTimeRemaining?: number;
}

export type ProgressListener = (progress: BuildProgress) => void;

// =============================================================================
// Phase Weights
// =============================================================================

const PHASE_WEIGHTS: Record<BuildPhase, { start: number; end: number }> = {
    preparing: { start: 0, end: 10 },
    compiling: { start: 10, end: 50 },
    processing_assets: { start: 50, end: 80 },
    assembling: { start: 80, end: 95 },
    writing: { start: 95, end: 100 },
    completed: { start: 100, end: 100 },
    failed: { start: 0, end: 0 },
};

const PHASE_NAMES: Record<BuildPhase, string> = {
    preparing: 'Preparing build...',
    compiling: 'Compiling scripts...',
    processing_assets: 'Processing assets...',
    assembling: 'Assembling output...',
    writing: 'Writing files...',
    completed: 'Build completed',
    failed: 'Build failed',
};

// =============================================================================
// BuildProgressReporter Class
// =============================================================================

export class BuildProgressReporter {
    private progress_: BuildProgress;
    private listeners_: Set<ProgressListener>;
    private lastProgressUpdate_: number;
    private phaseTimes_: Map<BuildPhase, number>;

    constructor() {
        this.progress_ = {
            phase: 'preparing',
            overallProgress: 0,
            currentTask: '',
            currentTaskProgress: 0,
            logs: [],
            startTime: Date.now(),
        };
        this.listeners_ = new Set();
        this.lastProgressUpdate_ = Date.now();
        this.phaseTimes_ = new Map();
    }

    onProgress(listener: ProgressListener): () => void {
        this.listeners_.add(listener);
        listener(this.progress_);
        return () => this.listeners_.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners_) {
            listener({ ...this.progress_ });
        }
    }

    private calculateOverallProgress(): number {
        const weights = PHASE_WEIGHTS[this.progress_.phase];
        if (!weights) return 0;

        const phaseRange = weights.end - weights.start;
        const phaseProgress = (this.progress_.currentTaskProgress / 100) * phaseRange;
        return Math.round(weights.start + phaseProgress);
    }

    private updateEstimatedTime(): void {
        const elapsed = Date.now() - this.progress_.startTime;
        const progress = this.progress_.overallProgress;

        if (progress > 5 && progress < 95) {
            const estimatedTotal = (elapsed / progress) * 100;
            this.progress_.estimatedTimeRemaining = Math.max(0, estimatedTotal - elapsed);
        } else {
            this.progress_.estimatedTimeRemaining = undefined;
        }
    }

    setPhase(phase: BuildPhase): void {
        if (this.progress_.phase !== phase) {
            this.phaseTimes_.set(phase, Date.now());
        }

        this.progress_.phase = phase;
        this.progress_.currentTask = PHASE_NAMES[phase];
        this.progress_.currentTaskProgress = 0;
        this.progress_.overallProgress = this.calculateOverallProgress();
        this.updateEstimatedTime();

        this.log('info', `Phase: ${PHASE_NAMES[phase]}`);
        this.notify();
    }

    setCurrentTask(task: string, progress?: number): void {
        this.progress_.currentTask = task;
        if (progress !== undefined) {
            this.progress_.currentTaskProgress = Math.max(0, Math.min(100, progress));
        }
        this.progress_.overallProgress = this.calculateOverallProgress();
        this.updateEstimatedTime();

        const now = Date.now();
        if (now - this.lastProgressUpdate_ > 100) {
            this.lastProgressUpdate_ = now;
            this.notify();
        }
    }

    incrementTaskProgress(increment: number): void {
        this.progress_.currentTaskProgress = Math.min(
            100,
            this.progress_.currentTaskProgress + increment
        );
        this.progress_.overallProgress = this.calculateOverallProgress();
        this.updateEstimatedTime();

        const now = Date.now();
        if (now - this.lastProgressUpdate_ > 100) {
            this.lastProgressUpdate_ = now;
            this.notify();
        }
    }

    log(level: LogLevel, message: string): void {
        const entry: BuildLogEntry = {
            timestamp: Date.now(),
            level,
            message,
            phase: this.progress_.phase,
        };
        this.progress_.logs.push(entry);

        if (level !== 'debug') {
            this.notify();
        }
    }

    complete(): void {
        this.progress_.phase = 'completed';
        this.progress_.overallProgress = 100;
        this.progress_.currentTaskProgress = 100;
        this.progress_.currentTask = 'Build completed';
        this.progress_.estimatedTimeRemaining = 0;
        this.log('info', 'Build completed successfully');
        this.notify();
    }

    fail(error: string): void {
        this.progress_.phase = 'failed';
        this.progress_.currentTask = 'Build failed';
        this.log('error', error);
        this.notify();
    }

    getProgress(): BuildProgress {
        return { ...this.progress_ };
    }

    getDuration(): number {
        return Date.now() - this.progress_.startTime;
    }

    getLogs(): BuildLogEntry[] {
        return [...this.progress_.logs];
    }

    getLogsAsText(): string {
        return this.progress_.logs
            .map(entry => {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                const level = entry.level.toUpperCase().padEnd(5);
                return `[${time}] ${level} ${entry.message}`;
            })
            .join('\n');
    }

    reset(): void {
        this.progress_ = {
            phase: 'preparing',
            overallProgress: 0,
            currentTask: '',
            currentTaskProgress: 0,
            logs: [],
            startTime: Date.now(),
        };
        this.phaseTimes_.clear();
        this.notify();
    }
}

// =============================================================================
// Formatting Utilities
// =============================================================================

export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
}
