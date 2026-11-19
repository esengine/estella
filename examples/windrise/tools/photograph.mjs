import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {serveDir} from '../../../tools/lib/staticServer.mjs';

const [build,output,...requested]=process.argv.slice(2);
if(!build||!output)throw new Error('Usage: photograph.mjs <export> <output> [oak body portrait rear profile]');
const names=requested.length?requested:['oak','body','portrait','rear','profile'];
await mkdir(output,{recursive:true});
const server=await serveDir(path.resolve(build));
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
try {
    const report={viewport:[1600,900],frames:[],warnings:[]};
    const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{
        if(message.type()==='error'&&errors.length<10)errors.push(message.text());
        if(message.type()==='warning'&&report.warnings.length<10)report.warnings.push(message.text());
    });
    for(const name of names){
        await page.goto(`http://127.0.0.1:${server.address().port}/?headless&view=${name}`);
        await page.waitForFunction(()=>window.__estellaCooked?.facts().ready,null,{timeout:60000});
        await page.waitForFunction(()=>{
            const splash=document.getElementById('es-splash');
            return !splash || Number(getComputedStyle(splash).opacity)<.001;
        },null,{timeout:15000});
        const state=await page.evaluate(()=>{
            const game=window.__estellaCooked;
            game.setPaused(true);game.step(8);
            const {photo,viewYaw,viewPitch,viewFov}=game.facts();
            return {at:game.probe(['Camera','Traveler','Statue of the wind']).at,photo,yaw:viewYaw,pitch:viewPitch,fov:viewFov};
        });
        if(!state.photo)throw Error('Photography mode was not active');
        await page.screenshot({path:path.join(output,`${name}.png`)});
        report.frames.push({name,...state});
    }
    if(errors.length)throw Error(errors.join('\n'));
    await writeFile(path.join(output,'capture.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({views:names,warnings:report.warnings}));
}finally{await browser.close();server.close();}
