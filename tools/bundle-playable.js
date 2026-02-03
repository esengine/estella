#!/usr/bin/env node
/**
 * Bundle ESEngine game into a single HTML file for playable ads.
 *
 * Usage:
 *   node tools/bundle-playable.js --wasm build-web-single/sdk/esengine.single.js \
 *                                 --game sdk/examples/playground/build/playable/game.js \
 *                                 --output playable.html
 */

const fs = require('fs');
const path = require('path');

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="ad.size" content="width=320,height=480">
<title>Playable</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
#canvas{display:block;width:100%;height:100%;touch-action:none}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
{{WASM_SDK}}
</script>
<script>
{{GAME_CODE}}
</script>
<script>
(function(){
  function resize(){
    var c=document.getElementById('canvas');
    var dpr=window.devicePixelRatio||1;
    c.width=window.innerWidth*dpr;
    c.height=window.innerHeight*dpr;
  }
  window.addEventListener('resize',resize);
  resize();

  ESEngineModule({
    canvas:document.getElementById('canvas'),
    print:function(t){console.log(t)},
    printErr:function(t){console.error(t)}
  }).then(function(Module){
    if(typeof Game!=='undefined'&&typeof Game.main==='function'){
      Game.main(Module);
    }else{
      console.error('Game.main not found');
    }
  }).catch(function(e){
    if(e!=='unwind'&&(!e.message||!e.message.includes('unwind'))){
      console.error('Failed:',e);
    }
  });
})();
</script>
</body>
</html>`;

function parseArgs(args) {
    const result = { wasm: null, game: null, output: 'playable.html' };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--wasm' && args[i + 1]) {
            result.wasm = args[++i];
        } else if (args[i] === '--game' && args[i + 1]) {
            result.game = args[++i];
        } else if (args[i] === '--output' && args[i + 1]) {
            result.output = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Bundle ESEngine game into single HTML for playable ads.

Usage:
  node bundle-playable.js --wasm <sdk.js> --game <game.js> [--output <out.html>]

Options:
  --wasm    Path to esengine.single.js (WASM SDK with inlined binary)
  --game    Path to game.js (IIFE bundle with SDK runtime)
  --output  Output HTML file (default: playable.html)

Example:
  node tools/bundle-playable.js \\
    --wasm build-web-single/sdk/esengine.single.js \\
    --game sdk/examples/playground/build/playable/game.js \\
    --output playable.html
`);
            process.exit(0);
        }
    }
    return result;
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.wasm) {
        console.error('Error: --wasm is required');
        process.exit(1);
    }
    if (!args.game) {
        console.error('Error: --game is required');
        process.exit(1);
    }

    if (!fs.existsSync(args.wasm)) {
        console.error(`Error: WASM SDK not found: ${args.wasm}`);
        process.exit(1);
    }
    if (!fs.existsSync(args.game)) {
        console.error(`Error: Game JS not found: ${args.game}`);
        process.exit(1);
    }

    const wasmSdk = fs.readFileSync(args.wasm, 'utf-8');
    const gameCode = fs.readFileSync(args.game, 'utf-8');

    const html = HTML_TEMPLATE
        .replace('{{WASM_SDK}}', wasmSdk)
        .replace('{{GAME_CODE}}', gameCode);

    // Ensure output directory exists
    const outDir = path.dirname(args.output);
    if (outDir && !fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(args.output, html, 'utf-8');

    const sizeKb = (fs.statSync(args.output).size / 1024).toFixed(1);
    console.log(`Created: ${args.output} (${sizeKb} KB)`);
}

main();
