---
section: Changed
commits:
  - feat(export): enable background shader compilation by default for Web builds
  - feat(editor): expose the platform default for shader compilation
---
**Web exports compile shaders in the background by default.** New and existing projects inherit this on their next Web export. Editor Play uses the same default. Project Settings offers Default, On and Off, and preserves an explicit choice when a project is reopened. Browsers with `KHR_parallel_shader_compile` draw materials as their programs become ready. Loading-screen warm-up remains a separate setting.

Static shadows and rain cover now redraw casters that were waiting for a shader before caching their maps.
