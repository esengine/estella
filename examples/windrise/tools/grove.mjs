// The five main forks, the crown shelves and the exposed roots are laid out in metres.
// Smaller clumps follow the shelves in three dimensions, including on the back of the oak.
const tau = Math.PI * 2;
const clamp = n => Math.max(0, Math.min(1, n));
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, n) => a.map(v => v * n);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const mix = (a, b, f) => a.map((v, i) => v + (b[i]-v)*f);

// The old oak falls away more steeply toward its eastern limb. Keep the
// underside open while lowering the high outer shelves on either side.
function crownHeight(x,y,z){
    const east=.96*x-.28*z,distance=Math.abs(east);
    const shoulder=1-Math.exp(-Math.pow(distance/6.8,1.55));
    const crest=1.22*Math.exp(-east*east/24);
    const westShelf=2.45/(1+Math.exp(.60*(east+13.8)))-1.12*Math.exp(-((east+7)**2)/15);
    const eastShelf=.73*Math.exp(-((east-14)**2)/21)-.75*Math.exp(-((east-5)**2)/14);
    const top=clamp((y-10)/13),weight=top*top*(3-2*top);
    return y+weight*(crest+westShelf+eastShelf-shoulder*(3.2+.16*distance)-.09*Math.max(0,east));
}

function randomSource(seed) {
    return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
}

function spline(points, section, t) {
    const a=points[Math.max(0,section-1)], b=points[section];
    const c=points[section+1], d=points[Math.min(points.length-1,section+2)];
    return b.map((v,i)=>.5*(2*v+(-a[i]+c[i])*t+(2*a[i]-5*v+4*c[i]-d[i])*t*t
        +(-a[i]+3*v-3*c[i]+d[i])*t*t*t));
}

function bough(mesh, points, origin, size, sides, steps, twist) {
    const samples=[];
    for(let j=0;j<points.length-1;j++)for(let k=0;k<steps;k++)samples.push(spline(points,j,k/steps));
    samples.push(points.at(-1));
    let axis=null, previous=null, length=0;
    for(const [j, p] of samples.entries()) {
        const before=samples[Math.max(0,j-1)], next=samples[Math.min(samples.length-1,j+1)];
        const tangent=norm(next.slice(0,3).map((v,i)=>v-before[i]));
        if(!axis)axis=Math.abs(tangent[1])>.9?[1,0,0]:[0,1,0];
        axis=norm(add(axis,scale(tangent,-dot(axis,tangent))));
        const perpendicular=cross(tangent,axis), ring=[];
        if(j)length+=Math.hypot(...p.slice(0,3).map((v,i)=>v-before[i]));
        for(let k=0;k<=sides;k++) {
            const a=tau*k/sides, winding=twist+.06*length;
            const ridge=.085*Math.cos(5*a+winding)+.042*Math.sin(9*a-winding)+.035*Math.cos(3*a+winding*.34);
            const normal=norm(add(scale(axis,Math.cos(a)),scale(perpendicular,Math.sin(a))));
            const radius=Math.max(.015,p[3])*(1+ridge);
            const position=add(origin,scale(add(p.slice(0,3),scale(normal,radius)),size));
            const light=clamp(.38+dot(normal,[-.42,.80,.35])*.28+ridge*1.5);
            const moss=clamp(normal[1]*.8+.28*(1-clamp(p[1]/4))-.09);
            ring.push(mesh.v(position,normal,[light,moss,1,1],[k/sides,length*.12]));
        }
        if(previous)for(let k=0;k<sides;k++){
            mesh.tri(previous[k],ring[k],ring[k+1]);mesh.tri(previous[k],ring[k+1],previous[k+1]);
        }
        previous=ring;
    }
}

// These forks do not share a single junction. The rear leader carries the high crown.
const forks = [
 [[0,-.8,0,4.1],[-.7,2.6,.2,3.15],[-.5,6,.4,2.6],[.3,9.8,.1,2.23],[1.7,13,-.65,1.7],[1.5,17.5,-1.4,1.08],[-.8,22,-2,.49],[-3.4,25.2,-1,.06]],
 [[-.7,5,.4,1.65],[-2.4,7.6,.8,1.75],[-5.7,9.5,.1,1.33],[-9.1,10.4,-.6,1.04],[-13.1,12.9,0,.70],[-16.6,16.8,1.2,.36],[-19.4,19,2.4,.04]],
 [[-.4,7,-.2,1.85],[1.7,10.1,-.8,1.59],[3.5,13.4,-.1,1.35],[7.6,15.1,.9,1.04],[12.2,15.4,2,.76],[16.5,16.8,4,.48],[20.5,18.6,5,.10]],
 [[.4,9.9,-.7,1.35],[2.9,13,-3.8,1.25],[4.2,14.8,-7,1.02],[7.5,18,-12,.7],[9,21,-16,.33],[11,23,-17,.05]],
 [[-1,6.9,.7,1.4],[-2.1,10,3.7,1.25],[-4.8,13.2,6.9,.88],[-6.0,15,11.4,.63],[-10.4,17.8,15.6,.31],[-13.3,18.9,17.5,.04]],
 [[-6,9.5,.1,.88],[-7.8,12.2,-2,.78],[-8.3,15.1,-5.7,.54],[-12.1,18.3,-8,.29],[-16,20,-9,.035]],
 [[7.4,15,1,.74],[9,17,4.3,.63],[10.4,19.2,7,.38],[15,21.4,10,.04]],
];

