// Giant Forest — procedural sequoia grove rendered with raw three.js shaders.
// Everything is generated on the GPU from a handful of instanced geometries:
// trunks (flared + fluted in the vertex shader), canopy clumps, crepuscular
// light shafts (camera-facing around the sun axis) and drifting pollen.
// Atmosphere is a single shared GLSL function so sky, fog and shafts agree.
import * as THREE from 'three';

const SUN = new THREE.Vector3(-0.45, 0.72, -0.53).normalize();

const COMMON = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
uniform float uWarmth;   // 0 = blue-hour, 1 = golden afternoon (driven by scroll)

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*noise(p); p = p*2.03 + 17.1; a *= 0.5; } return v; }

// Atmosphere: cool shadowed haze away from the sun, honeyed glow toward it.
vec3 atmosphere(vec3 dir){
  float s = max(dot(dir, uSun), 0.0);
  float up = clamp(dir.y*0.5+0.5, 0.0, 1.0);
  vec3 cool = mix(vec3(0.075,0.095,0.10), vec3(0.20,0.25,0.27), up);
  vec3 warm = mix(vec3(0.36,0.23,0.13), vec3(0.78,0.58,0.36), up);
  vec3 col = mix(cool, warm, pow(s, 3.0)*mix(0.35, 0.8, uWarmth));
  col += vec3(1.0,0.78,0.5) * pow(s, 24.0) * 0.45 * uWarmth;
  return col;
}
vec3 applyFog(vec3 col, vec3 worldPos, vec3 camPos){
  vec3 d = worldPos - camPos;
  float dist = length(d);
  float h = clamp(1.0 - worldPos.y/90.0, 0.0, 1.0);           // denser near the forest floor
  float f = 1.0 - exp(-dist * (0.0042 + 0.006*h*h));
  return mix(col, atmosphere(normalize(d)), clamp(f, 0.0, 1.0));
}
`;

const TRUNK_VS = /* glsl */ `
attribute vec4 aTree;        // x, z, radius, seed
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vBark; varying float vSeed; varying float vY;
${COMMON}
void main(){
  vec3 p = position;          // unit cylinder: radius 1, y in [0,1]
  float ang = atan(p.z, p.x);
  float r = aTree.z;
  float H = min(170.0, 45.0 + r*30.0);                          // firs stay well below the giants
  float y = p.y * H;
  float flare = 1.0 + 0.85*exp(-y/5.5) + 0.25*exp(-y/22.0);   // buttressed base
  float taper = mix(1.0, 0.04, pow(smoothstep(H*0.12, H, y), 0.8));
  float flutes = 1.0 + 0.055*sin(ang*13.0 + aTree.w*20.0 + noise(vec2(ang*3.0, y*0.04))*3.0)
                     + 0.03*noise(vec2(ang*9.0, y*0.08 + aTree.w*10.0));
  float lean = (aTree.w-0.5)*0.012*y;
  vec3 wp = vec3(aTree.x + p.x*r*flare*taper*flutes + lean, y - 1.0, aTree.y + p.z*r*flare*taper*flutes);
  vWorld = wp; vNormal = normalize(vec3(p.x, 0.12*exp(-y/6.0), p.z));
  vBark = vec2(ang*r*1.4, y); vSeed = aTree.w; vY = y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const TRUNK_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vBark; varying float vSeed; varying float vY;
uniform vec3 uCam;
${COMMON}
void main(){
  // Sequoia bark: long fibrous vertical ridges, cinnamon to deep rust.
  float ridge = fbm(vec2(vBark.x*1.6, vBark.y*0.045 + vSeed*31.0));
  float fine  = fbm(vec2(vBark.x*7.0, vBark.y*0.3));
  float grooves = smoothstep(0.35, 0.65, ridge);
  vec3 rust = vec3(0.36,0.14,0.07), cinnamon = vec3(0.62,0.30,0.16), ash = vec3(0.19,0.12,0.09);
  vec3 col = mix(ash, mix(rust, cinnamon, fine), grooves);
  col *= 0.78 + 0.35*vSeed;
  // fire scars near the base on some trees — every old sequoia carries one
  float scar = step(0.72, vSeed) * smoothstep(14.0, 0.0, vY) * smoothstep(0.55, 0.75, fbm(vBark*vec2(0.5,0.08)));
  col = mix(col, vec3(0.04,0.03,0.03), scar);
  vec3 n = normalize(vNormal + vec3(0.0, 0.0, (ridge-0.5)*0.5));
  float diff = max(dot(n, uSun), 0.0);
  float wrap = max(dot(n, uSun)*0.5+0.5, 0.0);
  vec3 sky = mix(vec3(0.10,0.13,0.12), vec3(0.32,0.30,0.26), clamp(vY/120.0,0.0,1.0));
  vec3 lit = col * (sky*1.1 + vec3(1.0,0.74,0.48)*diff*mix(0.45,1.25,uWarmth) + wrap*0.08);
  lit *= mix(0.55, 1.0, smoothstep(0.0, 25.0, vY));   // ground occlusion
  gl_FragColor = vec4(applyFog(lit, vWorld, uCam), 1.0);
}`;

const CANOPY_VS = /* glsl */ `
attribute vec4 aClump;   // x, y, z, scale
varying vec3 vWorld; varying vec3 vN; varying float vS; varying vec3 vLocal;
${COMMON}
void main(){
  vec3 p = position;
  vec2 q = vec2(atan(p.z, p.x)*1.6, p.y*2.2) + aClump.xz*0.37;
  float d = fbm(q*1.7);
  float spikes = noise(q*7.0);
  p *= 0.55 + 0.75*d + 0.28*spikes;
  p.y *= 0.38;                                              // sprays are flatter than they are tall
  p.x += sin(uTime*0.25 + aClump.x)*0.04;                   // breathing in the wind aloft
  vec3 wp = aClump.xyz + p*aClump.w;
  vWorld = wp; vN = normalize(position + vec3(0.0, 0.6, 0.0)); vS = d; vLocal = position*aClump.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const CANOPY_FS = /* glsl */ `
varying vec3 vWorld; varying vec3 vN; varying float vS; varying vec3 vLocal;
uniform vec3 uCam;
${COMMON}
void main(){
  vec3 v = normalize(uCam - vWorld);
  float rim = 1.0 - abs(dot(normalize(vN), v));
  // Frayed silhouette: needles thin out toward the edge instead of a hard polygon outline.
  float needles = noise(vLocal.xy*2.2 + vLocal.z*1.3) * 0.6 + noise(vLocal.zy*5.0) * 0.4;
  if (needles < rim*0.85 - 0.15) discard;
  vec3 col = mix(vec3(0.02,0.045,0.03), vec3(0.11,0.17,0.08), vS*needles);
  float l = max(dot(normalize(vN), uSun), 0.0);
  float trans = pow(max(dot(-v, uSun), 0.0), 5.0);   // sunlight bleeding through needles
  col = col*(0.3 + l*0.8*uWarmth) + vec3(0.5,0.45,0.18)*trans*rim*0.6;
  gl_FragColor = vec4(applyFog(col, vWorld, uCam), 1.0);
}`;

const GROUND_FS = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uCam;
${COMMON}
void main(){
  vec2 p = vWorld.xz;
  float n = fbm(p*0.05), m = fbm(p*0.6);
  vec3 duff = mix(vec3(0.16,0.08,0.04), vec3(0.30,0.15,0.07), m);     // needle duff
  vec3 moss = vec3(0.07,0.12,0.05);
  vec3 col = mix(duff, moss, smoothstep(0.45, 0.7, n));
  // dappled light
  float dap = smoothstep(0.55, 0.8, fbm(p*0.08 + vec2(uTime*0.01, 0.0)));
  col *= 0.45 + dap*vec3(1.1,0.85,0.55)*uWarmth;
  gl_FragColor = vec4(applyFog(col, vWorld, uCam), 1.0);
}`;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position,1.0); gl_Position = p.xyww; }`;
const SKY_FS = /* glsl */ `
varying vec3 vDir;
${COMMON}
void main(){ gl_FragColor = vec4(atmosphere(normalize(vDir)), 1.0); }`;

const SHAFT_VS = /* glsl */ `
attribute vec4 aShaft;  // center x, z, width, seed
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
uniform vec3 uCam;
${COMMON}
void main(){
  vec3 base = vec3(aShaft.x, 0.0, aShaft.y);
  vec3 axis = uSun;
  vec3 toCam = normalize(uCam - base);
  vec3 right = normalize(cross(axis, toCam));
  vec3 wp = base + right*position.x*aShaft.z + axis*position.y*220.0;
  vUv = vec2(position.x+0.5, position.y); vSeed = aShaft.w; vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const SHAFT_FS = /* glsl */ `
varying vec2 vUv; varying float vSeed; varying vec3 vWorld;
uniform vec3 uCam;
${COMMON}
void main(){
  float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
  float streak = 0.55 + 0.45*noise(vec2(vUv.x*6.0 + vSeed*10.0, vUv.y*2.0 - uTime*0.05));
  float fade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
  float flicker = 0.75 + 0.25*sin(uTime*0.3 + vSeed*40.0);
  float near = smoothstep(4.0, 30.0, distance(vWorld, uCam));
  float a = edge*edge*streak*fade*flicker*near * 0.075 * (0.4 + uWarmth);
  gl_FragColor = vec4(vec3(1.0,0.82,0.58)*a, 1.0);
}`;

const DUST_VS = /* glsl */ `
attribute float aSeed;
varying float vA; varying float vLit;
uniform vec3 uCam; uniform float uPx;
${COMMON}
void main(){
  vec3 box = vec3(60.0, 30.0, 60.0);
  vec3 p = position*box;
  p += vec3(sin(uTime*0.11 + aSeed*30.0)*1.5, uTime*0.35*(0.3+aSeed), cos(uTime*0.07 + aSeed*20.0)*1.5);
  p = mod(p - uCam + box*0.5, box) - box*0.5 + uCam;    // infinite wrap around the camera
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vA = smoothstep(1.0, 4.0, dist) * smoothstep(30.0, 12.0, dist);
  vLit = 0.4 + 0.6*noise(p.xz*0.05 + 3.0);
  gl_PointSize = uPx * (0.6 + aSeed) * 26.0 / dist;
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = /* glsl */ `
varying float vA; varying float vLit;
uniform float uWarmth;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA * vLit * (0.25 + 0.6*uWarmth);
  gl_FragColor = vec4(vec3(1.0,0.85,0.6)*a, 1.0);
}`;

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

export class Forest {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x0b0f0e, 1);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1400);
    this.progress = 0; this.smooth = 0;
    this.mouse = new THREE.Vector2(); this.mouseS = new THREE.Vector2();
    this.uniforms = {
      uSun: { value: SUN }, uTime: { value: 0 }, uWarmth: { value: 0.4 },
      uCam: { value: this.camera.position }, uPx: { value: this.dpr },
    };
    this.#build();
    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', e => this.mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));
    this.clock = new THREE.Clock();
    this.frameTimes = [];
  }

  #mat(vs, fs, extra = {}) {
    return new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: this.uniforms, ...extra });
  }

  // Camera path weaves gently between trunks; trees keep clear of it.
  pathX(z) { return Math.sin(z * 0.012) * 14 + Math.sin(z * 0.031) * 4; }

  #build() {
    const rand = rng(20120101);
    const trees = [];
    const place = (n, rMin, rMax, clearance) => {
      let tries = 0;
      while (n > 0 && tries++ < 20000) {
        const z = -560 + rand() * 660, x = (rand() - 0.5) * 420;
        const r = rMin + rand() * (rMax - rMin);
        if (Math.abs(x - this.pathX(z)) < clearance + r * 1.8) continue;
        if (trees.some(t => Math.hypot(t[0] - x, t[1] - z) < (t[2] + r) * 2.6)) continue;
        trees.push([x, z, r, rand()]); n--;
      }
    };
    place(26, 4.2, 6.0, 12);    // the giants
    place(70, 2.4, 3.8, 10);    // mature sequoias
    place(110, 0.5, 1.2, 6);    // white fir & sugar pine for scale
    this.trees = trees;

    const trunkGeo = new THREE.InstancedBufferGeometry().copy(new THREE.CylinderGeometry(1, 1, 1, 40, 90, true).translate(0, 0.5, 0));
    trunkGeo.instanceCount = trees.length;
    trunkGeo.setAttribute('aTree', new THREE.InstancedBufferAttribute(new Float32Array(trees.flat()), 4));
    const trunks = new THREE.Mesh(trunkGeo, this.#mat(TRUNK_VS, TRUNK_FS));
    trunks.frustumCulled = false;
    this.scene.add(trunks);

    const clumps = [];
    for (const [x, z, r, s] of trees) {
      const H = Math.min(170, 45 + r * 30);
      if (r > 2) {
        // Sequoia crown: irregular clumps hugging the upper third, branches reaching out.
        for (let i = 0; i < 16; i++) {
          const y = H * (0.58 + rand() * 0.4);
          const a = rand() * Math.PI * 2, d = r * (0.6 + rand() * 2.2) * (1.2 - (y / H) * 0.8);
          clumps.push(x + Math.cos(a) * d, y, z + Math.sin(a) * d, 3.5 + rand() * 5);
        }
      } else {
        // Fir: stacked whorls, a narrow cone that starts low.
        for (let y = H * 0.22; y < H; y += 2.6 + rand() * 1.5) {
          const t = (y - H * 0.22) / (H * 0.78);
          const a = rand() * Math.PI * 2;
          clumps.push(x + Math.cos(a) * 0.4, y, z + Math.sin(a) * 0.4, (1 - t) * 6.5 + 0.8);
        }
      }
    }
    const canopyGeo = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 4));
    canopyGeo.instanceCount = clumps.length / 4;
    canopyGeo.setAttribute('aClump', new THREE.InstancedBufferAttribute(new Float32Array(clumps), 4));
    const canopy = new THREE.Mesh(canopyGeo, this.#mat(CANOPY_VS, CANOPY_FS));
    canopy.frustumCulled = false;
    this.scene.add(canopy);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
      this.#mat(`varying vec3 vWorld; void main(){ vWorld = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.); }`, GROUND_FS));
    ground.position.y = -1;
    this.scene.add(ground);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.#mat(SKY_VS, SKY_FS, { side: THREE.BackSide, depthWrite: false }));
    sky.frustumCulled = false; sky.renderOrder = -1;
    this.scene.add(sky);

    const shafts = [];
    for (let i = 0; i < 46; i++) {
      const z = -520 + rand() * 600;
      shafts.push(this.pathX(z) + (rand() - 0.5) * 120 + 40, z + 30, 4 + rand() * 14, rand());
    }
    const shaftGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0));
    shaftGeo.instanceCount = shafts.length;
    shaftGeo.setAttribute('aShaft', new THREE.InstancedBufferAttribute(new Float32Array(shafts), 4));
    const shaftMesh = new THREE.Mesh(shaftGeo, this.#mat(SHAFT_VS, SHAFT_FS, {
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    shaftMesh.frustumCulled = false; shaftMesh.renderOrder = 2;
    this.scene.add(shaftMesh);

    const N = 2600, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = rand(); pos[i * 3 + 1] = rand(); pos[i * 3 + 2] = rand(); seed[i] = rand(); }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const dust = new THREE.Points(dustGeo, this.#mat(DUST_VS, DUST_FS, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false; dust.renderOrder = 3;
    this.scene.add(dust);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 55;
    this.camera.updateProjectionMatrix();
    this.uniforms.uPx.value = this.dpr;
  }

  setProgress(p) { this.progress = Math.min(Math.max(p, 0), 1); }

  // Keeps the frame budget honest on weaker GPUs by stepping the DPR down.
  #adapt(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 1 / 45 && this.dpr > 0.75) { this.dpr = Math.max(0.75, this.dpr - 0.25); this.resize(); }
  }

  frame(still = false) {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!still) this.#adapt(dt);
    this.uniforms.uTime.value += still ? 0 : dt;
    const k = still ? 1 : 1 - Math.exp(-dt * 2.2);
    this.smooth += (this.progress - this.smooth) * k;
    this.mouseS.lerp(this.mouse, k);
    const p = this.smooth;

    const z = 60 - p * 470;
    const cam = this.camera.position;
    cam.set(this.pathX(z) + this.mouseS.x * 3, 4.5 + Math.sin(p * Math.PI) * 6 + p * p * 10, z);
    const ahead = z - 40;
    // Look up the trunks a little more as the story moves toward the future.
    const pitch = 8 + p * 22 + Math.max(0, p - 0.8) * 90;
    this.camera.lookAt(this.pathX(ahead) - this.mouseS.x * 6, cam.y + pitch - this.mouseS.y * 10, ahead);
    this.uniforms.uWarmth.value = 0.35 + 0.65 * Math.sin(Math.min(p * 1.15, 1) * Math.PI * 0.5);
    this.renderer.render(this.scene, this.camera);
  }
}
