// Adapted from the CodegridPRO "Zen Obasi" template (licensed): the image drawn on a canvas with a fluid that follows the
// pointer and film grain. Used on the case-study gallery (desktop). Two changes from the original: the pointer is read against
// the canvas's live position (the frames rise into place and drift, so a cached page position goes stale), and the
// picture's offset comes from the --py parallax variable instead of GSAP transforms.
import gsap from "gsap";
import { fluidShader } from "./shaders/fluid.js";
import { grainNoiseShader, overlayGrain } from "./shaders/grain.js";

const vertexShader = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const displayShader = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform sampler2D uImage;
uniform sampler2D uFluid;
uniform sampler2D uNoise;
uniform vec4 uRect;
uniform vec2 uDisplacement;
uniform float uAmount;

out vec4 outColor;

${overlayGrain}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv -= texture(uFluid, uv).xy * uDisplacement;
  vec3 color = texture(uImage, (vec2(uv.x, 1.0 - uv.y) - uRect.xy) / uRect.zw).rgb;
  float stored = texelFetch(uNoise, ivec2(gl_FragCoord.xy), 0).r;
  outColor = vec4(overlayGrain(color, stored, uAmount), 1.0);
}
`;

function createProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexShader],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function locate(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

function objectPosition(value) {
  const [x = "50%", y = "50%"] = value.split(" ");
  const fraction = (part) => (part.endsWith("%") ? parseFloat(part) / 100 : 0.5);
  return [fraction(x), fraction(y)];
}

const spare = [];

function create(element, config) {
  const image = element.querySelector("img");
  if (!image) return null;

  const canvas = spare.pop() ?? document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    display: "block",
    pointerEvents: "none",
    visibility: "hidden",
  });

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;
  if (gl.isContextLost()) return create(element, config);
  const loseContext = () => gl.getExtension("WEBGL_lose_context")?.loseContext();

  const floatTargets = Boolean(
    gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"),
  );

  const noiseProgram = createProgram(gl, grainNoiseShader);
  const display = createProgram(gl, displayShader);
  const fluidProgram = floatTargets ? createProgram(gl, fluidShader) : null;
  if (!noiseProgram || !display) {
    loseContext();
    return null;
  }
  const controller = new AbortController();
  const { signal } = controller;
  const observers = [];

  const noiseUniforms = locate(gl, noiseProgram, ["uTime", "uFrame", "uBlend", "uPrevious"]);
  const displayUniforms = locate(gl, display, [
    "uResolution",
    "uImage",
    "uFluid",
    "uNoise",
    "uRect",
    "uDisplacement",
    "uAmount",
  ]);
  const fluidUniforms = fluidProgram
    ? locate(gl, fluidProgram, [
        "uResolution",
        "uPrevious",
        "uMouse",
        "uMouseActive",
        "uScale",
        "uBrushSize",
        "uBrushStrength",
        "uDecay",
        "uPressureDecay",
        "uStopDecay",
      ])
    : null;

  gl.useProgram(noiseProgram);
  gl.uniform1i(noiseUniforms.uPrevious, 2);
  gl.useProgram(display);
  gl.uniform1i(displayUniforms.uImage, 0);
  gl.uniform1i(displayUniforms.uFluid, 1);
  gl.uniform1i(displayUniforms.uNoise, 2);
  if (fluidProgram) {
    gl.useProgram(fluidProgram);
    gl.uniform1i(fluidUniforms.uPrevious, 3);
  }

  function createTarget(width, height, internalFormat, layout, type, filter, clear) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, layout, type, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(...clear);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, complete };
  }

  function deleteTargets(targets) {
    for (const { texture, framebuffer } of targets) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
    }
  }

  let noiseTargets = [];
  let fluidTargets = [];
  const fluidSize = { width: 0, height: 0 };

  function createNoiseTargets(width, height, useFloat = floatTargets) {
    deleteTargets(noiseTargets);
    const target = () =>
      useFloat
        ? createTarget(
            width,
            height,
            gl.R16F,
            gl.RED,
            gl.HALF_FLOAT,
            gl.NEAREST,
            [0.5, 0.5, 0.5, 1],
          )
        : createTarget(
            width,
            height,
            gl.RGBA8,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            gl.NEAREST,
            [0.5, 0.5, 0.5, 1],
          );
    noiseTargets = [target(), target()];
    if (useFloat && !noiseTargets.every((t) => t.complete))
      createNoiseTargets(width, height, false);
  }

  function createFluidTargets(width, height) {
    deleteTargets(fluidTargets);
    const target = () =>
      createTarget(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, [0, 0, 0, 0]);
    fluidTargets = [target(), target()];
    gl.useProgram(fluidProgram);
    gl.uniform2f(fluidUniforms.uResolution, width, height);
  }

  const stillFluid = createTarget(
    1,
    1,
    gl.RGBA8,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    gl.NEAREST,
    [0, 0, 0, 0],
  );

  const imageTexture = gl.createTexture();
  let imageSize = null;

  function upload(source) {
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.getError();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (gl.getError()) return;
    gl.generateMipmap(gl.TEXTURE_2D);
    imageSize = [source.width, source.height];
    sizeDirty = true;
  }

  let fluidScale = 1;

  function apply() {
    const { fluid, grain } = config;
    gl.useProgram(noiseProgram);
    gl.uniform1f(noiseUniforms.uBlend, grain.blend);
    gl.useProgram(display);
    gl.uniform1f(displayUniforms.uAmount, grain.amount);
    gl.uniform2f(
      displayUniforms.uDisplacement,
      fluid.distortion / (fluidScale * Math.max(cssWidth, 1)),
      fluid.distortion / (fluidScale * Math.max(cssHeight, 1)),
    );
    if (!fluidProgram) return;
    gl.useProgram(fluidProgram);
    gl.uniform1f(fluidUniforms.uScale, fluidScale);
    gl.uniform1f(fluidUniforms.uBrushSize, Math.max(fluid.brushSize, 0.01));
    gl.uniform1f(fluidUniforms.uBrushStrength, fluid.brushStrength);
    gl.uniform1f(fluidUniforms.uDecay, fluid.decay);
    gl.uniform1f(fluidUniforms.uPressureDecay, fluid.trail);
    gl.uniform1f(fluidUniforms.uStopDecay, fluid.stopDecay);
  }

  let sizeDirty = true;
  const markSize = () => (sizeDirty = true);
  observers.push(new ResizeObserver(markSize), new ResizeObserver(markSize));
  observers.at(-2).observe(canvas);
  observers.at(-1).observe(document.body);
  window.addEventListener("resize", markSize, { signal });

  let cssWidth = 1;
  let cssHeight = 1;
  const page = { left: 0, top: 0 };
  const rect = { x: 0, y: 0, width: 1, height: 1, boxHeight: 1 };

  let devicePixelRatio = 0;

  function resize() {
    if (window.devicePixelRatio !== devicePixelRatio) sizeDirty = true;
    if (!sizeDirty) return;
    sizeDirty = false;
    devicePixelRatio = window.devicePixelRatio;

    cssWidth = Math.max(canvas.clientWidth, 1);
    cssHeight = Math.max(canvas.clientHeight, 1);
    const bounds = canvas.getBoundingClientRect();
    page.left = bounds.left + window.scrollX;
    page.top = bounds.top + window.scrollY;

    if (imageSize) {
      const [naturalWidth, naturalHeight] = imageSize;
      const box = {
        x: image.offsetLeft,
        y: image.offsetTop,
        width: image.offsetWidth,
        height: image.offsetHeight,
      };
      const [px, py] = objectPosition(getComputedStyle(image).objectPosition);
      const cover = Math.max(box.width / naturalWidth, box.height / naturalHeight);
      rect.width = naturalWidth * cover;
      rect.height = naturalHeight * cover;
      rect.x = box.x + (box.width - rect.width) * px;
      rect.y = box.y + (box.height - rect.height) * py;
      rect.boxHeight = box.height;
    }

    const pixelRatio = Math.min(devicePixelRatio || 1, config.maxPixelRatio);
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (width !== canvas.width || height !== canvas.height || !noiseTargets.length) {
      canvas.width = width;
      canvas.height = height;
      createNoiseTargets(width, height);
    }
    gl.useProgram(display);
    gl.uniform2f(displayUniforms.uResolution, width, height);

    if (fluidProgram) {
      const fluidWidth = Math.max(1, Math.round(cssWidth * config.fluid.resolution));
      const fluidHeight = Math.max(1, Math.round(cssHeight * config.fluid.resolution));
      if (fluidWidth !== fluidSize.width || fluidHeight !== fluidSize.height) {
        fluidSize.width = fluidWidth;
        fluidSize.height = fluidHeight;
        createFluidTargets(fluidWidth, fluidHeight);
      }
      fluidScale = fluidHeight / cssHeight;
    }
    apply();
  }

  const pointer = { x: 0, y: 0, lastMove: 0, seen: false };
  let previous = null;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.seen = true;
      pointer.lastMove = performance.now();
    },
    { passive: true, signal },
  );
  document.documentElement.addEventListener("pointerleave", () => (pointer.seen = false), {
    signal,
  });

  function simulate(now) {
    const active = pointer.seen && now - pointer.lastMove < 100;
    const live = canvas.getBoundingClientRect();
    const x = (pointer.x - live.left) * fluidScale;
    const y = (cssHeight - (pointer.y - live.top)) * fluidScale;
    if (!active || !previous) previous = [x, y];

    const [read, write] = fluidTargets;
    gl.viewport(0, 0, fluidSize.width, fluidSize.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.useProgram(fluidProgram);
    gl.uniform4f(fluidUniforms.uMouse, x, y, ...previous);
    gl.uniform1f(fluidUniforms.uMouseActive, active ? 1 : 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    fluidTargets = [write, read];
    previous = [x, y];
  }

  let frameCount = 0;

  function grain(time) {
    const [read, write] = noiseTargets;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.useProgram(noiseProgram);
    gl.uniform1f(noiseUniforms.uTime, time);
    gl.uniform1f(noiseUniforms.uFrame, frameCount++ % 100000);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    noiseTargets = [write, read];
  }

  function present() {
    // the picture drifts by --py percent of its own height (see initGalleryParallax in the case-study page)
    const shift = ((parseFloat(element.style.getPropertyValue("--py")) || 0) / 100) * image.offsetHeight;
    gl.useProgram(display);
    gl.uniform4f(
      displayUniforms.uRect,
      rect.x / cssWidth,
      (rect.y + shift) / cssHeight,
      rect.width / cssWidth,
      rect.height / cssHeight,
    );
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fluidProgram ? fluidTargets[0].texture : stillFluid.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, noiseTargets[0].texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (canvas.style.visibility) {
      canvas.style.visibility = "";
      image.style.opacity = "0";
    }
  }

  const start = performance.now();

  const settleGrain = () => {
    for (let i = 0; i < 40; i++) grain(0);
  };

  function tick() {
    const now = performance.now();
    resize();
    if (fluidProgram) simulate(now);
    if (!frameCount) settleGrain();
    grain((now - start) / 1000);
    present();
  }

  let visible = false;
  let running = false;
  function update() {
    if (running) gsap.ticker.remove(tick);
    running = false;
    if (!visible || !imageSize) return;
    gsap.ticker.add(tick);
    running = true;
  }

  element.appendChild(canvas);

  observers.push(
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }),
  );
  observers.at(-1).observe(element);

  const ready = () =>
    fetch(image.currentSrc || image.src)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (!signal.aborted) {
          upload(bitmap);
          update();
        }
        bitmap.close();
      })
      .catch(() => {});
  if (image.complete) ready();
  else image.addEventListener("load", ready, { once: true, signal });

  const stop = () => {
    if (running) gsap.ticker.remove(tick);
    running = false;
    image.style.opacity = "";
    canvas.remove();
  };

  return {
    destroy() {
      controller.abort();
      observers.forEach((observer) => observer.disconnect());
      stop();
      deleteTargets([...noiseTargets, ...fluidTargets, stillFluid]);
      gl.deleteTexture(imageTexture);
      for (const program of [noiseProgram, display, fluidProgram]) gl.deleteProgram(program);
      if (gl.isContextLost()) return;
      canvas.width = canvas.height = 1;
      spare.push(canvas);
    },
  };
}

export class ImageFluidEngine {
  #instance;

  constructor(element, config) {
    this.#instance = create(element, config);
  }

  dispose() {
    this.#instance?.destroy();
  }
}
