import * as THREE from 'three';

/* ---------- utilities ---------- */
async function sha256Bytes(str: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return new Uint8Array(h);
}

function byte01(b: number) { return b / 255; }

function bytesToFloats(bytes: Uint8Array, count = 6) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = (i * 4) % bytes.length;
    const num = ((bytes[idx] << 24 >>> 0) + (bytes[idx + 1] << 16) + (bytes[idx + 2] << 8) + (bytes[idx + 3])) >>> 0;
    out.push((num % 1000000) / 1000000);
  }
  return out;
}

/* ---------- palettes (curated) ---------- */
const PALETTES = [
  { name: "Cosmic Green/Gold", cols: ["#061d16", "#7fe06a", "#bfe86a", "#ffd86a"] },
  { name: "Deep Ocean", cols: ["#041a2b", "#005f73", "#2a9d8f", "#e9c46a"] },
  { name: "Inferno", cols: ["#2b0a0a", "#ff6f3c", "#ffbe55", "#ffd6a5"] },
  { name: "Ghost Nebula", cols: ["#000013", "#9dd3ff", "#e2f0ff", "#ffffff"] },
  { name: "Rainbow Pop", cols: ["#130f40", "#f72585", "#7209b7", "#3a0ca3"] },
  { name: "Jade & Moss", cols: ["#02140b", "#3a7d44", "#93c572", "#e6f4d9"] },
  { name: "Coral Candy", cols: ["#220f1b", "#ff6b6b", "#ffd6a5", "#ffe6e6"] },
  { name: "Ocean Bloom", cols: ["#001219", "#2ec4b6", "#7bd389", "#dff3ee"] },
  { name: "Violet Galaxy", cols: ["#050014", "#8a2be2", "#c77dff", "#ffeeff"] },
  { name: "Warm Amber", cols: ["#1b0b00", "#ffb703", "#fb8500", "#ffd6a5"] },
];

