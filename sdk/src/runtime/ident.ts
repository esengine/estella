// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export const IDENT_SECONDS = 2.8;

export const IDENT_VERTEX = "attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}";

export const IDENT_FRAGMENT = "precision mediump float;uniform vec2 r;uniform float t;float S(vec2 p,vec4 s){vec2 a=p-s.xy,b=s.zw-s.xy;return length(a-b*clamp(dot(a,b)/dot(b,b),0.,1.));}float A(vec2 p,float y,float a,float b){vec2 q=p-vec2(.7,y);float n=mod(atan(q.y,q.x)-a,6.2832);return n<b-a?abs(length(q)-.25):min(length(q-.25*vec2(cos(a),sin(a))),length(q-.25*vec2(cos(b),sin(b))));}float E(float x){x=clamp(x,0.,1.);return x*x*(3.-2.*x);}float H(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}void main(){float M=min(r.x,r.y);vec2 p=(gl_FragCoord.xy-.5*r)/M,u=p/(.8*(1.+.07*E(t/7.))),c=u-vec2(0,.12),q=abs(c);if(q.y>q.x)q=q.yx;float e=4./M,L=length(c),I=E((t-.1)/.5),F=exp(-pow((t-1.15)/.2,2.)),f=abs(c.x)<abs(c.y)?(c.y>0.?0.:2.):(c.x>0.?1.:3.),a=E((t-.45-f*.13)/.45),d=dot(q/max(a,.001)-vec2(.26,0),normalize(vec2(.0473,.2127)))*a,m=smoothstep(e,-e,d)*step(.001,a),w=mod(t*2.2-f+2.,4.)-2.,n=atan(c.y,c.x),b=step(2.,t)*exp(-pow((u.x+u.y*.45-mix(-1.5,1.5,fract((t-2.)/3.6)))/.13,2.));w=exp(-w*w*2.5)*E((t-2.4)/.6);vec3 o=mix(vec3(.016,.024,.045),vec3(.03,.055,.105),exp(-L*1.5));o+=vec3(.16,.42,.85)*exp(-L*5.)*(.3*I+.55*F)+vec3(.2,.45,.9)*(.5+.5*sin(n*7.+t*.25))*(.5+.5*sin(n*11.-t*.17))*exp(-L*3.)*(.22*I+.9*F)+vec3(.35,.6,1)*exp(-abs(c.y)*70.-abs(c.x)*1.8)*(.45*I+1.7*F)+exp(-abs(c.y)*420.-abs(c.x)*3.)*F*.9;for(int j=0;j<12;j++){vec2 h=vec2(H(vec2(j,1)),H(vec2(j,7)));vec2 s=(h-.5)*vec2(2.2,1.5);s.y+=fract(t*.015*(1.+h.x)+h.y)*.5-.25;o+=vec3(.3,.5,.9)*smoothstep(.004+.011*h.x,0.,length(p-s*.8))*.22*(.5+.5*sin(t*(1.+h.y*2.)+h.x*6.))*I;}vec3 k=f<.5?vec3(.29,.65,.93):f<1.5?vec3(.18,.53,.84):f<2.5?vec3(.11,.35,.53):vec3(.17,.49,.75);k=(k*(.82+.45*q.x/.26)*(1.+.6*w)+.08*w+b*.45+F*.7)*(1.-.4*smoothstep(.006,0.,abs(abs(c.x)-abs(c.y))*.7));o=mix(o,k,m)+vec3(.7,.9,1)*smoothstep(.014,0.,abs(d))*(1.-a)*1.6*step(.001,a);float T=1.+.35*(1.-E((t-1.45)/1.3)),X=u.x/(.068*T)+4.9,i=floor(X/1.4),v=E((t-1.45-i*.07)/.4),x=9.;vec2 l=vec2((X-i*1.4-.7)*T+.7,(u.y+.33)/.068+(1.-v)*.35);if(i==0.||i==3.)x=min(min(S(l,vec4(.42,0,.42,1)),S(l,vec4(.42,1,.98,1))),min(S(l,vec4(.42,.5,.88,.5)),S(l,vec4(.42,0,.98,0))));else if(i==1.)x=min(A(l,.75,.4,4.7124),A(l,.25,-2.74,1.5708));else if(i==2.)x=min(S(l,vec4(.39,1,1.01,1)),S(l,vec4(.7,1,.7,0)));else if(i==4.||i==5.)x=min(S(l,vec4(.45,1,.45,0)),S(l,vec4(.45,0,.95,0)));else if(i==6.)x=min(min(S(l,vec4(.34,0,.7,1)),S(l,vec4(.7,1,1.06,0))),S(l,vec4(.47,.32,.93,.32)));float y=e/.068,g=smoothstep(.07+y,.07-y,x)*v;o=mix(o,mix(vec3(.8,.86,.94),vec3(1),b),g)+vec3(.5,.75,1)*b*exp(-max(x-.07,0.)*6.)*.3*v*(1.-g);o*=1.-.5*smoothstep(.3,1.1,length(p));o=(1.-exp(-o*1.5))*E(t/.4)+(H(gl_FragCoord.xy+fract(t)*91.)-.5)*.025;gl_FragColor=vec4(o,1);}";

export interface IdentRun {
    finished: Promise<void>;
    stop(): void;
}

export function playIdent(
    gl: WebGL2RenderingContext,
    size: () => { width: number; height: number },
    frame: (step: () => void) => void,
    now: () => number = () => performance.now(),
): IdentRun | null {
    const program = gl.createProgram();
    const shaders = [[gl.VERTEX_SHADER, IDENT_VERTEX], [gl.FRAGMENT_SHADER, IDENT_FRAGMENT]].map(([type, source]) => {
        const shader = gl.createShader(type as number);
        if (shader && program) {
            gl.shaderSource(shader, source as string);
            gl.compileShader(shader);
            gl.attachShader(program, shader);
        }
        return shader;
    });
    const buffer = gl.createBuffer(), corners = gl.createVertexArray();
    const drop = (): void => {
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.useProgram(null);
        for (const shader of shaders) gl.deleteShader(shader);
        gl.deleteProgram(program);
        gl.deleteBuffer(buffer);
        gl.deleteVertexArray(corners);
    };
    if (!program || !buffer || !corners) { drop(); return null; }
    gl.bindAttribLocation(program, 0, 'a');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { drop(); return null; }
    gl.bindVertexArray(corners);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const extent = gl.getUniformLocation(program, 'r'), clock = gl.getUniformLocation(program, 't');
    const began = now();
    let stopped = false;
    const draw = (): void => {
        if (stopped) return;
        const { width, height } = size();
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindVertexArray(corners);
        gl.uniform2f(extent, width, height);
        gl.uniform1f(clock, (now() - began) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        frame(draw);
    };
    draw();
    return {
        finished: new Promise((resolve) => { setTimeout(resolve, IDENT_SECONDS * 1000); }),
        stop() {
            if (stopped) return;
            stopped = true;
            drop();
        },
    };
}
