// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import type { Entity } from '../types';
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { CppRegistry } from '../wasm';
import type { Physics2DAPI } from '../physics/Physics2D';
import type { Physics3DQueries } from '../physics3d/Physics3DQueries';
import type { ParticleCollisionBudget, ParticleCollisionEventPayload, ParticleCollisionStats } from './collision';

interface Query { mode: number; mask: number; x: number; y: number; z: number; dx: number; dy: number; dz: number }
interface Hit { body: Entity; x: number; y: number; z: number; nx: number; ny: number; nz: number }
/** null is a miss; undefined means unavailable and explicitly invokes the authored fallback. @internal */
export type ParticleQueryResolver = (query: Query) => Hit | null | undefined;
/** No hard dependency on either optional physics plugin. Their existing APIs own unit conversion. @internal */
export function particleQueryResolver(app: App): ParticleQueryResolver {
    return q => {
        if (q.mask === 0) return null;
        if (q.mode === 1) {
            const physics = app.getResourceByName('Physics2D') as Physics2DAPI | null;
            if (!physics) return undefined;
            const length = Math.hypot(q.dx,q.dy);
            if (!length) return null;
            const hits = physics.raycast({x:q.x,y:q.y},{x:q.dx/length,y:q.dy/length},length,q.mask);
            const hit = hits.find(h=>Number.isFinite(h.fraction) && h.fraction>=0 && h.fraction<=1);
            return hit ? {body:hit.entity,x:hit.point.x,y:hit.point.y,z:q.z,nx:hit.normal.x,ny:hit.normal.y,nz:0} : null;
        }
        if (q.mode === 2) {
            const physics = app.getResourceByName('Physics3D') as Physics3DQueries | null;
            if (!physics) return undefined;
            const hit = physics.raycast({x:q.x,y:q.y,z:q.z},{x:q.dx,y:q.dy,z:q.dz},q.mask);
            return hit ? {body:hit.entity,x:hit.x,y:hit.y,z:hit.z,nx:hit.normalX,ny:hit.normalY,nz:hit.normalZ} : null;
        }
        return undefined;
    };
}
/** Same-frame bulk exchange with either a WASM or native core. @internal */
export class ParticleCollisionBridge {
    events: ParticleCollisionEventPayload[] = [];
    contacts: ParticleCollisionEventPayload[] = [];
    debug = false;
    stats: ParticleCollisionStats[] = [];
    error: string | null = null;
    budget: ParticleCollisionBudget = {queries:4096,events:1024};
    readonly explicit = new Set<keyof ParticleCollisionBudget>();
    level: ParticleCollisionBudget | null = null;
    private updating_ = false;
    constructor(private readonly engine_: NonNullable<EngineApi>, private readonly registry_: CppRegistry,
                private readonly resolve_?: ParticleQueryResolver) {}
    private read_(count: number, words: number, getter: (()=>number) | undefined, max: number): ArrayBuffer | undefined {
        if (!Number.isInteger(count) || count < 0 || count > max || !getter) return undefined;
        const ptr = getter(), heap = this.engine_.HEAPU8;
        if (!heap || !Number.isSafeInteger(ptr) || ptr % 4 !== 0 || (count>0 && ptr===0) || ptr<0 || ptr + count*words*4 > heap.byteLength) return undefined;
        return heap.slice(ptr,ptr+count*words*4).buffer;
    }
    effectiveBudget(): ParticleCollisionBudget {
        const pick=(key: keyof ParticleCollisionBudget)=>this.level&&!this.explicit.has(key)?this.level[key]:this.budget[key];
        return {queries:pick('queries'),events:pick('events')};
    }
    update(dt: number): void {
        if (this.updating_) throw new Error('Particle.update cannot re-enter during collision queries');
        this.updating_=true;this.events=[];this.contacts=[];this.stats=[];this.error=null;
        const e=this.engine_;
        try {
            const budget=this.effectiveBudget();
            e.particle_collisionSetBudget?.(budget.queries,budget.events,this.debug);
            e.particle_update?.(this.registry_,dt);
            const count=e.particle_collisionQueryCount?.() ?? 0;
            if (count>0 && e.particle_collisionResolve) {
                const queries=this.read_(count,10,e.particle_collisionQueries?.bind(e),65536);
                let ptr=0;
                try {
                    if (queries && e._malloc && e._free && e.HEAPU8) ptr=e._malloc(count*32);
                    if (ptr && queries) {
                        const inputU=new Uint32Array(queries), inputF=new Float32Array(queries);
                        const replyBuffer=new ArrayBuffer(count*32), replyU=new Uint32Array(replyBuffer), replyF=new Float32Array(replyBuffer);
                        for(let i=0;i<count;i++) {
                            const q=i*10,r=i*8;
                            let hit:Hit|null|undefined;
                            try {hit=this.resolve_?.({mode:inputU[q+2],mask:inputU[q+3],x:inputF[q+4],y:inputF[q+5],z:inputF[q+6],dx:inputF[q+7],dy:inputF[q+8],dz:inputF[q+9]});}
                            catch(error){this.error=String(error);hit=undefined;}
                            replyU[r]=hit===undefined?2:hit===null?0:1;
                            if(hit){replyU[r+1]=hit.body;replyF.set([hit.x,hit.y,hit.z,hit.nx,hit.ny,hit.nz],r+2);}
                        }
                        // A query provider may grow the engine heap. Acquire the current view only AFTER it returns.
                        e.HEAPU8!.set(new Uint8Array(replyBuffer),ptr);
                        e.particle_collisionResolve(this.registry_,ptr,count);
                    } else e.particle_collisionResolve(this.registry_,0,0);
                } finally {if(ptr)e._free?.(ptr);}
            }
            const eventCount=e.particle_collisionEventCount?.() ?? 0;
            const events=this.read_(eventCount,14,e.particle_collisionEvents?.bind(e),16384);
            if(events){const u=new Uint32Array(events),f=new Float32Array(events);for(let i=0;i<eventCount;i++){const b=i*14;const event={emitter:u[b] as Entity,particle:u[b+1],body:u[b+2] as Entity,mode:u[b+3],x:f[b+4],y:f[b+5],z:f[b+6],normalX:f[b+7],normalY:f[b+8],normalZ:f[b+9],velocityX:f[b+10],velocityY:f[b+11],velocityZ:f[b+12]};this.contacts.push(event);if(u[b+13])this.events.push(event);}}
            const statCount=e.particle_collisionStatsCount?.() ?? 0;
            const stats=this.read_(statCount,10,e.particle_collisionStats?.bind(e),1000000);
            if(stats){const u=new Uint32Array(stats);for(let i=0;i<statCount;i++){const b=i*10;this.stats.push({emitter:u[b] as Entity,queries:u[b+1],hits:u[b+2],budgetSkipped:u[b+3],distanceSkipped:u[b+4],unavailable:u[b+5],events:u[b+6],eventDropped:u[b+7],fallbacks:u[b+8],mode:u[b+9]});}}
        } finally {this.updating_=false;}
    }
}
