/**
 * @file    index.ts
 * @brief   Builder module exports
 */

export { BuildSettingsDialog, showBuildSettingsDialog } from './BuildSettingsDialog';
export { BuildService, type BuildResult, type BuildContext, type BuildOptions } from './BuildService';
export { PlayableBuilder } from './PlayableBuilder';
export { WeChatBuilder } from './WeChatBuilder';

export { BuildCache, type BuildCacheData, type FileHash, type FileChangeResult } from './BuildCache';
export { BuildProgressReporter, formatDuration, formatSize, type BuildProgress, type BuildLogEntry, type BuildPhase, type LogLevel } from './BuildProgress';
export { BuildProgressPanel, getBuildProgressPanel, showBuildProgress, hideBuildProgress, type CancelCallback } from './BuildProgressPanel';
export { BuildConfigService, getBuildConfigService, initBuildConfigService, type BuildSettingsFile } from './BuildConfigService';
export { BuildPipeline, createTask, createPlayableTasks, type BuildTask, type TaskResult, type PipelineResult } from './BuildPipeline';
export { BuildConfigIO, downloadConfigsAsFile, uploadConfigsFromFile, type ExportedConfig, type ImportResult } from './BuildConfigIO';
export { BuildHistory, formatBuildTime, formatBuildDuration, getBuildStatusIcon, getBuildStatusClass, type BuildHistoryEntry, type BuildStatus } from './BuildHistory';
export { BUILD_TEMPLATES, getTemplates, getTemplatesByPlatform, getTemplate, createConfigFromTemplate, applyTemplateToConfig, getTemplateIconSvg, type BuildTemplate } from './BuildTemplates';
export { BatchBuilder, ParallelBatchBuilder, type BatchBuildResult, type ConfigBuildResult, type BatchBuildProgress } from './BatchBuilder';
