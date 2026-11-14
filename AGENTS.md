# Project priorities

- 2D and 3D are equally important product directions. Weigh 2D authoring, UI,
  sprites and animation, tilemaps, input, audio and reliable Web / minigame
  delivery together with 3D rendering, lighting, large-world features and
  character tools when choosing roadmap work and ordering cards. Do not defer
  3D behind 2D. Public descriptions (README, docs, repository summary) name
  both.
- Review actual PR merge status and verification evidence before updating
  roadmap completion. A merged PR alone does not prove device acceptance.
- Do not add generated-by attribution or assistant co-author trailers to
  commits, pull requests, roadmap updates, or other deliverables.

# Delivery workflow

- Local verification must not launch the editor, Electron windows, or other visible
  apps. Use genuine headless browser and CLI checks.

- Never commit or push to `master`, in this repository or in the editor
  (`desktop/`, its own repository): it is protected. Work on a short-lived branch
  cut from the latest `master`, push it, and open a pull request into `master`; it
  merges once its `Build passed` check is green, and GitHub deletes the branch
  after the merge. Merge with a merge commit, not a squash, so the editor commits
  the submodule pointer names stay reachable. Push an editor change on its branch
  before the pull request that moves the pointer to it.

- Releases are tagged on `master` after the release commit has been merged there.

- Routine roadmap work must not bump versions, create tags, or publish releases.
  Release actions require an explicit user request.