/* ---------- shader code (fragment + vertex) ---------- */
const VERT = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
void main(){
  gl_Position = vec4(position,1.0);
}
`;

const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_seed;
uniform float u_depth;
uniform float u_twist;
uniform float u_wisp;
uniform float u_glow;
uniform float u_scale;
uniform float u_contrast;
uniform float u_pattern; // treated as float: 0..5 -> choose pattern based on ranges
uniform vec2 u_highlightOff;
uniform vec3 u_colors[4];

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0,0.0));
  float c = hash21(i + vec2(0.0,1.0));
  float d = hash21(i + vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0.0; float a=0.5;
  for(int i=0;i<6;i++){
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// small helpers
float smoothPow(float x, float p){ return pow(clamp(x,0.0,1.0), p); }
vec3 palette(float t){
  vec3 a = mix(u_colors[0], u_colors[1], smoothstep(0.0,0.4,t));
  vec3 b = mix(u_colors[2], u_colors[3], smoothstep(0.4,1.0,t));
  return mix(a,b,t);
}

// 0: vortex
float pattern_vortex(vec2 uv, float r){
  float angle = atan(uv.y, uv.x);
  angle += u_twist * r;
  vec2 p = vec2(cos(angle), sin(angle)) * pow(r, 0.7) * u_scale;
  float d = fbm(p * (u_depth + 0.5) + u_seed*3.14);
  return clamp(d,0.0,1.0);
}
// 1: flower implosion
float pattern_flower(vec2 uv, float r){
  float a = atan(uv.y, uv.x);
  float petals = 3.0 + floor(fract(u_seed*10.0)*4.0);
  float p = cos(a * petals + u_seed*6.0);
  float rings = sin((1.0 - pow(r,0.6)) * (8.0 + u_depth*4.0) + p*2.0);
  float f = smoothstep(0.0, 1.0, rings*0.5 + fbm(uv*u_wisp + u_seed)*0.3);
  return clamp(f,0.0,1.0);
}
// 2: ribbons
float pattern_ribbons(vec2 uv, float r){
  vec2 axis = normalize(vec2(0.7, 0.3));
  float stripe = dot(uv, axis);
  stripe += sin(uv.y*6.0*u_scale + fbm(uv*u_wisp + u_seed)*2.0)*0.2;
  float s = fract(stripe * (2.0 + u_depth*2.0));
  return pow(1.0 - abs(s-0.5)*2.0, 1.0 + u_contrast*2.0);
}
// 3: bubbles
float pattern_bubbles(vec2 uv, float r){
  float v = 0.0;
  for(int i=0;i<10;i++){
    float idx = float(i);
    vec2 c = vec2(
      fract(cos(idx*45.1 + u_seed*23.4)*1234.5)-0.5,
      fract(cos(idx*78.233 + u_seed*127.1)*43758.5453)-0.5
    ) * 0.9;
    float d = length(uv - c);
    float s = smoothstep(0.25, 0.02, d * (3.0 + u_scale*4.0));
    v = max(v, s);
  }
  v *= smoothstep(0.95, 0.45, r);
  return v;
}
// 4: checker/tech
float pattern_checker(vec2 uv, float r){
  vec2 p = uv * (3.0 + u_depth*5.0) * u_scale;
  vec2 ip = floor(p);
  float t = mod(ip.x + ip.y, 2.0);
  float f = smoothstep(0.2, 0.8, fract(p.x) * (0.5 + u_contrast*2.0));
  return mix(f, 1.0 - f, t);
}
// 5: off-center core
float pattern_core(vec2 uv, float r){
  vec2 corePos = u_highlightOff * 0.9;
  float d = length(uv - corePos);
  float c = exp(-d * (3.0 + u_glow*2.0));
  float inner = smoothstep(0.9, 0.0, d * (2.0 + u_scale*2.0));
  return clamp(c + inner*0.6, 0.0, 1.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_resolution) / min(u_resolution.x, u_resolution.y);
  float r = length(uv);

  float val = 0.0;
  // choose pattern via u_pattern ranges (0..5)
  if(u_pattern < 0.5) { val = pattern_vortex(uv,r); }
  else if(u_pattern < 1.5) { val = pattern_flower(uv,r); }
  else if(u_pattern < 2.5) { val = pattern_ribbons(uv,r); }
  else if(u_pattern < 3.5) { val = pattern_bubbles(uv,r); }
  else if(u_pattern < 4.5) { val = pattern_checker(uv,r); }
  else { val = pattern_core(uv,r); }

  // add small-scale wisps
  float w = fbm(uv * (2.0 + u_wisp*2.0) + u_seed);
  val = clamp(val + w * 0.12, 0.0, 1.0);

  // contrast shaping
  val = pow(val, 1.0 - u_contrast*0.8);

  // colorize
  vec3 col = palette(val);

  // additive inner glow
  float glow = exp(-r * u_glow) * (0.6 + val*0.8);
  col += glow * 0.7;

  // specular highlight off-center
  vec3 viewPos = normalize(vec3(uv - u_highlightOff, 1.0));
  float fres = pow(1.0 - dot(viewPos, vec3(0.0,0.0,1.0)), 3.0);
  float specDist = length(uv - u_highlightOff);
  float spec = smoothstep(0.05, 0.0, specDist * (6.0 - u_contrast*3.0)) * (0.6 + fres*0.6);
  col += vec3(1.0) * spec;

  // dark spherical vignette
  col *= 1.0 - smoothstep(0.65, 1.0, r);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- renderer setup (shared) ---------- */
function createRendererCanvas(width: number, height: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  return renderer;
}

export interface AvatarInfo {
  seed: string;
  dataURL: string;
  pattern: number;
  paletteIndex: number;
  paletteName: string;
  patternName: string;
}

/* ---------- generation logic ---------- */
export async function generateAvatarImage(seedString: string, size = 512, forcedPattern = -1, forcedPalette = -1): Promise<AvatarInfo> {
  const seed = (seedString && seedString.length > 0) ? seedString : ("user_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
  const bytes = await sha256Bytes(seed);
  const floats = bytesToFloats(bytes, 6);

  // pick palette deterministically
  const palIndex = (forcedPalette >= 0) ? forcedPalette : (bytes[2] % PALETTES.length);
  const palette = PALETTES[palIndex].cols.map(c => new THREE.Color(c));

  // pattern: 0..5
  const pattern = (forcedPattern >= 0) ? forcedPattern : (bytes[5] % 6);

  // highlight offset from bytes 6/7 -> range -0.25..0.25
  const hx = (byte01(bytes[6]) - 0.5) * 0.5;
  const hy = (byte01(bytes[7]) - 0.5) * 0.5;

  // other params
  const scale = 0.9 + byte01(bytes[8]) * 1.6;
  const contrast = byte01(bytes[9]) * 0.9;

  // uniforms
  const uniforms = {
    u_resolution: { value: new THREE.Vector2(size, size) },
    u_seed: { value: floats[0] * 20.0 },
    u_depth: { value: 2.0 + floats[1] * 4.0 },
    u_twist: { value: 3.0 + floats[2] * 4.0 },
    u_wisp: { value: 2.0 + floats[3] * 3.0 },
    u_glow: { value: 4.0 + floats[4] * 3.0 },
    u_scale: { value: scale },
    u_contrast: { value: contrast },
    u_pattern: { value: pattern }, // as float, used in ranges in shader
    u_highlightOff: { value: new THREE.Vector2(hx, hy) },
    u_colors: {
      value: [
        palette[0],
        palette[1],
        palette[2],
        palette[3]
      ]
    }
  };

  // three.js offscreen render
  const renderer = createRendererCanvas(size, size);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const material = new THREE.RawShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  renderer.render(scene, camera);

  // get data URL & cleanup
  const dataURL = renderer.domElement.toDataURL('image/png');

  quad.geometry.dispose();
  material.dispose();
  renderer.forceContextLoss();
  renderer.dispose();

  // give caller the seed, pattern name, palette info, and data url
  return {
    seed,
    dataURL,
    pattern,
    paletteIndex: palIndex,
    paletteName: PALETTES[palIndex].name,
    patternName: ["vortex", "flower", "ribbons", "bubbles", "checker", "off-center core"][pattern]
  };
}
