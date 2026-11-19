import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const [references,before,after,output]=process.argv.slice(2);
if(!output)throw Error('Usage: comparisons.mjs <reference images> <before screenshots> <after screenshots> <output>');
const readJSON=async filename=>JSON.parse(await readFile(filename,'utf8'));
const oldCapture=await readJSON(path.join(before,'capture.json')),newCapture=await readJSON(path.join(after,'capture.json'));
assert.deepEqual(oldCapture.viewport,newCapture.viewport);
const cameras=[];
for(const frame of newCapture.frames){
    const old=oldCapture.frames.find(f=>f.name===frame.name);
    assert.deepEqual(old.at.Camera,frame.at.Camera,'Different camera positions for '+frame.name);
    assert.deepEqual([old.yaw,old.pitch,old.fov],[frame.yaw,frame.pitch,frame.fov],'Different lens or rotation for '+frame.name);
    assert.ok(frame.photo&&old.photo&&frame.fov>0);
    cameras.push({name:frame.name,position:frame.at.Camera,yaw:frame.yaw,pitch:frame.pitch,fovDegrees:frame.fov});
}

const refTree=path.join(references,'windrise.png'),refSheet=path.join(references,'lumine-default.jpg');
// Rectangles are in source image pixels. Old and new share the same rectangle.
const views={
    oak:{image:refTree,source:[0,0,500,500],frame:[350,0,900,900]},
    portrait:{image:refSheet,source:[1365,921,352,352],frame:[482,7,640,640]},
    body:{image:refSheet,source:[0,0,602,870],frame:[489,0,622,900]},
    rear:{image:refSheet,source:[603,0,607,870],frame:[489,0,622,900]},
    profile:{image:refSheet,source:[605,873,605,879],frame:[489,0,622,900]},
};
const boards=[
    {name:'windrise',title:'风起地 · 大橡树与七天神像',width:540,height:540,rows:[['oak','']]},
    {name:'lumine-face',title:'荧 · 面部近景',width:490,height:490,rows:[['portrait','']]},
    {name:'lumine-outfit',title:'荧 · 默认服装',width:390,height:563,rows:[['body','正面'],['rear','背面']]},
    {name:'lumine-profile',title:'荧 · 侧面轮廓',width:390,height:563,rows:[['profile','']]},
];
const labels=['原神实机参考','Estella · 修改前','Estella · 本次'];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
    const page=await browser.newPage({deviceScaleFactor:1});
    const imageCache=new Map();
    async function imageData(filename){
        if(!imageCache.has(filename)){
            const bytes=await readFile(filename);
            imageCache.set(filename,'data:image/'+(filename.endsWith('.jpg')?'jpeg':'png')+';base64,'+bytes.toString('base64'));
        }
        return imageCache.get(filename);
    }
    for(const board of boards){
        const columnWidth=board.width;
        let html='';
        for(const [key,label] of board.rows){
            const view=views[key];
            if(label)html+='<h2>'+label+'</h2>';
            html+='<section>';
            for(const [idx,filename] of [view.image,path.join(before,key+'.png'),path.join(after,key+'.png')].entries()){
                const [x,y,w,h]=idx===0?view.source:view.frame;
                const scale=Math.max(columnWidth/w,board.height/h);
                const src=await imageData(filename);
                const natural=idx===0?(key==='oak'?500:1768):1600;
                html+='<article><header>'+labels[idx]+'</header><figure style="height:'+board.height+'px">';
                html+='<img src="'+src+'" style="width:'+natural*scale+'px;left:'+(-x*scale+(columnWidth-w*scale)/2)+'px;top:'+(-y*scale+(board.height-h*scale)/2)+'px"></figure></article>';
            }
            html+='</section>';
        }
        const sheetWidth=columnWidth*3+44;
        await page.setViewportSize({width:sheetWidth,height:850});
        await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f3f1eb;color:#252a28;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif}main{padding:15px 14px 12px}h1{font-size:23px;font-weight:600;margin:0 0 11px}h2{font-size:16px;font-weight:600;margin:10px 0 1px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}article{min-width:0}header{font-size:15px;color:#46534d;padding:4px 0 6px}figure{position:relative;overflow:hidden;margin:0}img{position:absolute;max-width:none;height:auto}footer{font-size:13px;color:#56645b;margin-top:11px}</style><main><h1>'+board.title+'</h1>'+html+'<footer>两张 Estella 截图共用机位、视场角与裁切。原神参考按画面中的地标或人物轮廓对齐。</footer></main></html>');
        await page.evaluate(async()=>{await Promise.all(Array.from(document.images,i=>i.decode()));await document.fonts.ready;});
        await page.locator('main').screenshot({path:path.join(output,board.name+'.png')});
    }
    const crops=Object.fromEntries(Object.entries(views).map(([name,v])=>[name,{reference:path.basename(v.image),source:v.source,frame:v.frame}]));
    const oakFrames=await Promise.all([refTree,path.join(before,'oak.png'),path.join(after,'oak.png')].map(imageData));
    const crownEdge=await page.evaluate(async frames=>{
        const size=500,xs=Array.from({length:15},(_,i)=>Math.floor(3+i*(496-3)/14));
        const rows=[];
        for(const [index,src] of frames.entries()){
            const img=new Image();img.src=src;await img.decode();
            const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
            const ctx=canvas.getContext('2d'),square=index===0?[0,0,500,500]:[350,0,900,900];
            ctx.drawImage(img,...square,0,0,size,size);
            const data=ctx.getImageData(0,0,size,size).data;
            rows.push(xs.map(x=>{
                for(let y=0;y<240;y++){
                    let green=0;
                    for(let dx=-2;dx<=2;dx++){
                        const at=(y*size+x+dx)*4,r=data[at],g=data[at+1],b=data[at+2];
                        if(g>r*.96&&g>b*1.15&&g>75)green++;
                    }
                    if(green>=3)return y;
                }
                throw Error('No visible upper crown at column '+x);
            }));
        }
        const difference=edge=>edge.reduce((sum,y,i)=>sum+Math.abs(y-rows[0][i]),0)/xs.length;
        return {cropPixels:size,columns:xs,reference:rows[0],before:rows[1],after:rows[2],
            meanVerticalErrorBefore:difference(rows[1]),meanVerticalErrorAfter:difference(rows[2])};
    },oakFrames);
    await writeFile(path.join(output,'captures.json'),JSON.stringify({viewport:oldCapture.viewport,cameras,crops,crownEdge},null,2)+'\n');
}finally{await browser.close();}
