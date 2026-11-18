---
internal: The host's pause owners live in their own module, so residency no longer imports the app at run time and the import cycle through the scene plugin is gone; nothing a project can call or see changes.
commits:
  - refactor(app): the host's pause owners live in app/hostPause, so residency imports no value from app.ts and the cycle app -> scenePlugin -> residencyPlugin -> app is gone
---
