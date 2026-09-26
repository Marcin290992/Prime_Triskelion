// Mobile About portrait: the photo starts as a coarse two-tone
// Floyd–Steinberg dither, the cells shrink as the intro scrolls, then the
// real photo "develops" in through a Bayer-ordered cell pattern. Driven
// entirely from outside via setProgress (the page's ScrollTrigger) and only
// renders when something changed — no continuous rAF loop, which is what
// mobile Safari handles worst.
//
// Frames the photo like the <img> underneath it (object-fit: cover +
// object-position), so the fully developed canvas and the plain fallback
// image line up pixel for pixel.

export interface DitherPortraitOpts {
  src: string;
  ink: [number, number, number];   // 0..1 rgb
  paper: [number, number, number]; // 0..1 rgb
  // object-position of the <img> it replaces, 0..1 (0.5 = center)
  focusX?: number;
  focusY?: number;
  startPixelSize?: number; // CSS px per dither cell at progress 0
  pixelSize?: number;      // CSS px per dither cell once shrunk
  shrinkEnd?: number;      // progress at which cells reach pixelSize
  developStart?: number;   // progress where the photo starts showing
  contrast?: number;
  brightness?: number;
  // "Sink" (setSink): as it rises the frame dims, a vignette closes in on
  // this point (canvas 0..1, y down) and the edges fall back into dither —
  // the face stays readable while the rest returns to the dark.
  sinkFocusX?: number;
  sinkFocusY?: number;
  sinkRadius?: number; // vignette radius at full sink, in canvas heights
  // Fires once the texture is uploaded and the first frame is drawn.
  onReady?: () => void;
}

export interface DitherPortraitHandle {
  setProgress(p: number): void;
  setSink(s: number): void;
  destroy(): void;
}

const FLOYD: [number, number, number][] = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

const VERTEX = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D tImage;
uniform sampler2D tDiffused;
uniform int uDiffused;
uniform vec2 uResolution;
uniform vec2 uCover;
uniform vec2 uOffset;
uniform float uCell;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uMatte;
uniform float uKey;
uniform float uContrast;
uniform float uBrightness;
uniform float uDevelop;
uniform float uSink;
uniform vec2 uSinkFocus;
uniform float uSinkRadius;

in vec2 vUv;
out vec4 fragColor;

float bayer(vec2 cell) {
  ivec2 p = ivec2(mod(cell, 8.0));
  int v = p.x ^ p.y;
  int m = ((v & 1) << 5) | ((p.y & 1) << 4) | ((v & 2) << 2) | ((p.y & 2) << 1) | ((v & 4) >> 1) | ((p.y & 4) >> 2);
  return (float(m) + 0.5) / 64.0;
}

