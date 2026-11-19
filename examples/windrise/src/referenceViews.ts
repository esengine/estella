import {groundHeight, home} from './world';

export type ViewName = 'oak' | 'body' | 'portrait' | 'rear' | 'profile';
export const viewNames: ViewName[] = ['oak', 'body', 'portrait', 'rear', 'profile'];

// World-space cameras. The contact sheets crop their 1600 × 900 frames without moving the camera.
export function referenceView(name: ViewName) {
    const floor = groundHeight(home.x, home.z);
    if (name === 'oak') {
        return {position: {x: 7.57, y: 9.8, z: 32}, yaw: Math.atan2(4, 14), pitch: .086, fov: 41};
    }
    const close = name === 'portrait';
    const yaw = name==='rear' ? 0 : name==='profile' ? -Math.PI/2 : close ? Math.PI-.13 : Math.PI;
    const distance = close ? 2.55 : 3.26;
    return {
        position: {x: home.x+Math.sin(yaw)*distance, y: floor + (close ? 1.42 : .85), z: home.z+Math.cos(yaw)*distance},
        yaw, pitch: 0, fov: close ? 15 : 32,
    };
}
