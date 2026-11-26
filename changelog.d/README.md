# Release notes waiting for a release

A change that someone using Estella can see gets a note. Write it here, as a file of its own, and leave `CHANGELOG.md` and
`tools/releaseNotes.mjs` alone: every pull request used to add to the same place in both, so any two of them conflicted.
Two pull requests that each add a file here do not.

## A new note

`changelog.d/<a-short-name>.md`:

```markdown
---
section: Fixed
commits:
  - fix(render): the subject line of a commit this note covers, exactly as written
  - fix(render): another, if the change is several commits
---
**The headline, as one sentence.** What changed, for whoever uses it: what was wrong or missing, and what it does now.
```

`section` is one of Added, Changed, Deprecated, Removed, Fixed, Security. The note leads with its headline in bold. Under
`commits:` goes the subject of every `feat`, `fix`, `refactor` or `perf` commit the note covers, in this repository or the
editor's, each on a line of its own.
The subject may also be a double-quoted JSON string.

## A commit that belongs to a note already written

```markdown
---
note: The headline, as one sentence.
commits:
  - fix(render): a follow-up to that change
---
```

`note` is the headline of a note in `CHANGELOG.md` or in another file here (its beginning is enough).

## A commit nobody using the engine can see

```markdown
---
internal: A rename inside the renderer; nothing a project can call or draw changes.
commits:
  - refactor(render): the pass list is built in one place
---
```

## What checks it, and what a release does

`node tools/check-changelog-covers.mjs` reads these files beside `CHANGELOG.md`: every user-facing commit has to be named by
one or the other, every name has to be a commit, and a pull request that adds a note to `CHANGELOG.md` itself is refused.

A release folds them in: `node tools/assemble-changelog.mjs` moves each note under its section of `## [Unreleased]`, moves
the commits into `tools/releaseNotes.mjs`, and deletes the files. The release commit then renames that heading to the
version, as before.