function trunk(mesh,origin,size,rng,hero) {
    for(const [i,points] of forks.entries()){
        const branches=hero?points.map(([x,y,z,r])=>[x,crownHeight(x,y,z),z,r]):points.map(([x,y,z,r])=>[x*.54,y*.82,z*.54,r*(i===0?.86:.62)]);
        if(hero) bough(mesh,branches,origin,size,28,5,i*.73);
        else if(i<5) {
            // At this scale the outer forks end inside the foliage. Keep the
            // branching silhouette with one tapered ring at each visible bend.
            const bends=branches.filter((_,j)=>j%2===0 || j===branches.length-1);
            bough(mesh,bends,origin,size,6,1,i*.73);
        }
    }
    const arms=hero?13:6;
    for(let i=0;i<arms;i++) {
        const a=(i+rng()*.55)*tau/arms, dx=Math.cos(a), dz=Math.sin(a);
        const reach=5.3+rng()*5.1, curve=(rng()-.5)*2.8;
        if(!hero) {
            if(i%2===0) bough(mesh,[[0,2.1,0,1.3],[dx*3,.5,dz*3,.75],[dx*reach,-.6,dz*reach,.05]],origin,size,4,1,a);
            continue;
        }
        bough(mesh,[[0,2.9,0,1.48],[dx*2,1.6,dz*2,1.23],[dx*4.2,.51,dz*4.2,.75],
            [dx*reach*.78-dz*curve,.14,dz*reach*.78+dx*curve,.37],
            [dx*reach-dz*curve,-.61,dz*reach+dx*curve,.03]],origin,size,14,3,a);
    }
}

// Each lobe has a convex skin and overlapping sprays oriented along its actual surface.
// The occlusion term favours the exposed sky side of the full canopy, not each leaf independently.
function lobe(mesh,center,radii,crown,rng,count,size) {
    const offset=rng()*tau;
    for(let i=0;i<count;i++){
        const ny=1-2*(i+.5)/count, phi=i*2.399963+offset+(rng()-.5)*.28;
        const side=Math.sqrt(1-ny*ny);
        const hemisphere=[Math.cos(phi)*side,ny,Math.sin(phi)*side];
        const n=norm(hemisphere.map((v,j)=>v/radii[j]));
        const shape=1+.15*Math.sin(phi*3+offset)*side+.10*Math.cos(phi*5-ny*3)+(rng()-.5)*.21;
        const local=add(center,hemisphere.map((v,k)=>v*radii[k]*shape));
        const exposureHeight=local[1];
        if(crown.fringe)local[1]=crownHeight(...local);
        const p=add(crown.origin,scale(local,size));
        let horizontal=norm(cross([0,1,0],n));
        const up=norm(add(cross(n,horizontal),scale(n,(rng()-.36)*1.1))),rot=(rng()-.5)*1.18;
        const u=add(scale(horizontal,Math.cos(rot)),scale(up,Math.sin(rot)));
        const v=add(scale(up,Math.cos(rot)),scale(horizontal,-Math.sin(rot)));
        const width=(.235+rng()*.14)*Math.max(radii[0],radii[2])*size;
        const height=width*(.85+rng()*.31);
        const macro=norm([local[0]/27,(exposureHeight-18)/9.5,local[2]/20]);
        const sky=clamp((exposureHeight-10)/17);
        const direct=dot(n,[-.43,.77,.30])*.28+dot(macro,[-.43,.77,.30])*.23;
        const value=clamp(.084+sky*.59+direct+(rng()-.5)*.14-crown.blue*.16);
        // A tuft on a valley tree is only a few pixels across. Its four corners
        // carry the same outline, UVs and sky gradient as the curved hero tuft.
        const segments=crown.distant?1:2, rows=[];
        for(let y=0;y<=segments;y++){
            const row=[];
            for(let x=0;x<=segments;x++){
                const s=2*x/segments-1,t=2*y/segments-1;
                const point=add(p,add(add(scale(u,s*width),scale(v,t*height)),scale(n,(1-s*s*.48-t*t*.48)*width*.23)));
                row.push(mesh.v(point,n,[clamp(value+t*.064),crown.blue,.1,1],[x/segments,y/segments]));
            }
            rows.push(row);
        }
        for(let y=0;y<segments;y++)for(let x=0;x<segments;x++){
            mesh.tri(rows[y][x],rows[y][x+1],rows[y+1][x+1]);
            mesh.tri(rows[y][x],rows[y+1][x+1],rows[y+1][x]);
        }
        if(crown.fringe){
            const shoots=crown.fringe;
            for(let sprig=0;sprig<6;sprig++){
                const along=(rng()-.5)*1.9,across=(rng()-.4)*1.8;
                const centre=add(add(p,add(scale(u,width*along),scale(v,height*across))),scale(n,width*(.18+rng()*.32)));
                const theta=rng()*tau,tilt=(rng()-.4)*1.75;
                const axis=[Math.cos(theta),0,Math.sin(theta)],other=[-Math.sin(theta)*Math.sin(tilt),Math.cos(tilt),Math.cos(theta)*Math.sin(tilt)];
                const reach=width*(.19+rng()*.18);
                const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>add(centre,scale(add(scale(axis,s),scale(other,t)),reach)));
                shoots.quad(points,[clamp(value+(rng()-.3)*.13),crown.blue,0,1],n);
            }
        }
    }
}

