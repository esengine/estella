// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The .xcodeproj an iOS export ships, written directly.
//
// An export has to be something a user can double-click, the way Unity and Godot
// hand back a complete Xcode project — not a content folder plus instructions to
// install xcodegen and run it. The project's shape is fixed (one app target, one
// xcframework, the export's own files as resources), so generating the pbxproj is
// a template, and templating it here is what removes the external tool from the
// path between "Build" and "Run".
//
// Object ids are derived from their role, so re-exporting a project rewrites the
// same file byte-for-byte instead of churning a diff.

import { createHash } from 'crypto';

/** A pbxproj object id: 24 uppercase hex chars, stable for a given role. */
function oid(role) {
    return createHash('md5').update(role).digest('hex').slice(0, 24).toUpperCase();
}

// pbxproj is OpenStep plist. A bare word may only be alphanumerics, `_`, `.` and
// `/` — notably NOT `$` or parentheses, so build-setting references like
// `$(inherited)` have to be quoted or the whole file fails to parse.
function q(value) {
    const s = String(value);
    return s !== '' && /^[A-Za-z0-9_./]+$/.test(s)
        ? s
        : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function settingsBlock(settings, indent) {
    const pad = '\t'.repeat(indent);
    return Object.entries(settings)
        .map(([k, v]) => (Array.isArray(v)
            ? `${pad}${k} = (\n${v.map((i) => `${pad}\t${q(i)},`).join('\n')}\n${pad});`
            : `${pad}${k} = ${q(v)};`))
        .join('\n');
}

// The system frameworks the host links. Passed as linker flags rather than as file
// references: they add nothing a reader of the project navigator wants to see, and
// each one would otherwise cost a PBXFileReference + PBXBuildFile pair.
const SYSTEM_FRAMEWORKS = [
    'UIKit', 'Metal', 'QuartzCore', 'IOSurface', 'CoreGraphics',
    // Core Text names the font file the glyph rasterizer parses.
    'CoreText', 'Foundation',
    // miniaudio's CoreAudio backend, linked at build time (MA_NO_RUNTIME_LINKING).
    'AVFoundation', 'CoreAudio', 'AudioToolbox',
];

/** Xcode's file type for an export resource, by extension. `folder` ships a
 *  directory as-is, keeping the cooked tree's shape inside the bundle. */
function fileType(name, isDir) {
    // An asset catalog is a directory Xcode COMPILES (actool) rather than copies —
    // which is the whole reason the app icon goes through one: since iOS 11 the
    // store takes icons no other way.
    if (name.endsWith('.xcassets')) return 'folder.assetcatalog';
    if (isDir) return 'folder';
    if (name.endsWith('.json')) return 'text.json';
    if (name.endsWith('.js')) return 'sourcecode.javascript';
    return 'file';
}

/**
 * Render the project.pbxproj for an exported game.
 *
 * @param {object} o
 * @param {string} o.name        Target + product name (the app's display name, sanitized).
 * @param {string} o.bundleId    PRODUCT_BUNDLE_IDENTIFIER.
 * @param {string} o.version     MARKETING_VERSION.
 * @param {number|string} o.versionCode  CURRENT_PROJECT_VERSION.
 * @param {string} o.deploymentTarget    IPHONEOS_DEPLOYMENT_TARGET.
 * @param {string} o.frameworkName       The xcframework's filename, at the project root.
 * @param {Array<{name: string, isDir: boolean}>} o.resources
 *        The export's own files, copied into the bundle root — where the host looks
 *        for them (it reads the bundle root, so no Content/ indirection).
 * @returns {string} project.pbxproj contents
 */
export function renderPbxproj(o) {
    const deploymentTarget = o.deploymentTarget ?? '17.0';
    const ids = {
        project: oid('project'),
        target: oid('target'),
        mainGroup: oid('group.main'),
        appGroup: oid('group.app'),
        productsGroup: oid('group.products'),
        product: oid('file.product'),
        mainSource: oid('file.main.m'),
        infoPlist: oid('file.Info.plist'),
        framework: oid(`file.${o.frameworkName}`),
        sourcesPhase: oid('phase.sources'),
        frameworksPhase: oid('phase.frameworks'),
        resourcesPhase: oid('phase.resources'),
        buildMain: oid('build.main.m'),
        buildFramework: oid(`build.${o.frameworkName}`),
        projectConfigList: oid('configlist.project'),
        targetConfigList: oid('configlist.target'),
        projectDebug: oid('config.project.Debug'),
        projectRelease: oid('config.project.Release'),
        targetDebug: oid('config.target.Debug'),
        targetRelease: oid('config.target.Release'),
    };
    const resources = o.resources.map((r) => ({
        ...r,
        fileId: oid(`file.res.${r.name}`),
        buildId: oid(`build.res.${r.name}`),
    }));

    const projectCommon = {
        ALWAYS_SEARCH_USER_PATHS: 'NO',
        CLANG_ENABLE_OBJC_ARC: 'YES',
        CLANG_ENABLE_MODULES: 'YES',
        COPY_PHASE_STRIP: 'NO',
        ENABLE_STRICT_OBJC_MSGSEND: 'YES',
        GCC_NO_COMMON_BLOCKS: 'YES',
        IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
        SDKROOT: 'iphoneos',
        // arm64 only, device and simulator alike: the engine and Dawn are both
        // built arm64, so no x86_64 slice exists for a simulator to link against.
        ARCHS: 'arm64',
        ENABLE_BITCODE: 'NO',
        TARGETED_DEVICE_FAMILY: '1,2',
    };
    const targetCommon = {
        PRODUCT_NAME: '$(TARGET_NAME)',
        PRODUCT_BUNDLE_IDENTIFIER: o.bundleId,
        MARKETING_VERSION: o.version,
        CURRENT_PROJECT_VERSION: String(o.versionCode),
        INFOPLIST_FILE: 'App/Info.plist',
        GENERATE_INFOPLIST_FILE: 'NO',
        ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
        CODE_SIGN_STYLE: 'Automatic',
        // The xcframework sits at the project root, next to the export's files.
        FRAMEWORK_SEARCH_PATHS: ['$(inherited)', '$(PROJECT_DIR)'],
        // -ObjC keeps the app delegate / view controller alive: they live in the
        // static library and nothing in main.m references them, so the linker
        // would otherwise drop those translation units.
        OTHER_LDFLAGS: ['$(inherited)', '-ObjC', '-lc++',
            ...SYSTEM_FRAMEWORKS.flatMap((f) => ['-framework', f])],
    };

    const out = [];
    const w = (line) => out.push(line);

    w('// !$*UTF8*$!');
    w('{');
    w('\tarchiveVersion = 1;');
    w('\tclasses = {');
    w('\t};');
    w('\tobjectVersion = 56;');
    w(`\trootObject = ${ids.project} /* Project object */;`);
    w('\tobjects = {');

    w('\n/* Begin PBXBuildFile section */');
    w(`\t\t${ids.buildMain} = {isa = PBXBuildFile; fileRef = ${ids.mainSource}; };`);
    w(`\t\t${ids.buildFramework} = {isa = PBXBuildFile; fileRef = ${ids.framework}; };`);
    for (const r of resources) {
        w(`\t\t${r.buildId} = {isa = PBXBuildFile; fileRef = ${r.fileId}; };`);
    }
    w('/* End PBXBuildFile section */');

    w('\n/* Begin PBXFileReference section */');
    w(`\t\t${ids.product} = {isa = PBXFileReference; explicitFileType = wrapper.application; `
        + `includeInIndex = 0; path = ${q(`${o.name}.app`)}; sourceTree = BUILT_PRODUCTS_DIR; };`);
    w(`\t\t${ids.mainSource} = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; `
        + 'path = main.m; sourceTree = "<group>"; };');
    w(`\t\t${ids.infoPlist} = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; `
        + 'path = Info.plist; sourceTree = "<group>"; };');
    w(`\t\t${ids.framework} = {isa = PBXFileReference; lastKnownFileType = wrapper.xcframework; `
        + `path = ${q(o.frameworkName)}; sourceTree = "<group>"; };`);
    for (const r of resources) {
        w(`\t\t${r.fileId} = {isa = PBXFileReference; lastKnownFileType = ${fileType(r.name, r.isDir)}; `
            + `path = ${q(r.name)}; sourceTree = "<group>"; };`);
    }
    w('/* End PBXFileReference section */');

    w('\n/* Begin PBXFrameworksBuildPhase section */');
    w(`\t\t${ids.frameworksPhase} = {`);
    w('\t\t\tisa = PBXFrameworksBuildPhase;');
    w('\t\t\tbuildActionMask = 2147483647;');
    w('\t\t\tfiles = (');
    w(`\t\t\t\t${ids.buildFramework},`);
    w('\t\t\t);');
    w('\t\t\trunOnlyForDeploymentPostprocessing = 0;');
    w('\t\t};');
    w('/* End PBXFrameworksBuildPhase section */');

    w('\n/* Begin PBXGroup section */');
    w(`\t\t${ids.mainGroup} = {`);
    w('\t\t\tisa = PBXGroup;');
    w('\t\t\tchildren = (');
    w(`\t\t\t\t${ids.appGroup} /* App */,`);
    w(`\t\t\t\t${ids.framework} /* ${o.frameworkName} */,`);
    for (const r of resources) w(`\t\t\t\t${r.fileId} /* ${r.name} */,`);
    w(`\t\t\t\t${ids.productsGroup} /* Products */,`);
    w('\t\t\t);');
    w('\t\t\tsourceTree = "<group>";');
    w('\t\t};');
    w(`\t\t${ids.appGroup} = {`);
    w('\t\t\tisa = PBXGroup;');
    w('\t\t\tchildren = (');
    w(`\t\t\t\t${ids.mainSource} /* main.m */,`);
    w(`\t\t\t\t${ids.infoPlist} /* Info.plist */,`);
    w('\t\t\t);');
    w('\t\t\tpath = App;');
    w('\t\t\tsourceTree = "<group>";');
    w('\t\t};');
    w(`\t\t${ids.productsGroup} = {`);
    w('\t\t\tisa = PBXGroup;');
    w('\t\t\tchildren = (');
    w(`\t\t\t\t${ids.product} /* ${o.name}.app */,`);
    w('\t\t\t);');
    w('\t\t\tname = Products;');
    w('\t\t\tsourceTree = "<group>";');
    w('\t\t};');
    w('/* End PBXGroup section */');

    w('\n/* Begin PBXNativeTarget section */');
    w(`\t\t${ids.target} = {`);
    w('\t\t\tisa = PBXNativeTarget;');
    w(`\t\t\tbuildConfigurationList = ${ids.targetConfigList};`);
    w('\t\t\tbuildPhases = (');
    w(`\t\t\t\t${ids.sourcesPhase},`);
    w(`\t\t\t\t${ids.frameworksPhase},`);
    w(`\t\t\t\t${ids.resourcesPhase},`);
    w('\t\t\t);');
    w('\t\t\tbuildRules = (');
    w('\t\t\t);');
    w('\t\t\tdependencies = (');
    w('\t\t\t);');
    w(`\t\t\tname = ${q(o.name)};`);
    w(`\t\t\tproductName = ${q(o.name)};`);
    w(`\t\t\tproductReference = ${ids.product};`);
    w('\t\t\tproductType = "com.apple.product-type.application";');
    w('\t\t};');
    w('/* End PBXNativeTarget section */');

    w('\n/* Begin PBXProject section */');
    w(`\t\t${ids.project} = {`);
    w('\t\t\tisa = PBXProject;');
    w('\t\t\tattributes = {');
    w('\t\t\t\tBuildIndependentTargetsInParallel = 1;');
    w('\t\t\t\tLastUpgradeCheck = 1600;');
    w('\t\t\t\tTargetAttributes = {');
    w(`\t\t\t\t\t${ids.target} = {`);
    w('\t\t\t\t\t\tCreatedOnToolsVersion = 16.0;');
    w('\t\t\t\t\t};');
    w('\t\t\t\t};');
    w('\t\t\t};');
    w(`\t\t\tbuildConfigurationList = ${ids.projectConfigList};`);
    w('\t\t\tcompatibilityVersion = "Xcode 14.0";');
    w('\t\t\tdevelopmentRegion = en;');
    w('\t\t\thasScannedForEncodings = 0;');
    w('\t\t\tknownRegions = (');
    w('\t\t\t\ten,');
    w('\t\t\t\tBase,');
    w('\t\t\t);');
    w(`\t\t\tmainGroup = ${ids.mainGroup};`);
    w(`\t\t\tproductRefGroup = ${ids.productsGroup};`);
    w('\t\t\tprojectDirPath = "";');
    w('\t\t\tprojectRoot = "";');
    w('\t\t\ttargets = (');
    w(`\t\t\t\t${ids.target},`);
    w('\t\t\t);');
    w('\t\t};');
    w('/* End PBXProject section */');

    w('\n/* Begin PBXResourcesBuildPhase section */');
    w(`\t\t${ids.resourcesPhase} = {`);
    w('\t\t\tisa = PBXResourcesBuildPhase;');
    w('\t\t\tbuildActionMask = 2147483647;');
    w('\t\t\tfiles = (');
    for (const r of resources) w(`\t\t\t\t${r.buildId} /* ${r.name} */,`);
    w('\t\t\t);');
    w('\t\t\trunOnlyForDeploymentPostprocessing = 0;');
    w('\t\t};');
    w('/* End PBXResourcesBuildPhase section */');

    w('\n/* Begin PBXSourcesBuildPhase section */');
    w(`\t\t${ids.sourcesPhase} = {`);
    w('\t\t\tisa = PBXSourcesBuildPhase;');
    w('\t\t\tbuildActionMask = 2147483647;');
    w('\t\t\tfiles = (');
    w(`\t\t\t\t${ids.buildMain},`);
    w('\t\t\t);');
    w('\t\t\trunOnlyForDeploymentPostprocessing = 0;');
    w('\t\t};');
    w('/* End PBXSourcesBuildPhase section */');

    w('\n/* Begin XCBuildConfiguration section */');
    const config = (id, name, settings) => {
        w(`\t\t${id} = {`);
        w('\t\t\tisa = XCBuildConfiguration;');
        w('\t\t\tbuildSettings = {');
        w(settingsBlock(settings, 4));
        w('\t\t\t};');
        w(`\t\t\tname = ${name};`);
        w('\t\t};');
    };
    config(ids.projectDebug, 'Debug', {
        ...projectCommon,
        DEBUG_INFORMATION_FORMAT: 'dwarf',
        ENABLE_TESTABILITY: 'YES',
        GCC_OPTIMIZATION_LEVEL: '0',
        GCC_PREPROCESSOR_DEFINITIONS: ['DEBUG=1', '$(inherited)'],
        MTL_ENABLE_DEBUG_INFO: 'INCLUDE_SOURCE',
        ONLY_ACTIVE_ARCH: 'YES',
    });
    config(ids.projectRelease, 'Release', {
        ...projectCommon,
        DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
        ENABLE_NS_ASSERTIONS: 'NO',
        MTL_ENABLE_DEBUG_INFO: 'NO',
        ONLY_ACTIVE_ARCH: 'NO',
        VALIDATE_PRODUCT: 'YES',
    });
    config(ids.targetDebug, 'Debug', targetCommon);
    config(ids.targetRelease, 'Release', targetCommon);
    w('/* End XCBuildConfiguration section */');

    w('\n/* Begin XCConfigurationList section */');
    const configList = (id, label, debug, release) => {
        w(`\t\t${id} /* Build configuration list for ${label} */ = {`);
        w('\t\t\tisa = XCConfigurationList;');
        w('\t\t\tbuildConfigurations = (');
        w(`\t\t\t\t${debug} /* Debug */,`);
        w(`\t\t\t\t${release} /* Release */,`);
        w('\t\t\t);');
        w('\t\t\tdefaultConfigurationIsVisible = 0;');
        w('\t\t\tdefaultConfigurationName = Release;');
        w('\t\t};');
    };
    configList(ids.projectConfigList, 'PBXProject', ids.projectDebug, ids.projectRelease);
    configList(ids.targetConfigList, 'PBXNativeTarget', ids.targetDebug, ids.targetRelease);
    w('/* End XCConfigurationList section */');

    w('\t};');
    w('}');
    return `${out.join('\n')}\n`;
}

/**
 * The shared scheme that makes the target runnable straight from a fresh open —
 * without one Xcode has to autocreate it, and `xcodebuild -scheme` finds nothing.
 *
 * Metal API Validation is off (`enableGPUValidationMode = "1"` — Xcode writes that
 * to mean DISABLED; enabled is the absent default). Dawn's Metal backend calls
 * `setDepthClipMode` unconditionally, and the iOS simulator's Metal does not
 * support depth clip mode at all, so the validation layer asserts on the first
 * frame — on a device it is fine, and with validation off the simulator renders
 * correctly too. A game developer writes no Metal, so the first Run should not
 * abort on a backend limitation they cannot act on. Re-enable it per project in
 * Edit Scheme → Run → Diagnostics.
 */
export function renderScheme(name) {
    const id = oid('target');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "1600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${id}"
               BuildableName = "${name}.app"
               BlueprintName = "${name}"
               ReferencedContainer = "container:${name}.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" enableGPUValidationMode = "1" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "${id}"
            BuildableName = "${name}.app"
            BlueprintName = "${name}"
            ReferencedContainer = "container:${name}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "${id}"
            BuildableName = "${name}.app"
            BlueprintName = "${name}"
            ReferencedContainer = "container:${name}.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`;
}
