// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The Xcode project an export writes, checked where it is XML rather than source.
//
// The Info.plist carries the game's own title, and a title is whatever the person
// typed. "Save & Load" produced a plist Xcode refused to read — the build failed
// with "unable to read property list", naming neither the ampersand nor the name
// it came from, so every project titled with `&`, `<` or `>` was unbuildable for
// iOS and nothing here noticed. Android was fine throughout: its manifest is
// binary AXML, where a string is a length and some bytes and nothing needs
// escaping. Only the XML path had the hole.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitIosXcodeProject } from '../../build-tools/utils/iosProject.js';
import { iosTemplateSources } from '../../build-tools/utils/nativeTemplate.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLIST_TEMPLATE = path.join(REPO, 'native', 'ios', 'App', 'Info.plist.in');
const MAIN_M = path.join(REPO, 'native', 'ios', 'App', 'main.m');
const DEFAULT_ICON_SOURCE = path.join(REPO, 'native', 'icon.png');

const APP = {
    id: 'com.example.demo', name: 'My Game', version: '1.2', versionCode: 7,
    orientation: 'portrait' as const,
};

let scratch: string;
let templateDir: string;
let contentDir: string;

beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'es-ios-'));

    templateDir = path.join(scratch, 'template');
    mkdirSync(path.join(templateDir, 'App'), { recursive: true });
    mkdirSync(path.join(templateDir, 'Estella.xcframework'), { recursive: true });
    mkdirSync(path.join(templateDir, 'assets'), { recursive: true });
    writeFileSync(path.join(templateDir, 'App', 'Info.plist.in'), readFileSync(PLIST_TEMPLATE));
    writeFileSync(path.join(templateDir, 'App', 'main.m'), readFileSync(MAIN_M));
    writeFileSync(path.join(templateDir, 'icon.png'), readFileSync(DEFAULT_ICON_SOURCE));
    writeFileSync(path.join(templateDir, 'Estella.xcframework', 'Info.plist'), '<plist/>');
    writeFileSync(path.join(templateDir, 'assets', 'esengine.native.qjsbc'), Buffer.alloc(64, 3));

    contentDir = path.join(scratch, 'dist-ios');
    mkdirSync(path.join(contentDir, 'assets', 'scenes'), { recursive: true });
    writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"main"}');
    writeFileSync(path.join(contentDir, 'app.config.json'), '{"id":"com.example.demo"}');
    writeFileSync(path.join(contentDir, 'assets/scenes/main.esscene'), '{"entities":[]}');
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const emit = (app = APP) => emitIosXcodeProject(contentDir, app, iosTemplateSources(templateDir));
const plist = () => readFileSync(path.join(contentDir, 'App', 'Info.plist'), 'utf8');

/**
 * Well-formedness, without a parser: every `&` that is not the start of an entity
 * is the defect this file exists for, and a bare `<`/`>` inside a value is the
 * same defect wearing a different character.
 */
function xmlFaults(text: string): string[] {
    const faults: string[] = [];
    for (const [, value] of text.matchAll(/<string>([\s\S]*?)<\/string>/g)) {
        if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) faults.push(`bare & in "${value}"`);
        if (/[<>]/.test(value)) faults.push(`bare angle bracket in "${value}"`);
    }
    return faults;
}

describe('the Info.plist an iOS export writes', () => {
    it('carries the title the project chose', async () => {
        await emit();
        expect(plist()).toContain('<string>My Game</string>');
    });

    it('stays parseable when the title contains an ampersand', async () => {
        await emit({ ...APP, name: 'Save & Load' });

        expect(xmlFaults(plist())).toEqual([]);
        // Escaped, not stripped: the name on the home screen is still the name.
        expect(plist()).toContain('<string>Save &amp; Load</string>');
    });

    it('stays parseable when the title contains angle brackets', async () => {
        await emit({ ...APP, name: '<Untitled>' });

        expect(xmlFaults(plist())).toEqual([]);
        expect(plist()).toContain('<string>&lt;Untitled&gt;</string>');
    });
});
