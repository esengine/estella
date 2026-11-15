// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { ROOT as root } from './lib/repo.mjs';
const project = path.join(root, 'examples/navigation-workshop');
const textures = path.join(project, 'assets/textures');
fs.mkdirSync(textures, { recursive: true });
fs.mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
const uuid = name => {
    const h = createHash('sha256').update('estella.navigation-workshop.' + name).digest('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
fs.mkdirSync(path.join(project,'assets/navigation'),{recursive:true});
const walkable=Array.from({length:23*13},(_,i)=>{
    const x=i%23,y=Math.floor(i/23);
    return x===0||x===22||y===0||y===12||(x===11&&(y<5||y>7))?0:1;
});
fs.writeFileSync(path.join(project,'assets/navigation/courtyard.json'),JSON.stringify({
    width:23,height:13,cellSize:32,origin:{x:-352,y:-192},walkable,
},null,2)+'\n');
fs.writeFileSync(path.join(project,'assets/navigation/courtyard.json.meta'),JSON.stringify({
    uuid:uuid('terrain-layout'),version:'2.0',type:'json',importer:{},
},null,2)+'\n');
const meta = name => fs.writeFileSync(path.join(textures, name + '.png.meta'), JSON.stringify({
    uuid: uuid(name), version: '2.0', type: 'texture', importer: {
        maxSize: 2048, filterMode: 'nearest', wrapMode: 'clamp', premultiplyAlpha: false,
        sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
    },
}, null, 2) + '\n');
for (const name of ['floor', 'floor-worn', 'wall', 'knight', 'monster', 'chest', 'torch', 'stairs']) {
    fs.copyFileSync(path.join(root, 'examples/mobile-controls/assets/textures', name + '.png'), path.join(textures, name + '.png'));
    meta(name);
}
// Render the editable vector sources in a genuine headless browser.
const browser = await chromium.launch({ headless: true });
try {
    for (const [name, width, height] of [['warehouse', 96, 96], ['gate', 32, 96]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block}</style>' + fs.readFileSync(path.join(project, 'art', name + '.svg'), 'utf8'));
        await page.screenshot({ path: path.join(textures, name + '.png'), omitBackground: true });
        await page.close(); meta(name);
    }
} finally { await browser.close(); }
const entities = [];
const add = (name, components, parent = null) => {
    const id = entities.length;
    entities.push({ id, name, parent, children: [], visible: true, components });
    if (parent != null) entities[parent].children.push(id);
    return id;
};
const transform = (x = 0, y = 0, z = 0) => ({ type: 'Transform', data: { position: { x, y, z } } });
const sprite = (name, x, y, w, h, layer, color = { r: 1, g: 1, b: 1, a: 1 }, texture, extra = {}, parent = null) => add(name,
    [transform(x,y), { type: 'Sprite', data: { size: { x: w, y: h }, layer, color,
        ...(texture ? { texture: '@uuid:' + uuid(texture) } : {}), ...extra } }], parent);
add('Camera', [transform(0,0,10), { type: 'Camera', data: { projectionType: 1, orthoSize: 360, isActive: true, priority: 0 } }]);
add('Canvas', [transform(), { type: 'Canvas', data: { designResolution: { x: 1024, y: 720 }, scaleMode: 2 } }, { type: 'UINode', data: {} }]);
sprite('Backdrop',0,0,1600,1200,-10,{r:.055,g:.075,b:.105,a:1});
sprite('Courtyard shadow',8,-10,768,448,-5,{r:0,g:0,b:0,a:.4});
sprite('Courtyard frame',0,0,760,440,-4,{r:.31,g:.34,b:.34,a:1});
sprite('Frame inset',0,0,748,428,-3,{r:.12,g:.16,b:.2,a:1});
const ground = add('Courtyard tiles', [transform()]);
const walls = add('Stonework', [transform()]);
for (let row = 0; row < 13; row++) for (let col = 0; col < 23; col++) {
    const x = (col - 11) * 32, y = (row - 6) * 32;
    const wall = row === 0 || row === 12 || col === 0 || col === 22 || (col === 11 && (row < 5 || row > 7));
    const pathTile = row >= 5 && row <= 7;
    const plotTile = col >= 5 && col <= 7 && row >= 5 && row <= 7;
    sprite(`Tile ${col},${row}`,x,y,32,32,-2,
        plotTile ? {r:.58,g:.82,b:.88,a:1} : pathTile ? {r:.94,g:.89,b:.73,a:1} : {r:.68+(col+row)%2*.08,g:.75,b:.74,a:1},
        (col+row)%5 === 0 ? 'floor-worn' : 'floor', {}, ground);
    if (wall) sprite(`Wall ${col},${row}`,x,y,32,32,1,undefined,'wall',{},walls);
}
for (const x of [-352, 0, 352]) for (const y of [-128,128]) sprite('Brazier',x,y,32,32,3,undefined,'torch',{},walls);
sprite('Depot stairs',256,0,48,48,0,{r:1,g:.88,b:.6,a:1},'stairs');
sprite('Depot chest',304,96,32,32,3,undefined,'chest');
const gate = sprite('Gate',0,0,32,96,4,undefined,'gate',{ enabled: false });
entities[gate].components.push({ type: 'NavObstacle', data: { halfExtents: { x: 15, y: 47, z: 32 }, enabled: false } });
const warehouse = sprite('Warehouse',-160,0,96,96,5,undefined,'warehouse',{ enabled: false });
entities[warehouse].components.push({ type: 'NavObstacle', data: { halfExtents: { x: 46, y: 46, z: 32 }, enabled: false } });
for (let i = 0; i < 8; i++) {
    const agent = sprite(`Courier ${String(i+1).padStart(2,'0')}`, -288 + (i%3)*32, -96 + Math.floor(i/3)*32, 32,32,6,
        i%2 ? {r:.72,g:.92,b:.94,a:1} : {r:1,g:1,b:1,a:1},'knight');
    entities[agent].components.push({ type: 'NavAgent', data: { speed: 78, radius: 8, arriveRadius: 5, repathInterval: 0,
        hasTarget: true, targetX: 64+(i%5)*64, targetY: -128+Math.floor(i/5)*64, targetZ: 0 } });
}
const scene = { version: 4, name: 'Citadel route workshop', entities };
fs.writeFileSync(path.join(project,'assets/scenes/main.esscene'), '{\n  "version": 4,\n  "name": "Citadel route workshop",\n  "entities": [\n'
    + scene.entities.map(e => '    '+JSON.stringify(e)).join(',\n') + '\n  ]\n}\n');
fs.writeFileSync(path.join(project,'assets/scenes/main.esscene.meta'), JSON.stringify({uuid:uuid('main-scene'),type:'scene',version:'1.0'},null,2)+'\n');
const license = fs.readFileSync(path.join(root,'examples/mobile-controls/ASSET_LICENSES.md'),'utf8').split('## Control graphics')[0];
fs.writeFileSync(path.join(project,'ASSET_LICENSES.md'), license + '## Workshop graphics\n\n`warehouse.png` and `gate.png` are original project graphics released under CC0 1.0 Universal. Their editable SVG sources are in `art/`.\n');
console.log(`Navigation workshop: ${entities.length} authored entities, CC0 textures and editable workshop graphics.`);
