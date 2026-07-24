// Translation unit so SwiftPM treats Cwgpu as a compilable C target; the actual API is
// header-only (linked against the vendored libwgpu_native).
#include "shim.h"
