// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runElectron, NEEDS_XVFB} from './lib/electronRun.mjs';
import { ROOT as root } from './lib/repo.mjs';

const out=path.resolve(root,process.argv[2]??'out/release-site-frame');
const subject=path.join(out,'game');
mkdirSync(out,{recursive:true});
const exported=spawnSync(process.execPath,['pipeline/bin/estella.mjs','export','examples/celestial-heights',
    '--platform','web','--out',subject],{cwd:root,encoding:'utf8'});
if(exported.status!==0)throw Error(`Site subject export failed: ${exported.stderr}`);
const frame=path.join(out,'celestial-heights-frame.png');
const canvasFrame=path.join(out,'celestial-heights-canvas.png');
// Isolate the page compositor from the software WebGL device on a virtual
// display. Failed runs showed one-copy SharedImage allocation failures followed
// by a lost context; keep both captures and still demand an error-free game.
const softwareCompositor=NEEDS_XVFB||process.argv.includes('--software-compositor');
const capture=runElectron(['tools/launchers/launch-export.mjs','--dir',subject,'--w','1280','--h','720',
    '--settle','60','--timeout','120000','--out',frame,'--canvas-out',canvasFrame,
    ...(softwareCompositor?['--disable-gpu-compositing']:[])],{cwd:root,encoding:'utf8'});
writeFileSync(path.join(out,'capture.log'),`${capture.stdout??''}\n${capture.stderr??''}`);
if(capture.status!==0)throw Error(`Site subject capture failed: ${capture.stdout}\n${capture.stderr}`);
console.log((capture.stdout??'').trim());
const provenance={schema:1,project:'examples/celestial-heights',version:JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,
    gitSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sha256:createHash('sha256').update(readFileSync(frame)).digest('hex'),
    canvasSha256:createHash('sha256').update(readFileSync(canvasFrame)).digest('hex'),
    compositor:softwareCompositor?'software':'default',
    capture:'exported Web game, hidden Electron, 60 settled frames',width:1280,height:720};
writeFileSync(path.join(out,'hero-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify(provenance));
