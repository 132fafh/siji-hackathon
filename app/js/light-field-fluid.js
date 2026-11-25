(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldFluid = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const TAU = Math.PI * 2;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : (fallback || 0);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
  }

  function limitVector(u, v, maximum) {
    const speed = Math.hypot(u, v);
    if (!Number.isFinite(speed) || speed === 0) return { u: 0, v: 0 };
    const scale = Math.min(1, maximum / speed);
    return { u: u * scale, v: v * scale };
  }

  function vortexVelocity(x, y, vortex) {
    const dx = finite(x) - finite(vortex && vortex.x);
    const dy = finite(y) - finite(vortex && vortex.y);
    const radiusSquared = dx * dx + dy * dy;
    if (radiusSquared < 1e-10) return { u: 0, v: 0 };
    const coreRadius = Math.max(0.5, finite(vortex && vortex.coreRadius, 2));
    const regularizedRadius = Math.max(radiusSquared, coreRadius * coreRadius);
    const circulation = finite(vortex && vortex.gamma);
    const factor = circulation / (TAU * regularizedRadius);
    return limitVector(-factor * dy, factor * dx, Math.max(0.1, finite(vortex && vortex.maxSpeed, 1.8)));
  }

  function flowVelocity(x, y, vortices) {
    let u = 0;
    let v = 0;
    (vortices || []).forEach((vortex) => {
      const velocity = vortexVelocity(x, y, vortex);
      u += velocity.u;
      v += velocity.v;
    });
    return limitVector(u, v, 2.4);
  }

  function bilinearColor(field, width, height, x, y) {
    const w = Math.max(1, Math.floor(finite(width, 1)));
    const h = Math.max(1, Math.floor(finite(height, 1)));
    const px = clamp(x, 0, w - 1);
    const py = clamp(y, 0, h - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = px - x0;
    const ty = py - y0;
    const color = [0, 0, 0];
    for (let channel = 0; channel < 3; channel++) {
      const at = (gx, gy) => clamp(field[(gy * w + gx) * 3 + channel], 0, 1);
      const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      color[channel] = top * (1 - ty) + bottom * ty;
    }
    return color;
  }

  function advectionSample(field, width, height, x, y, vortices, dt) {
    const step = clamp(dt, 0, 1);
    const first = flowVelocity(x, y, vortices);
    const middleX = x - first.u * step * 0.5;
    const middleY = y - first.v * step * 0.5;
    const middle = flowVelocity(middleX, middleY, vortices);
    const sourceX = x - middle.u * step;
    const sourceY = y - middle.v * step;
    const color = bilinearColor(field, width, height, sourceX, sourceY);
    const w = Math.max(1, Math.floor(finite(width, 1)));
    const h = Math.max(1, Math.floor(finite(height, 1)));
    const edgeDistance = Math.min(sourceX, sourceY, w - 1 - sourceX, h - 1 - sourceY);
    const boundary = clamp(edgeDistance / 1.5, 0, 1);
    return color.map((value) => value * boundary);
  }

  function advectColorField(field, width, height, vortices, dt, options) {
    const w = Math.max(1, Math.floor(finite(width, 1)));
    const h = Math.max(1, Math.floor(finite(height, 1)));
    const step = clamp(dt, 0, 0.1);
    const opts = options || {};
    const diffusion = Math.max(0, finite(opts.diffusion, 0.55));
    const fade = Math.max(0, finite(opts.fade, 0.055));
    const blend = 1 - Math.exp(-diffusion * step);
    const decay = Math.exp(-fade * step);
    const next = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = (y * w + x) * 3;
        const advected = advectionSample(field, w, h, x, y, vortices, step);
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const sx = Math.max(0, Math.min(w - 1, x + ox));
              const sy = Math.max(0, Math.min(h - 1, y + oy));
              sum += clamp(field[(sy * w + sx) * 3 + channel], 0, 1);
              count++;
            }
          }
          const diffused = advected[channel] * (1 - blend) + (sum / count) * blend;
          next[index + channel] = clamp(diffused * decay, 0, 1);
        }
      }
    }
    return next;
  }

  function createVortex(x, y, options) {
    const opts = options || {};
    const px = finite(x);
    const py = finite(y);
    const existing = opts.vortices || [];
    const flow = flowVelocity(px, py, existing);
    const speed = Number.isFinite(opts.speed) ? Math.max(0, opts.speed) : Math.hypot(flow.u, flow.v);
    const angle = Number.isFinite(opts.angle) ? opts.angle : Math.atan2(flow.v, flow.u);
    const direction = Math.cos(angle) >= 0 ? 1 : -1;
    const gamma = Number.isFinite(opts.gamma) ? opts.gamma : direction * (18 + Math.min(3, speed) * 4);
    const baseHue = Number.isFinite(opts.hue) ? opts.hue : 215 + angle * 180 / Math.PI + speed * 28;
    return {
      x: px,
      y: py,
      gamma: clamp(gamma, -36, 36),
      hue: ((finite(baseHue, 215) % 360) + 360) % 360,
      lightness: clamp(opts.lightness == null ? 0.5 + Math.min(0.12, speed * 0.025) : opts.lightness, 0.25, 0.72),
      radius: clamp(opts.radius == null ? 8 : opts.radius, 2, 18),
      coreRadius: clamp(opts.coreRadius == null ? 2.2 : opts.coreRadius, 0.5, 5),
      maxSpeed: clamp(opts.maxSpeed == null ? 1.8 : opts.maxSpeed, 0.1, 2.4),
      age: 0,
      life: Number.isFinite(opts.life) ? Math.max(0.1, opts.life) : Infinity,
      decay: clamp(opts.decay == null ? 0.12 : opts.decay, 0, 2),
    };
  }

  function decayVortex(vortex, dt) {
    const step = Math.max(0, finite(dt));
    const decay = Math.exp(-Math.max(0, finite(vortex.decay)) * step);
    const age = Math.max(0, finite(vortex.age)) + step;
    const next = Object.assign({}, vortex, {
      age,
      gamma: finite(vortex.gamma) * decay,
      lightness: clamp(finite(vortex.lightness, 0.5) * Math.exp(-Math.max(0, finite(vortex.decay)) * step * 0.65), 0, 1),
    });
    next.alive = age < finite(vortex.life, Infinity) && Math.abs(next.gamma) > 0.01;
    return next;
  }

  function decayVortices(vortices, dt) {
    return (vortices || []).map((vortex) => decayVortex(vortex, dt)).filter((vortex) => vortex.alive);
  }

  function hslToRgb(hue, saturation, lightness) {
    const h = ((finite(hue) % 360) + 360) % 360 / 360;
    const s = clamp(saturation, 0, 1);
    const l = clamp(lightness, 0, 1);
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (offset) => {
      let t = h + offset;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [channel(1 / 3), channel(0), channel(-1 / 3)];
  }

  function injectColor(field, width, height, x, y, vortex, amount) {
    const w = Math.max(1, Math.floor(finite(width, 1)));
    const h = Math.max(1, Math.floor(finite(height, 1)));
    const next = new Float32Array(field);
    const radius = Math.max(1, finite(vortex.radius, 8));
    const color = hslToRgb(vortex.hue, 0.58, vortex.lightness);
    const strength = clamp(amount, 0, 1);
    const minX = Math.max(0, Math.floor(x - radius * 1.8));
    const maxX = Math.min(w - 1, Math.ceil(x + radius * 1.8));
    const minY = Math.max(0, Math.floor(y - radius * 1.8));
    const maxY = Math.min(h - 1, Math.ceil(y + radius * 1.8));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px - x;
        const dy = py - y;
        const distanceSquared = (dx * dx + dy * dy) / (radius * radius);
        const weight = Math.exp(-distanceSquared * 2.2) * (1 - Math.min(1, distanceSquared / 3.24));
        if (weight <= 0) continue;
        const index = (py * w + px) * 3;
        for (let channel = 0; channel < 3; channel++) {
          next[index + channel] = clamp(next[index + channel] + color[channel] * weight * strength, 0, 1);
        }
      }
    }
    return next;
  }

  function createFluidField(canvas, motionQuery, options) {
    const env = options || {};
    const win = env.window || window;
    const doc = env.document || document;
    let ctx = null;
    try { ctx = canvas.getContext('2d', { alpha: false }); } catch (error) { ctx = null; }
    const simulationCanvas = doc.createElement('canvas');
    let simulationContext = null;
    if (ctx) simulationContext = simulationCanvas.getContext('2d', { alpha: false });
    let mode = ctx && simulationContext ? 'canvas-fluid' : 'css';
    let width = 1;
    let height = 1;
    let gridWidth = 1;
    let gridHeight = 1;
    let field = new Float32Array(3);
    let vortices = [];
    let image = null;
    let frameId = 0;
    let lastFrame = 0;
    let lastStep = 0;
    let frameNumber = 0;
    let disposed = false;
    const pointer = { x: 0.5, y: 0.5, down: false, energy: 0, focus: 0 };
    const flash = { x: 0.5, y: 0.5, at: -10000, strength: 0 };

    function setDataset() {
      let signature = 0;
      for (let index = 0; index < field.length; index++) signature += field[index] * (index % 17 + 1);
      canvas.dataset.lightRenderer = mode;
      canvas.dataset.vortexCount = String(vortices.length);
      canvas.dataset.fluidFrame = String(frameNumber);
      canvas.dataset.fluidSignature = Number.isFinite(signature) ? signature.toFixed(3) : '0.000';
    }

    function draw() {
      if (!ctx || !simulationContext || !image) return;
      for (let index = 0; index < gridWidth * gridHeight; index++) {
        const colorIndex = index * 3;
        const pixelIndex = index * 4;
        image.data[pixelIndex] = Math.round(5 + field[colorIndex] * 84);
        image.data[pixelIndex + 1] = Math.round(6 + field[colorIndex + 1] * 88);
        image.data[pixelIndex + 2] = Math.round(10 + field[colorIndex + 2] * 96);
        image.data[pixelIndex + 3] = 255;
      }
      simulationContext.putImageData(image, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(simulationCanvas, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.32;
      ctx.filter = 'blur(16px)';
      ctx.drawImage(simulationCanvas, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const age = (performance.now() - flash.at) / 1000;
      if (age < 1.2 && flash.strength > 0) {
        const alpha = Math.exp(-age * 2.8) * flash.strength * 0.12;
        const x = flash.x * canvas.width;
        const y = flash.y * canvas.height;
        const radius = Math.max(30, Math.min(canvas.width, canvas.height) * 0.12);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(235,240,245,' + alpha + ')');
        gradient.addColorStop(1, 'rgba(235,240,245,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      setDataset();
    }

    function step(dt) {
      if (mode !== 'canvas-fluid') return;
      const safeDelta = clamp(dt, 0, 0.06);
      vortices = decayVortices(vortices, safeDelta);
      field = advectColorField(field, gridWidth, gridHeight, vortices, safeDelta, { diffusion: 0.7, fade: 0.052 });
      vortices.forEach((vortex) => {
        const source = vortex.persistent ? 0.025 : 0.008;
        field = injectColor(field, gridWidth, gridHeight, vortex.x, vortex.y, vortex, source * safeDelta);
      });
      frameNumber++;
      draw();
    }

    function setPosition(clientX, clientY) {
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width, height };
      pointer.x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      pointer.y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    }

    function pulseNormalized(x, y, strength) {
      flash.x = clamp(x, 0, 1);
      flash.y = clamp(y, 0, 1);
      flash.at = performance.now();
      flash.strength = strength == null ? 1 : strength;
      if (motionQuery.matches) draw();
    }

    function disturbNormalized(x, y, strength) {
      if (mode !== 'canvas-fluid') return;
      const px = clamp(x, 0, 1) * (gridWidth - 1);
      const py = clamp(y, 0, 1) * (gridHeight - 1);
      const vortex = createVortex(px, py, {
        vortices,
        radius: 4.5 + Math.min(3, finite(strength, 1) * 2),
        lightness: 0.54,
        life: 20,
        decay: 0.1,
      });
      vortices.push(vortex);
      if (vortices.length > 12) vortices.splice(3, vortices.length - 12);
      field = injectColor(field, gridWidth, gridHeight, px, py, vortex, 0.58);
      frameNumber++;
      draw();
    }

    function pointerMove(clientX, clientY, pointerType) {
      setPosition(clientX, clientY);
      pointer.energy = pointerType === 'touch' ? 0.9 : 0.52;
    }

    function pointerDown(clientX, clientY) {
      setPosition(clientX, clientY);
      pointer.down = true;
      pointer.energy = 1;
    }

    function dragNormalized(x, y, strength) {
      disturbNormalized(x, y, strength == null ? 0.55 : strength);
    }

    function pointerUp(clientX, clientY, emitPulse, pointerType) {
      setPosition(clientX, clientY);
      pointer.down = false;
      pointer.energy = pointerType === 'touch' ? 0 : 0.52;
      if (emitPulse) disturbNormalized(pointer.x, pointer.y, 0.9);
      if (motionQuery.matches) draw();
    }

    function pointerLeave() {
      pointer.down = false;
      pointer.energy = 0;
    }

    function setFocus(value) {
      pointer.focus = value ? 1 : 0;
      if (motionQuery.matches) draw();
    }

    function resize() {
      width = Math.max(1, win.innerWidth);
      height = Math.max(1, win.innerHeight);
      const mobile = width <= 640;
      const scale = Math.min(win.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      if (!ctx || !simulationContext) {
        canvas.style.background = 'radial-gradient(ellipse at 30% 40%, rgba(80,110,140,0.16), transparent 55%), radial-gradient(ellipse at 70% 60%, rgba(130,85,125,0.12), transparent 55%), #05060a';
        setDataset();
        return;
      }
      gridWidth = mobile ? 48 : 96;
      gridHeight = Math.max(36, Math.round(gridWidth * height / width));
      simulationCanvas.width = gridWidth;
      simulationCanvas.height = gridHeight;
      simulationContext = simulationCanvas.getContext('2d', { alpha: false });
      image = simulationContext.createImageData(gridWidth, gridHeight);
      field = new Float32Array(gridWidth * gridHeight * 3);
      const seeds = [
        { x: gridWidth * 0.3, y: gridHeight * 0.44, gamma: 26, hue: 198, lightness: 0.54, radius: 7 },
        { x: gridWidth * 0.66, y: gridHeight * 0.56, gamma: -24, hue: 318, lightness: 0.5, radius: 8 },
        { x: gridWidth * 0.53, y: gridHeight * 0.25, gamma: 18, hue: 226, lightness: 0.5, radius: 6 },
      ];
      vortices = seeds.map((seed) => Object.assign(createVortex(seed.x, seed.y, seed), { persistent: true, life: Infinity, decay: 0 }));
      vortices.forEach((vortex, index) => {
        field = injectColor(field, gridWidth, gridHeight, vortex.x, vortex.y, vortex, 0.2);
        const direction = vortex.gamma >= 0 ? 1 : -1;
        for (let arm = 0; arm < 2; arm++) {
          for (let segment = 0; segment < 28; segment++) {
            const progress = segment / 27;
            const radius = 1.5 + progress * 10;
            const angle = arm * Math.PI + index * 0.7 + direction * progress * 5.2;
            const wisp = Object.assign({}, vortex, {
              hue: vortex.hue + progress * 12,
              radius: 1.8 + progress * 0.8,
            });
            field = injectColor(
              field, gridWidth, gridHeight,
              vortex.x + Math.cos(angle) * radius,
              vortex.y + Math.sin(angle) * radius,
              wisp, 0.44 * (1 - progress * 0.45)
            );
          }
        }
      });
      for (let warmup = 0; warmup < 40; warmup++) {
        field = advectColorField(field, gridWidth, gridHeight, vortices, 0.05, { diffusion: 0.28, fade: 0.012 });
      }
      frameNumber = 0;
      lastStep = 0;
      step(0);
    }

    function frame(now) {
      if (disposed || motionQuery.matches || doc.hidden || mode !== 'canvas-fluid') {
        frameId = 0;
        return;
      }
      frameId = win.requestAnimationFrame(frame);
      const interval = width <= 640 ? 1000 / 24 : 1000 / 30;
      if (now - lastFrame < interval) return;
      const dt = lastStep ? (now - lastStep) / 1000 : 1 / 30;
      lastFrame = now;
      lastStep = now;
      step(dt);
    }

    function start() {
      if (disposed) return;
      win.cancelAnimationFrame(frameId);
      frameId = 0;
      lastFrame = 0;
      lastStep = 0;
      if (motionQuery.matches || doc.hidden || mode !== 'canvas-fluid') draw();
      else frameId = win.requestAnimationFrame(frame);
    }

    function onVisibilityChange() {
      start();
    }

    canvas.dataset.lightRenderer = mode;
    resize();
    start();
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    motionQuery.addEventListener('change', start);

    return {
      mode,
      pointerMove,
      pointerDown,
      pointerUp,
      pointerLeave,
      pulseNormalized,
      disturbNormalized,
      dragNormalized,
      setFocus,
      dispose() {
        if (disposed) return;
        disposed = true;
        win.cancelAnimationFrame(frameId);
        win.removeEventListener('resize', resize);
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        motionQuery.removeEventListener('change', start);
        canvas.dataset.lightRenderer = 'disposed';
        field = null;
        vortices = [];
        image = null;
        ctx = null;
        simulationContext = null;
      },
    };
  }

  return {
    vortexVelocity,
    flowVelocity,
    bilinearColor,
    advectionSample,
    advectColorField,
    createVortex,
    decayVortex,
    decayVortices,
    hslToRgb,
    injectColor,
    createFluidField,
  };
});
