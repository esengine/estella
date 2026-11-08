import { addPlugin, defineSystem, GetWorld, Res, Input, Time, Transform, MeshRenderer,
    Text, UINode, UIVisual, UIDisplay, Playthrough, UIEvents } from 'esengine';
import hudLayout from './hud-layout.json';
import type { Entity, World } from 'esengine';
import { canPlace, canWalk, costs, home, type Placement } from './building';

addPlugin({
    name: 'cyber-rooftop',
    build(app) {
        let elapsed=0, yaw=home.yaw, pitch=home.pitch, rotation=0, selected=4, building=true;
        let steel=24, circuits=16, water=64, toastTime=0, reclaimed=0, lastMouse:{x:number;y:number}|null=null;
        const placed:Placement[]=[];
        const ids=new Map<string,Entity>();
        const facts={ready:false,steel,circuits,placed:0,rotation,building,selected,valid:false,cameraX:home.x,cameraZ:home.z,purifiers:0,pointerPresses:0,frame:0};
        app.insertResource(Playthrough,{facts});
        const get=(world:World,name:string)=>{
            if(ids.has(name)) return ids.get(name)!;
            const e=world.findEntityByName(name);
            if(e===null) throw new Error(`Rooftop entity missing: ${name}`);
            ids.set(name,e);return e;
        };
        const label=(w:World,name:string,value:string)=>{
            const e=get(w,name),data=w.get(e,Text);
            if(data.content!==value) w.insert(e,Text,{...data,content:value});
        };
        const toast=(w:World,value:string)=>{label(w,'Toast',value);toastTime=3;};
        const visibility=(w:World,name:string,enabled:boolean)=>{
            const e=get(w,name),d=w.get(e,MeshRenderer); if(d.enabled!==enabled)w.insert(e,MeshRenderer,{...d,enabled});
        };
        app.addSystem(defineSystem([GetWorld(),Res(Input),Res(Time),Res(UIEvents)],(world,input,time,events)=>{
            if(world.findEntityByName('Camera')===null) return;
            facts.frame++;
            const dt=Math.min(time.delta,.05); elapsed+=dt;
            const camera=get(world,'Camera');const cam=world.get(camera,Transform);
            if(input.isKeyPressed('Home')) {yaw=home.yaw;pitch=home.pitch;cam.position={x:home.x,y:home.y,z:home.z};}
            const mouse=input.getMousePosition();
            if(input.isMouseButtonDown(2)&&lastMouse) {
                yaw-=(mouse.x-lastMouse.x)*.003;
                pitch=Math.max(-.75,Math.min(.55,pitch-(mouse.y-lastMouse.y)*.003));
            }
            lastMouse=mouse;
            yaw+=(Number(input.isKeyDown('ArrowLeft'))-Number(input.isKeyDown('ArrowRight')))*dt*.9;
            pitch=Math.max(-.75,Math.min(.55,pitch+(Number(input.isKeyDown('ArrowUp'))-Number(input.isKeyDown('ArrowDown')))*dt*.7));
            const f=Number(input.isKeyDown('KeyW'))-Number(input.isKeyDown('KeyS'));
            const s=Number(input.isKeyDown('KeyD'))-Number(input.isKeyDown('KeyA'));
            const speed=(input.isKeyDown('ShiftLeft')?5:2.8)*dt/(Math.hypot(f,s)||1);
            const nx=cam.position.x+(s*Math.cos(yaw)-f*Math.sin(yaw))*speed;
            const nz=cam.position.z+(-s*Math.sin(yaw)-f*Math.cos(yaw))*speed;
            if(canWalk(nx,cam.position.z,placed)) cam.position.x=nx;
            if(canWalk(cam.position.x,nz,placed)) cam.position.z=nz;
            cam.rotation={x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)};
            world.insert(camera,Transform,cam);
            if(input.isKeyPressed('KeyB')) building=!building;
            if(input.isKeyPressed('Escape')) building=false;
            if(input.isKeyPressed('KeyR')) rotation=(rotation+1)%4;
            for(let n=1;n<=8;n++) if(input.isKeyPressed(`Digit${n}`)) {selected=n;building=n===4||n===5;}
            for(const click of events.query('click')) {
                for(let n=1;n<=8;n++) if(click.target===get(world,`Slot ${n}`)) {selected=n;building=n===4||n===5;}
            }
            const kind=selected===5?'purifier':'platform';
            const p:Placement={x:Math.round((cam.position.x-Math.sin(yaw)*9+Math.cos(yaw)*.35)*2)/2,z:Math.round((cam.position.z-Math.cos(yaw)*9-Math.sin(yaw)*.35)*2)/2,rotation,kind};
            const bill=costs[kind]; const space=canPlace(p,placed); const funded=steel>=bill.steel&&circuits>=bill.circuits;
            const valid=space&&funded&&placed.length<12;
            const ghost=get(world,'Ghost'),ghostTr=world.get(ghost,Transform);
            ghostTr.position={x:p.x,y:.06,z:p.z};ghostTr.rotation={x:0,y:Math.sin(rotation*Math.PI/4),z:0,w:Math.cos(rotation*Math.PI/4)};
            ghostTr.scale=kind==='purifier'?{x:.3,y:4,z:.4}:{x:1,y:1,z:1};world.insert(ghost,Transform,ghostTr);
            visibility(world,'Ghost_cyan',building&&valid);
            visibility(world,'Ghost_invalid',building&&!valid);
            visibility(world,'GhostSurface_cyan',building&&valid);
            const viewportHeight=typeof window==='undefined'?940:window.innerHeight;
            if(input.isMouseButtonPressed(0)) facts.pointerPresses++;
            if(building&&input.isMouseButtonPressed(0)&&mouse.y<viewportHeight*.78) {
                if(!valid) toast(world,!space?'此处空间不足':!funded?'材料不足':'已达到本样区建造上限');
                else {
                    const n=placed.length; placed.push({...p});steel-=bill.steel;circuits-=bill.circuits;
                    const e=get(world,`Built ${n}`),t=world.get(e,Transform);
                    t.position={x:p.x,y:0,z:p.z};t.rotation=ghostTr.rotation;world.insert(e,Transform,t);
                    visibility(world,`Built ${n} platform`,true);
                    if(kind==='platform') for(const x of [-3.3,3.3])for(const z of [-2,2])visibility(world,`Built ${n} leg ${x} ${z}`,true);
                    if(kind==='purifier') {
                        const base=get(world,`Built ${n} platform`),bt=world.get(base,Transform);bt.scale={x:.018,y:.0032,z:.015};world.insert(base,Transform,bt);
                        visibility(world,`Built ${n} filter`,true);visibility(world,`Built ${n} control`,true);label(world,'Water objective','建造净水装置  1/1');water=84;
                        for(const [name,enabled] of [['Water check',false],['Water check completed',true]] as const) {
                            const check=get(world,name);world.insert(check,UIVisual,{...world.get(check,UIVisual),enabled});
                        }
                    }
                    toast(world,kind==='purifier'?'净水装置已上线 · 饮水 +20':'加固平台已放置');
                }
            }
            if(input.isKeyPressed('KeyF')) {
                if(Math.hypot(cam.position.x-15.7,cam.position.z-8)<4&&reclaimed<4) {steel+=4;circuits+=2;reclaimed++;toast(world,'回收补给 · 废钢 +4 · 电子元件 +2');}
                else toast(world,reclaimed>=4?'补给箱已回收完毕':'靠近右侧补给箱后按 F 回收');
            }
            // Train moves along its modelled rail; camera, tool and minimap stay live.
            const train=get(world,'Train'),tt=world.get(train,Transform);tt.position.x=Math.sin(elapsed*.06)*1.5;tt.position.z=tt.position.x*.48;world.insert(train,Transform,tt);
            const sel=get(world,'Selected slot'),sn=world.get(sel,UINode);sn.insetLeft={unit:0,value:hudLayout.quickbar.first+(selected-1)*hudLayout.quickbar.step};world.insert(sel,UINode,sn);
            label(world,'Building title',kind==='purifier'?'净水装置':'加固平台');
            label(world,'Steel value',`${steel}/${bill.steel}`);label(world,'Circuit value',`${circuits}/${bill.circuits}`);
            label(world,'Build status',!building?'B  进入建造':valid?'可建造':!space?'空间不足':!funded?'材料不足':'已达上限');
            const validIcon=get(world,'Build valid icon'),vi=world.get(validIcon,UIVisual);
            if(vi.enabled!==(building&&valid))world.insert(validIcon,UIVisual,{...vi,enabled:building&&valid});
            const status=get(world,'Build status'),st=world.get(status,Text);
            const statusColor=!building?{r:.61,g:.78,b:.85,a:1}:valid?{r:.22,g:1,b:.45,a:1}:{r:1,g:.25,b:.35,a:1};
            if(st.color.r!==statusColor.r)world.insert(status,Text,{...st,color:statusColor});
            label(world,'Controls',building?'':'WASD 移动   右键环视   B 建造');
            const hints=get(world,'Build controls'),hn=world.get(hints,UINode),display=building?UIDisplay.Flex:UIDisplay.None;
            if(hn.display!==display)world.insert(hints,UINode,{...hn,display});
            label(world,'Vital value 2',`${water}%`);
            const fill=get(world,'Vital fill 2'),fn=world.get(fill,UINode);fn.width={unit:0,value:hudLayout.vitalWidth*water/100};world.insert(fill,UINode,fn);
            const arrow=get(world,'Map player'),an=world.get(arrow,UINode);an.insetLeft={unit:0,value:hudLayout.map.playerX+cam.position.x*hudLayout.map.unitsToPixels};an.insetTop={unit:0,value:hudLayout.map.playerY+cam.position.z*hudLayout.map.unitsToPixels};world.insert(arrow,UINode,an);
            const at=world.get(arrow,Transform);at.rotation={x:0,y:0,z:Math.sin(-yaw/2),w:Math.cos(yaw/2)};world.insert(arrow,Transform,at);
            if(toastTime>0) {toastTime-=dt;if(toastTime<=0)label(world,'Toast','');}
            Object.assign(facts,{ready:true,steel,circuits,placed:placed.length,rotation,building,selected,valid,cameraX:cam.position.x,cameraZ:cam.position.z,purifiers:placed.filter(x=>x.kind==='purifier').length});
        },{name:'CyberRooftop'}));
    },
});
