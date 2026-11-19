// The surface followed by the traveler is the same function used by the authored mesh.
export function groundHeight(x: number, z: number): number {
  const hills = 1.15*Math.sin(x*.025+z*.018)+.65*Math.cos(z*.056)+.3*Math.sin(x*.11+z*.07);
  const lake = Math.exp(-(((x-34)/23)**2)-((z+7)/62)**2);
  const tree = 1.1*Math.exp(-(((x+11)/14)**2)-((z+32)/16)**2);
  return hills - 3.6*lake + tree;
}
export const home = { x: 0, z: 28, yaw: .08, pitch: -.025, distance: 5.8 };
export const shrine = { x: -7, z: -19 };
