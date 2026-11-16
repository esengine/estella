---
internal: Shared readers and sets that several modules restated now have one author; the one thing a project can see is that esengine/sound also exports readWav, the sample reader decodeWav is built on.
commits:
  - refactor(ecs): which components feed the transform composition is said once - world, the AOT dispatcher and the native AOT dispatcher each held their own set of the names Transform, Parent and Children; feedsTransformComposition is built from the component definitions and all three ask it
  - refactor(pipeline): a cooked WAV is read by the engine's decoder, and audio import settings are read against their spec - audioCook kept a RIFF walker of its own beside soundRender's decodeWav, the two already apart on the extensible-format guard; and audioImportSettings restated the bitrate choices and defaults the AUDIO importer spec declares
---
