// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  runtimeDecisions.mjs — the choices the engine makes for a creator, and
 *        whether the creator can see, understand and take them.
 *
 * A DECISION is a place where the runtime picks between outcomes a creator
 * cares about and could not have predicted from what they typed: which mesh a
 * view draws, which light gets a shadow tile, how much of a request a device
 * granted. Every one of them was authored by somebody who then had no way to
 * watch it happen.
 *
 * Three surfaces, and the gaps between them are the point:
 *
 *   runtime   the choice is made, and something records enough to explain it
 *   editor    a person can see the choice and the reason, where they authored it
 *   agent     the automation surface answers the same question
 *
 *   runtime > editor   the engine knows and nobody asks
 *   realm prerequisite this realm never takes the decision, so there is no
 *                      reader to owe — a different defect from a missing one
 *   agent > human      automation can reach what a person cannot (spineVersion)
 *   decision > explanation  a real choice with nothing recording why (shadow atlas)
 *
 * Like contractFacts.mjs, every citation carries a `probe`, so an entry that
 * stops being true is a FINDING rather than documentation nobody reread. What
 * this file cannot do is discover a decision: nothing in a name marks one, and
 * a rule invented for the ones that do not exist yet is how a hand-written list
 * becomes the blind spot it was written to prevent (see check-gizmo-coverage).
 * New entries arrive by somebody deciding, which is why `owed` reads as work.
 */

/**
 * @typedef {{ path: string, dir?: boolean, probe: RegExp }} Cite
 * @typedef {{ has: true, cite: Cite } | { has: false, owed: string }} Surface
 */

