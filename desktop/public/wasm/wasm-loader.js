import createModule from './esengine.js';
window.__ESEngineModule = createModule;
window.dispatchEvent(new Event('esengine-loaded'));
