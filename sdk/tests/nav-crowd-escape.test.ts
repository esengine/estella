// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { avoidVelocity } from '../src/ai/nav/avoidance';

describe('passing parked bodies', () => {
    it.each([78, -78])('leaves an existing overlap when aiming along the wall at %s', forward => {
        const self = { x: 0, z: 0, vx: 0, vz: 0, radius: 8 };
        const neighbour = { ...self, z: -8 };
        // Almost parallel to the wall, one ring sample almost cancels the desired velocity.
        const chosen = avoidVelocity(self, { x: 0.00015, z: forward }, [neighbour], {
            horizon: 1.6, maxSpeed: 78, canStand: x => x <= 8,
        });
        expect(chosen.z).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.hypot(chosen.x * 0.4, 8 + chosen.z * 0.4)).toBeGreaterThanOrEqual(16);
    });

    it.each([0,23,45,90,135,180,225,270,315])('makes progress without overlap at %s degrees', degrees => {
        const a=degrees*Math.PI/180;
        const goal={x:100*Math.cos(a),z:100*Math.sin(a)};
        const other={x:20*Math.cos(a),z:20*Math.sin(a),vx:0,vz:0,radius:8};
        const self={x:0,z:0,vx:0,vz:0,radius:8};
        let minimum=Infinity;
        for(let i=0;i<720;i++){
            const dx=goal.x-self.x,dz=goal.z-self.z,distance=Math.hypot(dx,dz);
            if(distance<8)break;
            const v=avoidVelocity(self,{x:dx/distance*78,z:dz/distance*78},[other],{horizon:1.6,maxSpeed:78});
            self.x+=v.x/60;self.z+=v.z/60;self.vx=v.x;self.vz=v.z;
            minimum=Math.min(minimum,Math.hypot(self.x-other.x,self.z-other.z));
        }
        expect(minimum).toBeGreaterThanOrEqual(16-0.05);
        expect(Math.hypot(goal.x-self.x,goal.z-self.z)).toBeLessThan(8);
    });
    it('stands still when every candidate is outside the navigable world',()=>{
        expect(avoidVelocity({x:0,z:0,vx:0,vz:0,radius:8},{x:78,z:0},
            [{x:1000,z:0,vx:0,vz:0,radius:8}],{horizon:1.6,maxSpeed:78,canStand:()=>false})).toEqual({x:0,z:0});
    });
    it('does not move a zero-speed body while avoiding an overlapping neighbour',()=>{
        expect(avoidVelocity({x:0,z:0,vx:0,vz:0,radius:8},{x:78,z:0},
            [{x:0,z:0,vx:0,vz:0,radius:8}],{horizon:1.6,maxSpeed:0})).toEqual({x:0,z:0});
    });
});
