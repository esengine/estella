---
internal: The SDK's declaration build ran out of Node's default 2 GB heap on the macOS release runners and stopped v0.117.0's macOS and iOS legs; it now runs with 4 GB. Nothing a project builds or calls changes.
commits:
  - fix(sdk): give the declaration build a 4 GB heap so the macOS release legs finish
---
