// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** A disposable source copy with a known mock-only client key, exported through the real CLI. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { toolArgs } from '../lib/toolArgs.mjs';
const ARGS=toolArgs({wasm:null,out:null});
if(!ARGS.wasm||!ARGS.out)throw Error('Expected --wasm <runtime> --out <export>');
const workspace=process.cwd(), output=path.resolve(workspace,'output');
fs.mkdirSync(output,{recursive:true});
const temporary=fs.mkdtempSync(path.join(output,'crazygames-score-source-'));
try {
    const source=path.join(workspace,'examples/mobile-controls'), project=path.join(temporary,'game');
    fs.cpSync(source,project,{recursive:true,filter:file=>!path.relative(source,file).split(path.sep).some(part=>part.startsWith('dist-')||part==='.esengine')});
    const manifestPath=path.join(project,'project.esproject'), manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    manifest.packaging.profiles.crazygames.platforms.web.leaderboardEncryptionKey=Buffer.alloc(32,7).toString('base64');
    fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    execFileSync(process.execPath,['pipeline/bin/estella.mjs','export',project,'--profile','crazygames','--wasm',path.resolve(ARGS.wasm),'--out',path.resolve(ARGS.out)],{cwd:workspace,stdio:'inherit',windowsHide:true});
} finally {
    const resolved=path.resolve(temporary);
    if(path.dirname(resolved)!==output||!path.basename(resolved).startsWith('crazygames-score-source-'))throw Error('Unsafe temporary source path');
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:50});
}
