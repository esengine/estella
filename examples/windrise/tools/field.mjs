const tau=Math.PI*2;
const clamp=x=>Math.max(0,Math.min(1,x));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const normal=(a,b,c)=>{
    const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...n)||1;return n.map(v=>v/length);
};

// Stratified slate outcrops: a broken shoulder and smaller cap sit on one tilted bedding plane.
function boulder(mesh,x,y,z,rx,ry,rz,angle,rng,moss){
    const count=7+Math.floor(rng()*3),outline=[];
    for(let i=0;i<count;i++){
        const a=(i+(rng()-.5)*.32)*tau/count, r=.76+rng()*.29;
        outline.push([Math.cos(a)*rx*r,Math.sin(a)*rz*r,.78+rng()*.34]);
    }
    const tiltX=(rng()-.5)*.26,tiltZ=(rng()-.5)*.24,ca=Math.cos(angle),sa=Math.sin(angle);
    const ring=(r,h,offset)=>outline.map(([ox,oz,j])=>{
        const px=ox*r+offset, pz=oz*r;
        return [x+px*ca-pz*sa,y+h*ry*j+tiltX*px+tiltZ*pz,z+px*sa+pz*ca];
    });
    const rings=[ring(.89,-.55,0),ring(1,.23,0),ring(.76,.76,.08*rx),ring(.36,.95,.11*rx)];
    const shaded=[.125,.173,.212], lit=[.40,.43,.383];
    for(let j=0;j<3;j++)for(let k=0;k<count;k++){
        const next=(k+1)%count,points=[rings[j][k],rings[j+1][k],rings[j+1][next],rings[j][next]];
        const n=normal(...points.slice(0,3)),t=clamp(.37+.33*n[1]-.20*n[0]+.16*n[2]+(rng()-.5)*.08);
        const grey=mix(shaded,lit,t);
        const color=mix(grey,[.204,.314,.108],moss*clamp(n[1])*.74);
        mesh.quad(points,color,n);
    }
    const top=rings.at(-1),center=top.reduce((p,v)=>p.map((q,i)=>q+v[i]/count),[0,0,0]);
    for(let k=0;k<count;k++){
        const pts=[center,top[(k+1)%count],top[k]],n=normal(...pts);
        const colour=mix([.39,.407,.35],[.26,.36,.131],moss);
        mesh.tri(...pts.map(v=>mesh.v(v,n,colour)));
    }
}

function blade(mesh,base,rng,h,w,phase,exposure){
    const a=rng()*tau,dx=Math.cos(a),dz=Math.sin(a), lean=h*(.12+rng()*.31);
    const [x,y,z]=base,n=[dx*.15,.98,dz*.15];
    const vert=(s,t)=>mesh.v([x+dx*w*s-dz*lean*t*t,y+h*t,z+dz*w*s+dx*lean*t*t],n,
        [t,phase,exposure,1],[(s+1)/2,t]);
    const l=vert(-1,0),r=vert(1,0),ml=vert(-.65,.54),mr=vert(.65,.54),tip=vert(0,1);
    mesh.tri(l,r,mr);mesh.tri(l,mr,ml);mesh.tri(ml,mr,tip);
}

function flower(mesh,x,y,z,size,colour,phase){
    const lean=size*.24,green=[.113,.28,.065];
    mesh.quad([[x-.006,y,z],[x+.006,y,z],[x+lean+.004,y+size,z],[x+lean-.004,y+size,z]],green,[0,.48,.88]);
    for(let i=0;i<5;i++){
        const a=phase+i*tau/5,dx=Math.cos(a)*size*.19,dz=Math.sin(a)*size*.19,cx=x+lean,cy=y+size;
        mesh.quad([[cx,cy,z],[cx+dx*.65-dz*.4,cy+.014,z+dz*.65+dx*.4],[cx+dx,cy+.025,z+dz],
            [cx+dx*.65+dz*.4,cy+.014,z+dz*.65-dx*.4]],colour,[0,.96,.24]);
    }
}

