import {addPlugin,defineSystem,GetWorld,Res,Query,Input,Time,Transform,Text,UINode,UIDisplay,MeshRenderer,Playthrough,AnimatorController,Animator} from 'esengine';
import type {Entity,World} from 'esengine';
import {groundHeight,home,shrine} from './world';

const quaternion=(yaw:number,pitch=0)=>({x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)});
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
addPlugin({name:'windrise',build(app){
    let yaw=home.yaw,pitch=home.pitch,distance=home.distance,elapsed=0,stamina=100,vertical=0,lift=0;
    let photo=false,front=false,activated=false,toast=0,skill=0,cooldown=0,travel=0;
    let lastMouse:{x:number;y:number}|null=null;
    const ids=new Map<string,Entity>();
    const facts={ready:false,frame:0,x:home.x,y:0,z:home.z,stamina,grounded:true,photo,front,activated,skill:0,travel:0,animation:'',handX:0,handY:0,handZ:0,handW:1};
    app.insertResource(Playthrough,{facts});
    const get=(w:World,name:string)=>{let id=ids.get(name);if(id===undefined){const e=w.findEntityByName(name);if(e===null)throw new Error(`Missing Windrise entity: ${name}`);id=e;ids.set(name,e);}return id;};
    const label=(w:World,name:string,content:string)=>{const e=get(w,name),t=w.get(e,Text);if(t.content!==content)w.insert(e,Text,{...t,content});};
    app.addSystem(defineSystem([GetWorld(),Res(Input),Res(Time),Res(AnimatorController),Query(Animator)],(w,input,time,anim,rigs)=>{
        if(w.findEntityByName('Traveler')===null)return;
        const dt=Math.min(time.delta,.05);elapsed+=dt;facts.frame++;cooldown=Math.max(0,cooldown-dt);
        const player=get(w,'Traveler'),t=w.get(player,Transform);
        if(input.isKeyPressed('Home')){t.position={x:home.x,y:groundHeight(home.x,home.z),z:home.z};yaw=home.yaw;pitch=home.pitch;front=false;lift=0;vertical=0;stamina=100;distance=home.distance;}
        if(input.isKeyPressed('KeyV'))front=!front;
        if(input.isKeyPressed('KeyP')){photo=!photo;const e=get(w,'HUD'),ui=w.get(e,UINode);w.insert(e,UINode,{...ui,display:photo?UIDisplay.None:UIDisplay.Flex});}
        const mouse=input.getMousePosition();
        distance=clamp(distance+input.getScrollDelta().y*.006,2.3,10);
        if(input.isMouseButtonDown(2)&&lastMouse){yaw-=(mouse.x-lastMouse.x)*.003;pitch=clamp(pitch-(mouse.y-lastMouse.y)*.002,-.65,.32);}
        lastMouse={...mouse};
        yaw+=(Number(input.isKeyDown('ArrowLeft'))-Number(input.isKeyDown('ArrowRight')))*dt;
        pitch=clamp(pitch+(Number(input.isKeyDown('ArrowUp'))-Number(input.isKeyDown('ArrowDown')))*dt*.5,-.65,.32);
        const forward=Number(input.isKeyDown('KeyW'))-Number(input.isKeyDown('KeyS'));
        const right=Number(input.isKeyDown('KeyD'))-Number(input.isKeyDown('KeyA'));
        const moving=forward!==0||right!==0,sprint=moving&&input.isKeyDown('ShiftLeft')&&stamina>2;
        const speed=sprint?5.7:2.65;
        stamina=clamp(stamina+(sprint?-23:14)*dt,0,100);
        if(moving){
            const a=yaw+(front?Math.PI:0),len=Math.hypot(forward,right);
            const dx=(-Math.sin(a)*forward+Math.cos(a)*right)/len,dz=(-Math.cos(a)*forward-Math.sin(a)*right)/len;
            let x=clamp(t.position.x+dx*speed*dt,-42,55),z=clamp(t.position.z+dz*speed*dt,-68,40);
            // Stone pedestal, oak roots and water define the walking area.
            const wet=groundHeight(x,z)<-1.03;
            const oak=Math.hypot(x+11,z+33)<2.7;
            const shrineBody=Math.hypot(x-shrine.x,z-shrine.z)<1.9;
            if(!wet&&!oak&&!shrineBody){travel+=Math.hypot(x-t.position.x,z-t.position.z);t.position.x=x;t.position.z=z;}
            t.rotation=quaternion(Math.atan2(dx,dz));
        }
        if(input.isKeyPressed('Space')&&lift===0){vertical=5.1;}
        vertical-=12.8*dt;lift=Math.max(0,lift+vertical*dt);if(lift===0)vertical=0;
        t.position.y=groundHeight(t.position.x,t.position.z)+lift;w.insert(player,Transform,t);
        // Every imported Animator is driven by the same movement state, including blended idle/walk/run.
        for(const [e,a] of rigs){anim.setFloat(e,'speed',moving?(sprint?1:.5):0);anim.setBool(e,'grounded',lift===0);facts.animation=a.currentState;}
        const hand=w.get(get(w,'mixamorig:RightHand'),Transform).rotation;
        Object.assign(facts,{handX:hand.x,handY:hand.y,handZ:hand.z,handW:hand.w});
        const camera=get(w,'Camera'),c=w.get(camera,Transform),a=yaw+(front?Math.PI:0);
        const focusY=t.position.y+1.1;
        c.position={x:t.position.x+Math.sin(a)*distance*Math.cos(pitch),y:focusY-Math.sin(pitch)*distance,z:t.position.z+Math.cos(a)*distance*Math.cos(pitch)};
        c.position.y=Math.max(c.position.y,groundHeight(c.position.x,c.position.z)+.35);
        c.rotation=quaternion(a,pitch);w.insert(camera,Transform,c);
        const near=Math.hypot(t.position.x-shrine.x,t.position.z-shrine.z)<4;
        label(w,'Interact',near?(activated?'F  感受风的流动':'F  与七天神像共鸣'):'');
        if(near&&input.isKeyPressed('KeyF')){activated=true;stamina=100;toast=4;label(w,'Status','风与牧歌之城 · 已与风元素共鸣');label(w,'Objective','已抵达七天神像 · 自由探索风起地');}
        if(input.isKeyPressed('KeyE')&&cooldown===0){skill=.85;cooldown=3;toast=1.4;label(w,'Status','风涡剑');for(const [e] of rigs)anim.setTrigger(e,'attack');}
        skill=Math.max(0,skill-dt);
        const burst=w.findEntityByName('Wind burst');
        if(burst!==null){const bt=w.get(burst,Transform),bm=w.get(burst,MeshRenderer);const s=1+(.85-skill)*5;bt.position={x:t.position.x,y:t.position.y+.85,z:t.position.z};bt.scale={x:s,y:s,z:s};bt.rotation=quaternion(elapsed*3);w.insert(burst,Transform,bt);if(bm.enabled!==(skill>0))w.insert(burst,MeshRenderer,{...bm,enabled:skill>0});}
        if(toast>0){toast-=dt;if(toast<=0)label(w,'Status','');}
        label(w,'Stamina',`体力  ${Math.round(stamina)}`);label(w,'Skill',cooldown>0?cooldown.toFixed(1):'E');
        Object.assign(facts,{ready:true,x:t.position.x,y:t.position.y,z:t.position.z,stamina,grounded:lift===0,photo,front,activated,skill,travel});
    },{name:'Windrise exploration'}));
}});
