// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts — diagnostics barrel. Importing it registers the core
 *          sections (./sections side effect) and exposes the registry a plugin
 *          contributes its own through.
 */
import './sections';

export { diagnosticsRegistry, type DiagnosticSection } from './registry';
export { collectBundle, serializeBundle, bundleFileName, BUNDLE_FORMAT, type DiagnosticBundle } from './bundle';
export { exportDiagnostics } from './export';
export { captureBuildStamp, captureAppVersion } from './sections';
export { note, timelineSnapshot, clearTimeline, type TimelineEvent, type TimelineKind } from './timeline';
export { personal, resolve, placeholder, stableTag, type DetailLevel, type Personal } from './redact';
