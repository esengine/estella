// The surface followed by the traveler is the same function used by the authored mesh.
export function groundHeight(x: number, z: number): number {
  const hills = 1.15*Math.sin(x*.025+z*.018)+.65*Math.cos(z*.056)+.3*Math.sin(x*.11+z*.07);
  const lake = Math.exp(-(((x-34)/23)**2)-((z+7)/62)**2);
  const knoll = 4.8*Math.exp(-(((x+11)/16.5)**2)-((z+33)/12.8)**2);
  const banks = Math.min(1,Math.max(0,(-z-38)/44));
  const foothills = banks*(2.2+2*Math.sin(.06*x-.037*z)+1.3*Math.cos(.08*z+.041*x));
  const hummocks = .24*Math.sin(.22*x+.12*z)*Math.cos(.16*z-.09*x);
  return hills - 3.6*lake + knoll + foothills + hummocks;
}
export const home = { x: 0, z: 28, yaw: .08, pitch: -.025, distance: 5.8 };
export const shrine = { x: -7, z: -19 };
