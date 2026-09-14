// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where every user-facing commit landed in the release notes.
 *
 * `check-release-metadata` reads the CHANGELOG's STRUCTURE — that a version has
 * a section, a compare link, a supported row. Nothing read its CONTENT, so a
 * feature could ship with no note and the release would still go out green. It
 * has happened in three releases running: v0.55 lost 31 commits across two
 * batches, 0.64 lost three, 0.66 lost the whole ECS speculation line plus the
 * editor crash fix — each found only by reading `git log` by hand.
 *
 * So say it once per commit instead. A commit that changes what a creator can
 * do names the note it landed under; one that does not says why. The gate holds
 * both directions: a missing commit fails, and so does a note title that no
 * longer exists in the CHANGELOG, which is what a rename would otherwise do
 * quietly.
 */

/** The release this reaches back to. Older ones are out of scope BY DECLARATION. */
export const NOTES_FLOOR = 'v0.65.0';

/**
 * Commit subject → where it landed. `note` is a CHANGELOG headline (a prefix of
 * one is enough); `internal` is the reason a creator could not observe it.
 *
 * Subjects, not hashes: a rebase changes the hash and the line it names is what
 * the reader recognises anyway.
 */
export const NOTED = {
  'fix(gates): the animator parameter census reads a blend over a plane':
    { internal: 'a gate reading a project\'s own animator files — a game plays the'
      + ' same whether or not the census can see a blend over a plane' },

  // — after 0.66.0 —
  'feat(gates): a feature that ships without a note fails the build':
    { internal: 'a gate over this repository\'s own release process — a creator'
      + ' downloads the engine, not the checks that decided it could ship' },

  // — 0.66.0, engine —
  'feat(assets): the shapes a model was authored to blend between arrive with it':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(render): a mesh is drawn in the shape its weights ask for':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a clip can say what shape a mesh is in':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): an FBX brings its blend shapes':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): a list field can say where its row names come from':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a controller is a STACK of machines, not one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): the graph ops address a layer, without a second vocabulary':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): a layer writes the part of the rig it was given':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a silent layer says nothing, including with a sprite sheet':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a 1D blend mixes its neighbours instead of picking one':
    { note: 'A blend mixes its neighbours instead of picking one.' },
  'feat(anim): a blend over a plane, by the operation the line already used':
    { note: 'A blend over a plane.' },
  'feat(examples): the third-person rig runs and swings at the same time':
    { note: 'The third-person rig runs and swings at the same time.' },
  'feat(anim): a clip means the same thing on a rig bound differently':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): a retargeted step travels as far as the rig would':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): one clip drives rigs that do not share its bone names':
    { note: 'One clip drives rigs that do not share its bone names.' },
  'feat(anim): the posed skeleton can be made to reach something':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(anim): a constraint is an edit like any other':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(ecs): a step of gameplay nobody has seen yet, and can take back':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a system asks for a speculation the way it asks for anything else':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a step can be asked whether it is a function of the world':
    { note: 'A step can be asked whether it is a function of the world.' },
  'feat(net): the rule reconciliation replays can be asked whether it replays':
    { note: 'A step can be asked whether it is a function of the world.' },
  'refactor(anim): a state says what it plays one way, from the file in':
    { note: 'A state says what it plays one way, from the file in.' },
  'fix(anim): a layer\'s clips ship, and reach the game that plays them':
    { note: 'A layer\'s clips reach the game that plays them.' },
  'fix(anim): a blend weights its displacement the way it weights its pose':
    { note: 'A blend weights its displacement the way it weights its pose.' },
  'feat(anim): the blend twins are both on the public surface':
    { note: '`isBlend1D` was never on the public surface' },
  'fix(golden): the editor\'s frame shares the rasterizer too':
    { internal: 'a verifier reading the editor\'s own capture — no packaged game changes' },
  'fix(gates): the editor capture gets the settle window the package gets':
    { internal: 'a verifier\'s timing, not the engine\'s' },

  // — 0.66.0, editor —
  'feat(inspector): a mesh\'s shapes are editable, under their own names':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(animator): the editor edits a layer, and says which one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(animator): a blend is something an author can make':
    { note: 'A blend is something an author can make.' },
  'refactor(animator): the panel asks one question about a motion, not four':
    { note: 'A state says what it plays one way, from the file in.' },
  'feat(animator): constraints are something an author can place':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(animator): an avatar can be described from the rig itself':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(animator): an avatar measures the rig it describes':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(project): an avatar is an asset the editor can make':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'fix(editor): a crash dialog must not hold the process it warns about':
    { note: 'An unexpected error no longer takes the editor with it.' },
  'fix(play): step reports the frames that ran, and the checks start from a frozen world':
    { note: '`step` reports the frames that ran, not the number it was asked for.' },
  'fix(checks): ready is not the physics module having arrived':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a four-minute step is a four-minute silence':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a file on disk is not the registry having adopted it':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): let the 3D step finish, and say how long it took':
    { internal: 'an editor check\'s own budget' },
  'fix(checks): "before" is a state the world was in, not seven moments':
    { internal: 'an editor check\'s own reading' },
  'fix(checks): a name on the command line selects again':
    { internal: 'the check runner\'s argument parsing' },
  'fix(automation): a capture waits as long as the package it is compared to':
    { internal: 'a verifier\'s timing, not the engine\'s' },
};