export const DECISIONS = [
  {
    id: 'lod.selection',
    what: 'Which stand-in mesh a view draws for an object, and whether hysteresis is holding it.',
    kind: 'view-dependent',
    owner: { path: 'src/esengine/renderer/lod/LodSelection.hpp', probe: /inline u8 selectLevel/ },
    runtime: { has: true, cite: { path: 'src/esengine/renderer/lod/LodViewState.hpp', probe: /unbiased/ } },
    editor: { has: true, cite: { path: 'desktop/src/panels/inspector/componentDecorators.tsx', probe: /Renderer\.lodInspect\(/ } },
    agent: { has: true, cite: { path: 'desktop/shared/toolCatalog.mjs', probe: /'get_lod_decision'/ } },
  },
  {
    id: 'postfx.msaa',
    what: 'How much of a multisampling request the device granted.',
    kind: 'request-vs-capability',
    owner: { path: 'src/esengine/renderer/frame/PostProcessPipeline.cpp', probe: /scene_samples_ = std::clamp/ },
    runtime: { has: true, cite: { path: 'src/esengine/bindings/PostProcessBindings.cpp', probe: /postprocess_maxMsaaSamples/ } },
    editor: { has: true, cite: { path: 'desktop/src/settings/projectSettings.ts', probe: /msaaCapability\(\)/ } },
    agent: {
      has: false,
      owed: 'the effective count is on no tool; an agent tuning quality reads the request back and '
        + 'cannot tell whether the device granted it',
    },
  },
  {
    id: 'residency.cellDemand',
    what: 'Which cells exist right now, which source demanded each, and whether a prefetch was ready in time.',
    kind: 'view-dependent',
    owner: { path: 'sdk/src/residency/cells.ts', probe: /export function desiredResidency/ },
    // The whole explanation is already built, per cell, every frame.
    runtime: { has: true, cite: { path: 'sdk/src/residency/report.ts', probe: /prefetchHits/ } },
    editor: {
      has: false,
      unavailable: 'the editor never runs the thing. Streaming turns on only when '
        + 'runtimeLoader is handed a COOKED world manifest (`config.worlds`), which only exportGame '
        + 'and the headless gameHost supply; neither the edit realm nor playHost passes one, so '
        + 'worldResidencyReport answers EMPTY in both. A panel reading it would show zeros for ever, '
        + 'and goldenProjects already records the split as deliberate ("the editor plays it whole"). '
        + 'The debt is a decision about Play, not a panel',
    },
    agent: { has: false, unavailable: 'same realm, same absence of a cooked world to report on' },
  },
  {
    id: 'shadow.atlasAllocation',
    what: 'Which casters get shadow tiles, how many cascades the sun keeps, and who is denied.',
    kind: 'contended-resource',
    owner: { path: 'src/esengine/renderer/store/ShadowPlan.hpp', probe: /inline ShadowGrant claimTiles/ },
    runtime: { has: true, cite: { path: 'src/esengine/renderer/store/ShadowPlan.hpp', probe: /grant\.refusal = why/ } },
    editor: { has: true, cite: { path: 'desktop/src/panels/inspector/componentDecorators.tsx', probe: /EditorControlSurface\.shadowStatus\(/ } },
    agent: { has: true, cite: { path: 'desktop/shared/toolCatalog.mjs', probe: /'get_shadow_status'/ } },
  },
  {
    id: 'light.cap',
    what: 'Which lights survive MAX_LIGHTS, and that the rest were dropped by brightness.',
    kind: 'contended-resource',
    owner: { path: 'src/esengine/renderer/frame/RenderFrame.cpp', probe: /std::partial_sort\(collected\.begin/ },
    runtime: { has: true, cite: { path: 'src/esengine/renderer/store/LightPlan.hpp', probe: /struct LightCapReport/ } },
    editor: { has: true, cite: { path: 'desktop/src/panels/inspector/componentDecorators.tsx', probe: /EditorControlSurface\.lightStatus\(/ } },
    agent: { has: true, cite: { path: 'desktop/shared/toolCatalog.mjs', probe: /'get_light_status'/ } },
  },
  {
    id: 'postfx.hdrFormat',
    what: 'Whether a linear-colour project got half-float intermediates or was quietly kept at LDR precision.',
    kind: 'request-vs-capability',
    owner: { path: 'src/esengine/renderer/store/HdrFormat.hpp', probe: /inline HdrFormatDecision decideHdrFormat/ },
    runtime: { has: true, cite: { path: 'src/esengine/renderer/frame/PostProcessPipeline.cpp', probe: /void PostProcessPipeline::commitFormat/ } },
    editor: { has: true, cite: { path: 'desktop/src/settings/projectSettings.ts', probe: /EditorControlSurface\.hdrFormat\(\)/ } },
    agent: { has: true, cite: { path: 'desktop/shared/toolCatalog.mjs', probe: /'get_hdr_format'/ } },
  },
  {
    id: 'texture.compressedFormat',
    what: 'Whether a cooked compressed texture was uploaded compressed, or decoded to full RGBA.',
    kind: 'request-vs-capability',
    owner: { path: 'sdk/src/asset/loaders/TextureLoader.ts', probe: /chooseEngineTargetFormat/ },
    runtime: {
      has: false,
      owed: 'the RGBA path is the else-branch of a capability test and counts nothing; a project that '
        + 'spent cook time on compression pays 4x the VRAM with no sign of it',
    },
    editor: { has: false, owed: 'the Import Settings row says what was asked for, never what was uploaded' },
    agent: { has: false, owed: 'resource_census counts bytes, not why they are that many' },
  },
  {
    id: 'project.spineVersion',
    what: 'Which Spine runtime the project bundles — a size and compatibility decision.',
    kind: 'agent-parity',
    owner: { path: 'desktop/src/project/ProjectStore.ts', probe: /async setSpineVersion/ },
    runtime: { has: true, cite: { path: 'pipeline/src/project/format.ts', probe: /spineVersion\?: string/ } },
    editor: { has: true, cite: { path: 'desktop/src/settings/projectSettings.ts', probe: /'project\.spine\.version'/ } },
    agent: { has: true, cite: { path: 'desktop/src/main.tsx', probe: /spineVersion: \(v\) => ProjectStore\.setSpineVersion/ } },
  },
  {
    id: 'project.audioConfig',
    what: 'Bus volumes, effects and duck rules — the project mixer.',
    kind: 'agent-parity',
    owner: { path: 'desktop/src/project/ProjectStore.ts', probe: /async setAudio/ },
    runtime: { has: true, cite: { path: 'pipeline/src/project/runtimeConfig.ts', probe: /audioConfig/ } },
    editor: { has: true, cite: { path: 'desktop/src/settings/projectSettings.ts', probe: /'project\.audio\.buses'/ } },
    agent: { has: true, cite: { path: 'desktop/src/main.tsx', probe: /audio: \(v\) => ProjectStore\.setAudio/ } },
  },
];
