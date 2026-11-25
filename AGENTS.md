# Project priorities

- 2D and 3D are equally important product directions. Weigh 2D authoring, UI,
  sprites and animation, tilemaps, input, audio and reliable Web / minigame
  delivery together with 3D rendering, lighting, large-world features and
  character tools when choosing roadmap work and ordering cards. Do not defer
  3D behind 2D. Public descriptions (README, docs, repository summary) name
  both.
- Ongoing architecture work covers the engine and the editor. Choose improvements
  from real 2D and 3D workflows, including editing, saving, previewing and
  exporting. Look for awkward interactions and for engine and editor code that
  give different answers to the same operation.
- Review actual PR merge status and verification evidence before updating
  roadmap completion. A merged PR alone does not prove device acceptance.
- Do not add generated-by attribution or assistant co-author trailers to
  commits, pull requests, roadmap updates, or other deliverables.

# Delivery workflow

- Local verification must not launch the editor, Electron windows, or other visible
  apps. Use genuine headless browser and CLI checks.

- In this repository, commit on `master` and push it. The branch is still
  protected, but not against its administrators: a direct push goes through and
  GitHub reports that it went past the `Build passed` check, so nothing gates it.
  Run the checks the change calls for before pushing, since CI now reports on
  `master` only after the commit is there. A short-lived branch and a pull
  request are still the way for work that should wait for `Build passed` or be
  read first; such a pull request merges with a merge commit, not a squash, so
  the editor commits the submodule pointer names stay reachable. Force pushes
  and deleting `master` stay refused.

- The editor (`desktop/`, its own repository) works the same way: commit on its
  `master` and push it, past a protection that no longer binds administrators
  and has no required check. Push an editor change before the commit here that
  moves the pointer to it.

- A change someone using Estella can see gets a release note as a file of its own in
  `changelog.d/` (its `README.md` has the format), with the subjects of the commits it
  covers. Do not add notes to `CHANGELOG.md` or entries to `tools/releaseNotes.mjs` in a
  pull request: every pull request wrote to the same place in both, so any two conflicted.
  A release folds the files in with `node tools/assemble-changelog.mjs`.

- Releases are tagged on `master` after the release commit has been merged there.

- Routine roadmap work must not bump versions, create tags, or publish releases.
  Release actions require an explicit user request.
