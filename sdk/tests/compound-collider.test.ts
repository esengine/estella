// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe,it,expect } from 'vitest';
import { encodeCompoundParts } from '../src/physics3d/CompoundCollider3D';
import { collider3DWireframe,collider3DTriangles } from '../src/physics3d/ColliderShape3D';
const rotation={x:0,y:0,z:0,w:1},position={x:2,y:3,z:4};
describe('compound model units',()=>{
    it('applies placement scale and unit conversion to offsets and shape dimensions once',()=>{
        const packed=encodeCompoundParts([{kind:'box',position,rotation,halfExtents:{x:.5,y:1,z:2}}],{x:200,y:200,z:200},100);
        expect([...packed]).toEqual([0,1,2,4,4,6,8,0,0,0,1]);
    });
    it('rejects invalid data and a sheared primitive instead of silently changing its shape',()=>{
        expect(()=>encodeCompoundParts([{kind:'sphere',position,rotation,radius:NaN}],{x:1,y:1,z:1},100)).toThrow();
        expect(()=>encodeCompoundParts([{kind:'box',position,rotation:{x:0,y:0,z:.707,w:.707},halfExtents:{x:1,y:1,z:1}}],{x:2,y:1,z:1},100)).toThrow(/non-uniform/);
    });
    it('rotates compound wires and navigation triangles around the local primitive centre',()=>{
        const shape={kind:'box' as const,halfExtents:{x:1,y:2,z:1},center:{x:5,y:0,z:0},rotation:{x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2}};
        const wire=collider3DWireframe(shape).flat(),solid=collider3DTriangles(shape).positions;
        expect(Math.min(...wire.map(p=>p.x))).toBeCloseTo(3);expect(Math.max(...wire.map(p=>p.x))).toBeCloseTo(7);
        expect(Math.min(...Array.from(solid).filter((_,i)=>i%3===0))).toBeCloseTo(3);
    });
});
