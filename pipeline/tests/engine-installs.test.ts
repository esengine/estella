// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a package installs on a lean engine entry.
 *
 * The failure this guards is silent by construction: a package whose page can
 * resolve a subsystem but whose code never imports it boots, draws, and is
 * simply missing physics. No test of the engine sees it, because the engine is
 * fine — it was never installed.
 */
import { describe, it, expect } from 'vitest';
import { engineInstalls, moduleChoices } from '../src/bundle/engineInstalls';
import { ESENGINE_SUBPATHS } from '../src/bundle/esengineResolve';
import { SUBSYSTEM_INSTALL, type Subsystem } from '../src/project/targetSupport';

describe('the engine modules a package installs', () => {
    it('takes a subsystem from the components its content authored', () => {
        expect(engineInstalls({ subsystems: ['tilemap', 'ai'] }))
            .toEqual({ lean: true, subpaths: ['esengine/ai', 'esengine/tilemap'], refused: [] });
    });

    it('takes one a document names by asset rather than by component', () => {
        // Nothing in a scene says "script graph"; the .esgraph it references does.
        expect(engineInstalls({ assetPaths: ['assets/logic/Door.esgraph'] }).subpaths)
            .toEqual(['esengine/logic']);
    });

    it('takes one whose evidence is the wasm it pulls in', () => {
        expect(engineInstalls({ sideModuleIds: ['physics', 'spine:4.2'] }).subpaths)
            .toEqual(['esengine/physics', 'esengine/spine']);
    });

    it('takes the word of the game\'s own scripts, which no content mentions', () => {
        expect(engineInstalls({ scriptImports: ['esengine/replication'] }).subpaths)
            .toEqual(['esengine/replication']);
    });

    it('ignores a specifier the SDK does not publish', () => {
        expect(engineInstalls({ scriptImports: ['esengine/nope', 'lodash'] }).subpaths).toEqual([]);
    });

    it('asks for nothing when everything in use is in the base entry', () => {
        expect(engineInstalls({ subsystems: ['text', 'particles', 'postprocess'] }))
            .toEqual({ lean: true, subpaths: [], refused: [] });
    });

    // Video has no subpath to install it, so a project with video cannot be lean
    // — and the whole entry carries everything, which is why the list stops
    // mattering rather than having to be completed.
    it('gives up on a lean entry when something in use has no subpath', () => {
        expect(engineInstalls({ subsystems: ['video', 'tilemap'] }).lean).toBe(false);
    });

    it('says nothing twice, however many kinds of evidence name it', () => {
        expect(engineInstalls({
            subsystems: ['ai'], assetPaths: ['a.esbt'], scriptImports: ['esengine/ai'],
        }).subpaths).toEqual(['esengine/ai']);
    });
});

/**
 * A subpath nothing can point at is one a package never installs, and the
 * symptom is a subsystem that silently does nothing in an exported game. So
 * every published subpath owes an answer here — including the two that are not
 * subsystems at all, which say so by name.
 */
describe('every subpath the SDK publishes', () => {
    /** Not subsystems: the engine module every target loads, and a platform
     *  adapter an entry picks rather than content asking for it. */
    const NOT_A_SUBSYSTEM = new Set(['esengine/wasm', 'esengine/douyin']);

    it('is named by something a project can be evidence of', () => {
        const installable = new Set<string>();
        for (const install of Object.values(SUBSYSTEM_INSTALL)) {
            if (install !== 'base' && install !== 'whole-entry') installable.add(install);
        }
        // The two tables engineInstalls keeps for evidence content does not carry
        // as a component — asked through it, so this cannot read a stale copy.
        for (const ext of ['.esgraph', '.esfsm', '.esbt']) {
            for (const s of engineInstalls({ assetPaths: [`x${ext}`] }).subpaths) installable.add(s);
        }
        for (const id of ['physics', 'physics3d', 'dragonbones', 'spine:4.2']) {
            for (const s of engineInstalls({ sideModuleIds: [id] }).subpaths) installable.add(s);
        }
        const orphans = Object.keys(ESENGINE_SUBPATHS)
            .filter((s) => !NOT_A_SUBSYSTEM.has(s) && !installable.has(s));
        expect(orphans).toEqual([]);
    });

    it('that a subsystem names is one the SDK actually publishes', () => {
        const unpublished = (Object.entries(SUBSYSTEM_INSTALL) as [Subsystem, string][])
            .filter(([, install]) => install !== 'base' && install !== 'whole-entry')
            .filter(([, install]) => !(install in ESENGINE_SUBPATHS))
            .map(([subsystem]) => subsystem);
        expect(unpublished).toEqual([]);
    });
});

/**
 * What a project SAYS, against what the build detects. Detection is right about
 * almost everything, so these two exist for what it cannot see: a module only a
 * script reaches, and a module a build must not carry whatever the content says.
 */
describe('a project that overrides what the build detected', () => {
    it('installs one nothing detected, which is what `include` is for', () => {
        const plan = engineInstalls({ choices: { 'esengine/physics': 'include' } });
        expect(plan.subpaths).toEqual(['esengine/physics']);
        expect(plan.refused).toEqual([]);
    });

    it('ignores an `include` for a module the SDK does not publish', () => {
        expect(engineInstalls({ choices: { 'esengine/nope': 'include' } }).subpaths).toEqual([]);
    });

    it('leaves out one it excluded that nothing uses', () => {
        expect(engineInstalls({
            subsystems: ['tilemap'], choices: { 'esengine/ai': 'exclude' },
        })).toMatchObject({ subpaths: ['esengine/tilemap'], refused: [] });
    });

    // The half that matters: a package missing the subsystem its own scene needs
    // boots, draws, and is simply wrong — so the export has to refuse instead.
    it('refuses one it excluded that the content uses, naming what said so', () => {
        const plan = engineInstalls({
            subsystems: ['tilemap'], choices: { 'esengine/tilemap': 'exclude' },
        });
        expect(plan.subpaths).toEqual([]);
        expect(plan.refused).toEqual([
            { specifier: 'esengine/tilemap', evidence: 'a tilemap component in the content' },
        ]);
    });

    it('names the asset that argues with an exclusion, not the module', () => {
        expect(engineInstalls({
            assetPaths: ['assets/logic/Door.esgraph'], choices: { 'esengine/logic': 'exclude' },
        }).refused[0]).toEqual({ specifier: 'esengine/logic', evidence: 'assets/logic/Door.esgraph' });
    });

    it('names the script that argues with one', () => {
        expect(engineInstalls({
            scriptImports: ['esengine/replication'], choices: { 'esengine/replication': 'exclude' },
        }).refused[0].evidence).toContain('a project script imports');
    });
});

describe('what a project said, read off its manifest', () => {
    it('is empty when it said nothing', () => {
        expect(moduleChoices(undefined)).toEqual({});
        expect(moduleChoices({})).toEqual({});
    });

    // physics.enabled was this for one module, and older projects still carry it.
    it('reads the older physics.enabled as an include', () => {
        expect(moduleChoices({ physics: { enabled: true } }))
            .toEqual({ 'esengine/physics': 'include' });
    });

    it('lets the module a project last edited win over the older field', () => {
        expect(moduleChoices({
            physics: { enabled: true }, modules: { 'esengine/physics': 'exclude' },
        })).toEqual({ 'esengine/physics': 'exclude' });
    });

    it('says nothing for physics.enabled false — off is the default, not a refusal', () => {
        expect(moduleChoices({ physics: { enabled: false } })).toEqual({});
    });
});