function crown(mesh,origin,size,rng,hero,blue,fringe=null) {
    const shelf=(x,y,z,rx,ry,rz)=>lobe(mesh,[x,(y-18)*.82+17.65,z],[rx,ry*.87,rz],{origin,blue,fringe,distant:!hero},rng,hero?91:32,size);
    if(!hero){
        shelf(-1,22.5,0,9,8.5,8);
        for(let i=0;i<7;i++){
            const a=(i+rng()*.4)*tau/7,r=6+rng()*3;
            shelf(Math.cos(a)*r,17+rng()*4,Math.sin(a)*r,6+rng()*2,6+rng()*2.5,7);
        }
        return;
    }
    shelf(-1.4,24.2,-2,8.3,5.25,7.7);
    shelf(4.3,24.0,-1.8,8.8,5.0,6.4);
    for(let ring=1;ring<=3;ring++){
        const count=[0,9,15,21][ring];
        for(let i=0;i<count;i++){
            const a=(i+(rng()-.5)*.45)*tau/count+ring*.42;
            const r=ring/3, wav=1+.09*Math.cos(a*3+.35)+.06*Math.sin(a*5);
            const x=Math.cos(a)*r*24.8*wav, z=Math.sin(a)*r*17.4*wav;
            const y=25.3-10.5*r*r+Math.sin(a*3+r)*1.5+(rng()-.5)*2.2;
            shelf(x,y,z,5.6+rng()*2.0,4.5+rng()*1.9,4.8+rng()*2.7);
            if(hero&&ring===3&&i%3!==1)shelf(x*.99,y-1.7-rng()*2,z*1.02,3.65,2.8+rng()*1.3,4.0);
        }
    }
}

export function buildGrove({Mesh,H,woodMaterial,leafMaterial}) {
    const wood=new Mesh(), leaves=new Mesh(),sprays=new Mesh();
    const rng=randomSource(401953),origin=[-11,H(-11,-33),-33];
    trunk(wood,origin,1,rng,true);crown(leaves,origin,1,rng,true,0,sprays);
    wood.save('Great oak trunk',woodMaterial);
    leaves.save('Great oak crown',leafMaterial,null,{texture:'assets/textures/oak-tuft.png'});
    sprays.save('Great oak outer sprays',leafMaterial,null,{texture:'assets/textures/oak-leaves.png',castShadows:false});

    const banks=[{name:'Valley woodland',hedges:new Mesh(),branches:new Mesh()},{name:'South woodland',hedges:new Mesh(),branches:new Mesh()}];
    const tree=(x,z,sz,blue)=>{
        const {hedges,branches}=banks[z>0?1:0];
        const at=[x,H(x,z),z];
        trunk(branches,at,sz,rng,false);crown(hedges,at,sz,rng,false,blue);
    };
    // Tree lines hug the far bank and foothills, in groves with clearings between them.
    for(const [cx,cz,number,radius] of [[-52,-64,13,24],[37,-71,17,22],[-4,-105,18,36],[86,-122,13,34],[-95,-110,12,28],[16,98,15,37],[-58,78,9,23]]){
        for(let k=0;k<number;k++){
            const a=rng()*tau,r=radius*Math.sqrt(rng());
            tree(cx+Math.cos(a)*r,cz+Math.sin(a)*r,.115+rng()*.135,.36+rng()*.40);
        }
    }
    for(const {name,branches,hedges} of banks) {
        branches.save(name+' trunks',woodMaterial,null,{castShadows:false});
        hedges.save(name+' crowns',leafMaterial,null,{texture:'assets/textures/oak-tuft.png',castShadows:false});
    }

    const bushes=new Mesh();
    for(const [cx,cz,amount,spread] of [[-16,-8,8,5],[1,-5,7,5],[-16,4,8,6],[8,10,6,6],[-12,16,6,5],[13,-18,5,4],[-30,-30,10,9],[26,-37,10,8],[-19,43,9,9],[20,59,8,7]]){
        for(let k=0;k<amount;k++){
            const x=cx+(rng()-.5)*spread*2,z=cz+(rng()-.5)*spread*2,s=.70+rng()*1.0;
            const at=[x,H(x,z)-s*.12,z];
            // Local canopy coordinates retain a sunlit crest even on a waist-high shrub.
            lobe(bushes,[0,18,0],[7,6.2,6.8],{origin:add(at,[0,-2.25*s,0]),blue:.26},rng,27,s*.14);
        }
    }
    bushes.save('Shrubs along the path',leafMaterial,null,{texture:'assets/textures/oak-tuft.png'});
}