vec2 imageUv(vec2 uv) {
  return uv * uCover + uOffset;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 cell = floor(px / uCell);
  vec2 center = (cell + 0.5) * uCell;
  vec2 cellUv = vec2(center.x / uResolution.x, 1.0 - center.y / uResolution.y);

  float level;
  if (uDiffused == 1) {
    level = texelFetch(tDiffused, ivec2(cell), 0).r;
  } else {
    // Ordered fallback if the CPU diffusion is unavailable.
    vec3 c = texture(tImage, imageUv(cellUv)).rgb;
    float knock = uKey * (1.0 - smoothstep(0.05, 0.22, distance(c, uMatte)));
    float v = pow(clamp((dot(c, vec3(0.2126, 0.7152, 0.0722)) - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0), 1.6);
    level = step(bayer(cell), v * (1.0 - knock));
  }

  // Vignette around the face: 1 inside, 0 outside. Starts wider than the
  // frame and closes in to uSinkRadius as uSink rises.
  vec2 q = (vec2(cellUv.x, 1.0 - cellUv.y) - uSinkFocus) * vec2(uResolution.x / uResolution.y, 1.0);
  float radius = mix(1.4, uSinkRadius, uSink);
  float vign = 1.0 - smoothstep(radius, radius + 0.3, length(q));

  vec3 color = mix(uInk, uPaper, level);
  vec3 photo = texture(tImage, imageUv(vUv)).rgb;
  // Outside the vignette the photo dissolves back into dither, cell by
  // cell in the same Bayer order it developed in.
  float shown = uDevelop - (1.0 - vign) * uSink;
  color = mix(color, photo, step(bayer(cell.yx), shown));
  // Dim toward ~55% in the face, to black at the edges.
  color *= mix(1.0, 0.55 * vign, uSink);
  fragColor = vec4(color, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('ditherPortrait shader: ' + info);
  }
  return shader;
}

// Average + spread of the image's border pixels: a near-uniform border
// ("plain" backdrop) gets knocked out to ink, otherwise Floyd–Steinberg
// turns its faint brightness into stray rows of dots.
function measureEdge(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
  const size = 32;
  ctx.canvas.width = size;
  ctx.canvas.height = size;
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x > 0 && y > 0 && x < size - 1 && y < size - 1) continue;
      for (let c = 0; c < 3; c++) {
        const v = data[(y * size + x) * 4 + c] / 255;
        sum[c] += v;
        squares[c] += v * v;
      }
      count++;
    }
  }
  const matte = sum.map((s) => s / count) as [number, number, number];
  let spread = 0;
  for (let i = 0; i < 3; i++) spread += Math.sqrt(Math.max(0, squares[i] / count - matte[i] * matte[i]));
  return { matte, plain: spread / 3 < 0.06 };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function initDitherPortrait(canvas: HTMLCanvasElement, opts: DitherPortraitOpts): DitherPortraitHandle | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return null;

  const focusX = opts.focusX ?? 0.5;
  const focusY = opts.focusY ?? 0.5;
  const startPixelSize = opts.startPixelSize ?? 6;
  const pixelSize = opts.pixelSize ?? 2;
  const shrinkEnd = opts.shrinkEnd ?? 0.6;
  const developStart = opts.developStart ?? 0.5;
  const contrast = opts.contrast ?? 1.15;
  const brightness = opts.brightness ?? 0;
  const sinkFocusX = opts.sinkFocusX ?? 0.5;
  const sinkFocusY = opts.sinkFocusY ?? 0.45;
  const sinkRadius = opts.sinkRadius ?? 0.3;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let program: WebGLProgram;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'position');
    gl.bindAttribLocation(program, 1, 'uv');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }

  const names = [
    'tImage', 'tDiffused', 'uDiffused', 'uResolution', 'uCover', 'uOffset', 'uCell',
    'uInk', 'uPaper', 'uMatte', 'uKey', 'uContrast', 'uBrightness', 'uDevelop',
    'uSink', 'uSinkFocus', 'uSinkRadius',
  ] as const;
  const u = {} as Record<(typeof names)[number], WebGLUniformLocation | null>;
  for (const n of names) u[n] = gl.getUniformLocation(program, n);

  // Fullscreen triangle.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = [
    [0, new Float32Array([-1, -1, 3, -1, -1, 3])],
    [1, new Float32Array([0, 0, 2, 0, 0, 2])],
  ] as const;
  const glBuffers: WebGLBuffer[] = [];
  for (const [loc, data] of buffers) {
    const buf = gl.createBuffer()!;
    glBuffers.push(buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);

  function makeTexture(filter: number): WebGLTexture {
    const t = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return t;
  }
  const imageTex = makeTexture(gl.LINEAR);
  const diffusedTex = makeTexture(gl.NEAREST);

  const sampler = document.createElement('canvas');
  const samplerCtx = sampler.getContext('2d', { willReadFrequently: true });

  let image: HTMLImageElement | null = null;
  let matte: [number, number, number] = [0, 0, 0];
  let key = 0;
  let cover: [number, number] = [1, 1];
  let progress = 0;
  let sink = 0;
  let raf = 0;
  let ready = false;
  let destroyed = false;
  let diffusionBlocked = false;
  // Diffused cells keyed by cell size — the scrub only ever visits a
  // handful of integer sizes, so scrolling back and forth never re-runs the
  // CPU pass. Cleared whenever the canvas size changes.
  const diffusedCache = new Map<number, Uint8Array>();
  let uploadedCell = 0;

  function layout(): boolean {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height) return false;
    canvas.width = w;
    canvas.height = h;
    diffusedCache.clear();
    uploadedCell = 0;
    return true;
  }

  function updateCover() {
    if (!image) return;
    const ratio = (canvas.width / canvas.height) / (image.naturalWidth / image.naturalHeight);
    cover = ratio > 1 ? [1, 1 / ratio] : [ratio, 1];
  }

  function diffuse(cell: number): Uint8Array {
    const cols = Math.ceil(canvas.width / cell);
    const rows = Math.ceil(canvas.height / cell);
    const img = image!;
    const ctx = samplerCtx!;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    sampler.width = cols;
    sampler.height = rows;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = `rgb(${matte[0] * 255},${matte[1] * 255},${matte[2] * 255})`;
    ctx.fillRect(0, 0, cols, rows);
    // Same crop as the shader: visible window of cover × image, offset by
    // the focus point (y measured from the top here, canvas-style).
    const scaleX = (canvas.width / cell) / (cover[0] * iw);
    const scaleY = (canvas.height / cell) / (cover[1] * ih);
    const x0 = (1 - cover[0]) * focusX * iw;
    const y0 = (1 - cover[1]) * focusY * ih;
    ctx.drawImage(img, -x0 * scaleX, -y0 * scaleY, iw * scaleX, ih * scaleY);

    const pixels = ctx.getImageData(0, 0, cols, rows).data;
    const values = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
      const r = pixels[i * 4] / 255;
      const g = pixels[i * 4 + 1] / 255;
      const b = pixels[i * 4 + 2] / 255;
      const graded = Math.pow(Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b - 0.5) * contrast + 0.5 + brightness)), 1.6);
      const dist = Math.hypot(r - matte[0], g - matte[1], b - matte[2]);
      values[i] = graded * (1 - key * (1 - smoothstep(0.05, 0.22, dist)));
    }
    const out = new Uint8Array(cols * rows * 4);
    for (let y = 0; y < rows; y++) {
      const dir = y & 1 ? -1 : 1;
      for (let i = 0; i < cols; i++) {
        const x = dir > 0 ? i : cols - 1 - i;
        const p = y * cols + x;
        const old = values[p];
        const q = old >= 0.5 ? 1 : 0;
        const err = old - q;
        out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = q * 255;
        out[p * 4 + 3] = 255;
        for (const [kx, ky, kw] of FLOYD) {
          const nx = x + kx * dir;
          const ny = y + ky;
          if (nx < 0 || nx >= cols || ny >= rows) continue;
          values[ny * cols + nx] += err * kw;
        }
      }
    }
    return out;
  }

  function render() {
    raf = 0;
    if (destroyed || !image) return;
    layout();
    updateCover();

    const shrinkT = Math.min(1, progress / shrinkEnd);
    const shrink = 1 - Math.pow(1 - shrinkT, 2);
    let develop = Math.min(1, Math.max(0, (progress - developStart) / (1 - developStart)));
    develop = develop * develop * (3 - 2 * develop);
    const cell = Math.max(1, Math.round((startPixelSize + (pixelSize - startPixelSize) * shrink) * dpr));

    let useDiffused = 0;
    if (samplerCtx && !diffusionBlocked) {
      try {
        if (cell !== uploadedCell) {
          let data = diffusedCache.get(cell);
          if (!data) {
            data = diffuse(cell);
            diffusedCache.set(cell, data);
          }
          gl!.bindTexture(gl!.TEXTURE_2D, diffusedTex);
          gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, Math.ceil(canvas.width / cell), Math.ceil(canvas.height / cell), 0, gl!.RGBA, gl!.UNSIGNED_BYTE, data);
          uploadedCell = cell;
        }
        useDiffused = 1;
      } catch {
        diffusionBlocked = true;
      }
    }

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.useProgram(program);
    gl!.bindVertexArray(vao);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, imageTex);
    gl!.uniform1i(u.tImage, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, diffusedTex);
    gl!.uniform1i(u.tDiffused, 1);
    gl!.uniform1i(u.uDiffused, useDiffused);
    gl!.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl!.uniform2f(u.uCover, cover[0], cover[1]);
    // Texture is flipped (v = 1 at the top), so the top-down focus becomes
    // (1 - focusY) here.
    gl!.uniform2f(u.uOffset, (1 - cover[0]) * focusX, (1 - cover[1]) * (1 - focusY));
    gl!.uniform1f(u.uCell, cell);
    gl!.uniform3f(u.uInk, opts.ink[0], opts.ink[1], opts.ink[2]);
    gl!.uniform3f(u.uPaper, opts.paper[0], opts.paper[1], opts.paper[2]);
    gl!.uniform3f(u.uMatte, matte[0], matte[1], matte[2]);
    gl!.uniform1f(u.uKey, key);
    gl!.uniform1f(u.uContrast, contrast);
    gl!.uniform1f(u.uBrightness, brightness);
    gl!.uniform1f(u.uDevelop, develop);
    gl!.uniform1f(u.uSink, sink);
    gl!.uniform2f(u.uSinkFocus, sinkFocusX, sinkFocusY);
    gl!.uniform1f(u.uSinkRadius, sinkRadius);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    if (!ready) {
      ready = true;
      opts.onReady?.();
    }
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(render);
  }

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (destroyed) return;
    gl.bindTexture(gl.TEXTURE_2D, imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    try {
      if (samplerCtx) {
        const edge = measureEdge(samplerCtx, img);
        matte = edge.matte;
        key = edge.plain ? 1 : 0;
      }
    } catch {
      /* tainted/unsupported — ordered fallback without knockout */
    }
    image = img;
    schedule();
  };
  img.src = opts.src;

  // Width changes only (rotation). The box is sized off --app-stable-vh,
  // so toolbar show/hide doesn't resize it — and a height-only resize must
  // not re-run the diffusion mid-scroll anyway.
  let lastWidth = canvas.clientWidth;
  const ro = new ResizeObserver(() => {
    if (canvas.clientWidth === lastWidth && ready) return;
    lastWidth = canvas.clientWidth;
    schedule();
  });
  ro.observe(canvas);

  return {
    setProgress(p: number) {
      const next = Math.min(1, Math.max(0, p));
      if (next === progress) return;
      progress = next;
      schedule();
    },
    setSink(s: number) {
      const next = Math.min(1, Math.max(0, s));
      if (next === sink) return;
      sink = next;
      schedule();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      img.onload = null;
      gl.deleteTexture(imageTex);
      gl.deleteTexture(diffusedTex);
      for (const b of glBuffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
