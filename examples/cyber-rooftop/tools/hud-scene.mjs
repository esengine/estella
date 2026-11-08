/** Native, anchored UI over the scene. Coordinates inside each panel follow the design. */
export function buildHud({add,tr,c,rgba,read}) {
 const layout=read('src/hud-layout.json');
 const atlas=read('tools/hud-inventory-frames.json');
 const px=value=>({unit:0,value}),percent=value=>({unit:1,value});
 const canvas=add('HUD',[tr(),c('Canvas',{designResolution:{x:layout.design.width,y:layout.design.height},scaleMode:2,backgroundColor:rgba(0,0,0,0)}),c('UINode',{})]);
 const ui=(name,x,y,w,h,components=[],parent=canvas)=>add(name,[tr(),c('UINode',{position:1,insetLeft:px(x),insetTop:px(y),width:px(w),height:px(h)}),...components],parent);
 const group=(name,w,h,anchor)=>add(name,[tr(),c('UINode',{position:1,width:px(w),height:px(h),...anchor})],canvas);
 const art=(name,asset,x,y,w,h,parent)=>ui(name,x,y,w,h,[c('UIVisual',{visualType:2,texture:`assets/textures/${asset}.png`,color:rgba(1,1,1),enabled:true})],parent);
 const rect=(name,x,y,w,h,color,parent)=>ui(name,x,y,w,h,[c('UIVisual',{visualType:1,color,enabled:true})],parent);
 const label=(name,text,x,y,w,h=26,size=18,color=rgba(.93,.97,1),bold=false,align=0,parent=canvas)=>ui(name,x,y,w,h,[c('Text',{content:text,fontSize:size,fontFamily:'Microsoft YaHei, sans-serif',color,bold,align,verticalAlign:1,wordWrap:false})],parent);
 const item=(name,index,x,y,w,h,parent)=>{
   const f=atlas.frames[index],s=Math.min(w/f.width,h/f.height),dw=f.width*s,dh=f.height*s;
   return ui(name,x+(w-dw)/2,y+(h-dh)/2,dw,dh,[c('UIVisual',{visualType:2,texture:'assets/textures/hud-inventory-atlas.png',uvOffset:{x:f.x/atlas.width,y:f.y/atlas.height},uvScale:{x:f.width/atlas.width,y:f.height/atlas.height},color:rgba(1,1,1),enabled:true})],parent);
 };
 const cyan=rgba(.15,.83,.95),muted=rgba(.52,.67,.72),rule=rgba(.25,.43,.50,.70);
 const location=group('Location group',260,98,{insetLeft:px(20),insetTop:px(20)});
 art('Location panel','hud-location',0,0,260,98,location);
 art('Location icon','hud-symbol-city',13,7,43,45,location);
 label('Location','下城避难所',75,4,180,29,22,undefined,true,0,location);
 label('Day','第 07 天 · 22:16',75,32,180,26,18,undefined,false,0,location);
 rect('Location divider',9,63,242,1,rule,location);
 art('Weather icon','hud-symbol-rain',15,66,31,29,location);
 label('Weather','酸雨 · 18°C',59,66,185,29,19,undefined,false,0,location);

 const objectives=group('Objectives group',260,110,{insetLeft:px(20),insetTop:px(132)});
 art('Objectives panel','hud-objectives',0,0,260,110,objectives);
 label('Objective title','建立安全屋',17,5,232,30,22,undefined,true,0,objectives);
 rect('Objective divider',10,40,240,1,rule,objectives);
 art('Power check','hud-check-on',15,47,24,24,objectives);
 label('Power objective','接通备用电源',50,45,204,27,19,undefined,false,0,objectives);
 art('Water check','hud-check-off',15,76,24,24,objectives);
 ui('Water check completed',15,76,24,24,[c('UIVisual',{visualType:2,texture:'assets/textures/hud-check-on.png',color:rgba(1,1,1),enabled:false})],objectives);
 label('Water objective','建造净水装置  0/1',50,75,205,27,18,undefined,false,0,objectives);

 const compass=group('Compass group',650,105,{insetLeft:percent(50),marginLeft:px(-325),insetTop:px(12)});
 rect('Compass line',0,14,650,1,rgba(.66,.77,.83,.72),compass);
 for(const [i,text] of ['W','NW','N','NE','E'].entries()) {
   const x=56+i*126;
   label('Compass '+text,text,x,25,42,23,17,undefined,false,1,compass);
   rect('Compass tick '+i,x+21,14,1,10,muted,compass);
 }
 label('North marker','▼',310,-5,30,22,16,undefined,false,1,compass);
 label('Waypoint','◇  废料回收站 180 m',410,60,280,28,18,rgba(1,.76,.23),false,0,compass);

 const map=group('Minimap group',240,198,{insetRight:px(20),insetTop:px(20)});
 art('Minimap detail','hud-map',3,3,234,192,map);
 rect('Map title backing',3,3,234,28,rgba(.015,.04,.055,.85),map);
 art('Map border','hud-minimap-frame',0,0,240,198,map);
 label('Map title','区域扫描',10,3,170,25,18,undefined,false,0,map);
 label('Map north','N',212,4,22,25,18,undefined,false,1,map);
 label('Map player','▲',layout.map.playerX+9,layout.map.playerY+20.25,25,25,21,cyan,false,1,map);

 const vitals=group('Vitals group',260,174,{insetLeft:px(20),insetBottom:px(26)});
 art('Vitals panel','hud-vitals',0,0,260,174,vitals);
 for(const [i,icon,title,value,col,amount] of [[0,'health','生命','100',rgba(.12,.96,.48),1],[1,'cyber','义体','82%',cyan,.82],[2,'water','饮水','64%',cyan,.64],[3,'energy','能量','71%',rgba(1,.84,.02),.71]]) {
   const y=6+i*40;
   art('Vital icon '+i,'hud-symbol-'+icon,12,y+4,31,32,vitals);
   label('Vital label '+i,title,57,y,100,25,19,undefined,true,0,vitals);
   label('Vital value '+i,value,193,y,48,25,19,undefined,false,2,vitals);
   rect('Vital track '+i,57,y+25,layout.vitalWidth,10,rgba(.10,.21,.24,.92),vitals);
   rect('Vital fill '+i,57,y+25,layout.vitalWidth*amount,10,col,vitals);
 }

 const build=group('Build group',260,188,{insetRight:px(20),insetBottom:px(212)});
 art('Build panel','hud-build',0,0,260,188,build);
 item('Building icon',3,12,12,78,49,build);
 label('Building title','加固平台',105,10,148,31,22,undefined,true,0,build);
 rect('Build divider',12,71,234,1,rule,build);
 art('Steel icon','hud-symbol-steel',17,80,32,28,build);
 label('Steel label','废钢',59,79,100,28,20,undefined,false,0,build);
 label('Steel value','24/4',172,79,70,28,20,undefined,false,2,build);
 art('Circuit icon','hud-symbol-chip',17,117,32,28,build);
 label('Circuit label','电子元件',59,116,110,28,20,undefined,false,0,build);
 label('Circuit value','16/2',172,116,70,28,20,undefined,false,2,build);
 art('Build valid icon','hud-build-valid',16,154,25,25,build);
 label('Build status','可建造',55,151,191,29,20,rgba(.22,1,.45),true,0,build);

 const hint=group('Controls group',378,42,{insetLeft:percent(50),marginLeft:px(-189),insetBottom:px(160)});
 art('Controls frame','hud-hint',0,0,378,42,hint);
 const hints=ui('Build controls',0,0,378,42,[],hint);
 const key=(name,text,x,w)=>{
   ui(name+' cap',x,8,w,26,[c('UIVisual',{visualType:3,texture:'assets/textures/hud-keycap.png',sliceBorder:{x:5,y:5,z:5,w:5},color:rgba(1,1,1),enabled:true})],hints);
   label(name,text,x,7,w,28,16,undefined,false,1,hints);
 };
 key('Place key','鼠标左键',27,70);label('Place hint','放置',105,7,42,28,18,undefined,false,0,hints);
 key('Rotate key','R',173,25);label('Rotate hint','旋转',207,7,42,28,18,undefined,false,0,hints);
 key('Cancel key','Esc',268,39);label('Cancel hint','取消',316,7,44,28,18,undefined,false,0,hints);
 label('Controls','',10,7,358,28,17,undefined,false,1,hint);

 const q=layout.quickbar,bar=group('Quickbar group',q.width,q.height,{insetLeft:percent(50),marginLeft:px(-q.width/2),insetBottom:px(q.bottom)});
 for(let i=0;i<8;i++) {
   const x=q.first+i*q.step;
   const slot=ui('Slot '+(i+1),x,2,q.slotWidth,q.slotHeight,[c('UIVisual',{visualType:2,texture:'assets/textures/hud-slot.png',color:rgba(1,1,1),enabled:true}),c('Interactable',{enabled:true,raycastTarget:true,blockRaycast:true})],bar);
   item('Item '+i,i,9,24,76,65,slot);
   label('Slot key '+i,String(i+1),8,4,22,24,18,undefined,false,1,slot);
 }
 const select=ui('Selected slot',q.first+3*q.step,2,q.slotWidth,q.slotHeight,[],bar);
 art('Selection glow','hud-selected',-7,-7,108,110,select);
 const toast=group('Toast group',560,40,{insetLeft:percent(50),marginLeft:px(-280),insetBottom:px(228)});
 label('Toast','',0,0,560,40,21,rgba(.25,1,.85),false,1,toast);
}