export function buildFieldDetails({Mesh,H,grassMat,sprigMat,toon,stoneMaterial,pathX,pathMask,shrine}){
    let seed=816357;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const stone=new Mesh(),flowers=new Mesh(),sprigs=new Mesh();
    // Long visible shelves around the knoll, plus smaller stones on the shoulders of the trail.
    for(const [cx,cz,amount,size,span] of [[-11,-32,31,3.4,15],[-27,-22,11,2.1,8],[5,-29,10,2,9],[-24,-4,8,1.05,8],
        [11,1,6,1.25,6],[-9,9,6,.82,5],[10,18,5,1.1,5],[-44,-52,15,2.45,19],[33,-63,18,2.25,19],
        [-68,-89,16,3.4,25],[4,-91,18,2.8,25],[-31,76,9,1.5,12],[31,65,10,1.45,14]]){
        for(let j=0;j<amount;j++){
            const a=rng()*tau,r=span*Math.sqrt(rng()),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;
            if(Math.hypot(x-shrine.x,z-shrine.z)<4.0||Math.abs(x-pathX(z))<2)continue;
            const s=size*(.37+rng()*.72);
            boulder(stone,x,H(x,z)-s*.16,z,s*(1.22+rng()*.66),s*(.39+rng()*.36),s*(.55+rng()*.65),a,rng,.18+rng()*.68);
        }
    }
    // Small angular stones interrupt the smooth border of the worn earth.
    for(let j=0;j<170;j++){
        const z=-24+rng()*68,x=pathX(z)+(rng()<.5?-1:1)*(.85+rng()*1.12),s=.035+rng()*.115;
        boulder(stone,x,H(x,z)+.035,z,s*1.4,s*.38,s,rng()*tau,rng,.05);
    }
    stone.save('Weathered meadow stones',stoneMaterial);
    const posts=new Mesh();
    for(const [x,z,s] of [[-14.7,-16.7,.87],[1.1,-15.3,.97],[-18.4,-24.4,.55],[-.1,-25.5,.53]]){
        const y=H(x,z);
        const courses=[[.76,.04],[.76,.15],[.63,.21],[.59,.27],[.45,1.05],[.59,1.12],[.63,1.27],[.70,1.29],[.62,1.4]];
        let previous;
        for(const [r,h] of courses){
            const row=[];
            for(let k=0;k<8;k++){
                const a=(k+.5)*tau/8,rr=r*s*(1+.045*Math.sin(a*3+x));
                row.push([x+Math.cos(a)*rr,y+h*s+.031*Math.cos(a*2),z+Math.sin(a)*rr]);
            }
            if(previous)for(let k=0;k<8;k++){
                const next=(k+1)%8,points=[previous[k],row[k],row[next],previous[next]];
                posts.quad(points,mix([.22,.243,.197],[.33,.369,.269],h/1.4),normal(...points.slice(0,3)));
            }
            previous=row;
        }
        const top=[x,y+1.43*s,z];
        for(let k=0;k<8;k++)posts.tri(...[top,previous[(k+1)%8],previous[k]].map(p=>posts.v(p,[0,1,0],[.30,.39,.19])));
    }
    posts.save('Shrine boundary stones',stoneMaterial);
    for(let cz=0;cz<10;cz++)for(let cx=0;cx<7;cx++){
        const grass=new Mesh(),bx=-47+cx*12,bz=-63+cz*12;
        for(let j=0;j<(cz>4&&cx>1&&cx<6?565:310);j++){
            const x=bx+rng()*12,z=bz+rng()*12,y=H(x,z);
            if(y<-.82||pathMask(x,z)>.30||Math.hypot(x-shrine.x,z-shrine.z)<2.6)continue;
            const swath=.5+.25*Math.sin(x*.41+z*.18)+.19*Math.cos(z*.39-x*.11);
            if(rng()>swath*.63+.34)continue;
            const shade=clamp((Math.hypot((x+10)/28,(z+32)/22)-.48)/.64);
            const phase=rng(),height=(.14+rng()*.23)*(1+swath*.36),light=(.44+shade*.53)*(.87+rng()*.13);
            const count=4+Math.floor(rng()*5);
            for(let k=0;k<count;k++){
                const xx=x+(rng()-.5)*.33,zz=z+(rng()-.5)*.33;
                blade(grass,[xx,H(xx,zz)-.022,zz],rng,height*(.6+rng()*.63),.012+rng()*.014,phase,light);
            }
            if(j%3===0){
                for(let k=0;k<3;k++){
                    const angle=phase*tau+k*tau/3, r=height*(.58+k*.085), dx=Math.cos(angle)*r,dz=Math.sin(angle)*r;
                    const vertices=[[x-dx,y-.025,z-dz],[x+dx,y-.025,z+dz],[x+dx+.04,y+height,z+dz],[x-dx+.04,y+height,z-dz]];
                    const ids=vertices.map((v,i)=>sprigs.v(v,[0,.96,.24],[light,phase,0,1],[[0,0],[1,0],[1,1],[0,1]][i]));
                    sprigs.tri(ids[0],ids[1],ids[2]);sprigs.tri(ids[0],ids[2],ids[3]);
                }
            }
            if(swath>.61&&j%17===0){
                const c=j%3===0?[.73,.46,.46]:[.84,.82,.56];
                for(let k=0;k<3;k++)flower(flowers,x+(rng()-.5)*.28,y,z+(rng()-.5)*.28,height*(.85+rng()*.5),c,rng()*tau);
            }
        }
        grass.save(`Wind grass ${cx}-${cz}`,grassMat,null,{castShadows:false});
    }
    flowers.save('Meadow wildflower patches',toon,null,{castShadows:false});
    sprigs.save('Fine meadow grass',sprigMat,null,{castShadows:false,texture:'assets/textures/grass-tuft.png'});
}
