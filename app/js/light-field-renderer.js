(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function sceneEnvelope(time, response, release) {
    const phase = ((Number(time) % 24) + 24) % 24;
    let base = 0.56;
    if (phase >= 6 && phase < 16) base += Math.sin(((phase - 6) / 10) * Math.PI) * 0.16;
    else if (phase >= 16) base += Math.sin(((phase - 16) / 8) * Math.PI) * 0.05;
    const answering = clamp01(response);
    const releasing = clamp01(release);
    const stage = releasing > 0.08 ? 'release' : answering > 0.08 ? 'respond' : phase < 6 ? 'quiet' : 'breathe';
    return { stage, intensity: base + answering * 0.12 + releasing * 0.08 };
  }

  function springStep(current, target, velocity, deltaTime, stiffness, damping) {
    const dt = Math.max(0, Math.min(0.05, Number(deltaTime) || 0));
    const force = (target - current) * (stiffness || 58) - velocity * (damping || 15);
    const nextVelocity = velocity + force * dt;
    return { value: current + nextVelocity * dt, velocity: nextVelocity };
  }

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  /*
   * Noise/FBM/domain-warp approach adapted from leisurelyleon/aurora.
   * Copyright (c) 2026 Joseph Edwards. MIT License.
   * See licenses/aurora-MIT.txt for the complete license and attribution.
   * Silver aurora, spatial layers and interactions are project-specific.
   */
  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_pointer;
    uniform float u_pointerEnergy;
    uniform float u_pointerDown;
    uniform vec2 u_click;
    uniform float u_clickAge;
    uniform float u_clickStrength;
    uniform float u_sceneIntensity;
    uniform float u_focus;
    uniform vec4 u_spots[10];
    uniform float u_spotTint[10];
    uniform int u_spotCount;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise21(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float sum = 0.0;
      float amplitude = 0.52;
      mat2 turn = mat2(0.82, -0.57, 0.57, 0.82);
      for (int i = 0; i < 5; i++) {
        sum += amplitude * noise21(p);
        p = turn * p * 2.03 + vec2(13.7, 9.2);
        amplitude *= 0.5;
      }
      return sum;
    }

    float ridgedNoise(vec2 p) {
      return 1.0 - abs(noise21(p) * 2.0 - 1.0);
    }

    vec2 warpDomain(vec2 p, float t, out vec2 q) {
      q = vec2(
        fbm(p + vec2(t * 0.72, -t * 0.41)),
        fbm(p + vec2(5.2, 1.3) + vec2(-t * 0.37, t * 0.54))
      );
      return vec2(
        fbm(p + 2.15 * q + vec2(1.7, 9.2) + vec2(t * 0.31, t * 0.18)),
        fbm(p + 2.15 * q + vec2(8.3, 2.8) + vec2(-t * 0.23, t * 0.27))
      );
    }

    mat2 rotate2d(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    float segmentDistance(vec2 point, vec2 first, vec2 second) {
      vec2 pa = point - first;
      vec2 ba = second - first;
      float amount = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      return length(pa - ba * amount);
    }

    float silverAurora(vec2 uv, vec2 p, vec2 q, vec2 warp, float t) {
      float axis = uv.y + uv.x * 0.16;
      float spine = 0.5 + (q.x - 0.5) * 0.42 + (warp.y - 0.5) * 0.24;
      float distanceToVeil = (axis - spine) * 4.2;
      float veil = exp(-distanceToVeil * distanceToVeil);
      float bodyNoise = fbm(vec2(p.x * 2.3 + warp.x * 0.9 + t * 0.025, p.y * 0.65 + q.y * 0.6));
      float filamentNoise = fbm(vec2((p.x + warp.x * 0.28) * 7.0, (p.y + q.y * 0.2) * 1.2));
      float body = veil * smoothstep(0.18, 0.78, bodyNoise) * (0.55 + filamentNoise * 0.45);
      float secondDistance = (axis - spine - 0.16 - (q.y - 0.5) * 0.15) * 7.5;
      float wisps = exp(-secondDistance * secondDistance) * smoothstep(0.28, 0.82, filamentNoise) * 0.42;
      return body + wisps;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / u_resolution.y;
      float t = u_time * 0.12;
      vec2 p = vec2((uv.x - 0.5) * aspect * 1.35, uv.y * 1.8);
      vec2 q;
      vec2 warp = warpDomain(p * 1.15, t * 0.12, q);
      float aurora = silverAurora(uv, p, q, warp, t);
      vec2 pointerDelta = uv - u_pointer;
      pointerDelta.x *= aspect;
      float pointerLocal = exp(-dot(pointerDelta, pointerDelta) * 18.0) * (u_pointerEnergy + u_pointerDown * 1.35);
      vec3 color = vec3(0.027, 0.029, 0.033);
      color += vec3(0.78, 0.80, 0.83) * aurora * 0.2 * (0.85 + u_sceneIntensity * 0.18);
      color += vec3(0.91, 0.92, 0.93) * aurora * aurora * 0.055;
      color += vec3(0.8, 0.82, 0.85) * pointerLocal * 0.018;

      for (int i = 0; i < 10; i++) {
        if (i >= u_spotCount) break;
        vec2 delta = uv - u_spots[i].xy;
        delta.x *= aspect;
        float radius = max(0.001, u_spots[i].z / min(u_resolution.x, u_resolution.y));
        float distanceToSpot = length(delta) / radius;
        float glow = exp(-distanceToSpot * distanceToSpot * 3.5) * (1.0 - smoothstep(0.4, 2.3, distanceToSpot));
        float haloWide = exp(-distanceToSpot * distanceToSpot * 1.25) * (1.0 - smoothstep(0.65, 2.6, distanceToSpot));
        vec3 spotColor = mix(vec3(0.7, 0.72, 0.75), vec3(0.84, 0.85, 0.87), u_spotTint[i]);
        color += spotColor * (glow * 0.4 + haloWide * 0.24) * u_spots[i].w;
      }

      color *= 1.0 - u_focus * 0.1;
      vec2 clickDelta = uv - u_click;
      clickDelta.x *= aspect;
      float clickDistance = length(clickDelta);
      float clickRing = exp(-pow((clickDistance - u_clickAge * 0.16) * 24.0, 2.0))
        * exp(-u_clickAge * 1.7) * u_clickStrength;
      color += vec3(0.8, 0.82, 0.85) * clickRing * 0.04;
      gl_FragColor = vec4(min(color, vec3(0.995)), 1.0);
    }
  `;

  const CSS_FALLBACK = 'radial-gradient(ellipse at 24% 32%, rgba(222,226,231,0.18) 0, transparent 42%), radial-gradient(ellipse at 72% 58%, rgba(235,236,238,0.12) 0, transparent 46%), radial-gradient(ellipse at 48% 82%, rgba(200,205,211,0.08) 0, transparent 38%), #07080a';

  function createColorField(canvas, motionQuery, options) {
    const env = options || {};
    const win = env.window || window;
    const doc = env.document || document;
    const attributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    };
    let gl = null;
    let ctx2d = null;
    let program = null;
    let buffer = null;
    let vertexShader = null;
    let fragmentShader = null;
    let resolutionUniform = null;
    let timeUniform = null;
    let pointerUniform = null;
    let pointerEnergyUniform = null;
    let pointerDownUniform = null;
    let clickUniform = null;
    let clickAgeUniform = null;
    let clickStrengthUniform = null;
    let sceneIntensityUniform = null;
    let focusUniform = null;
    let spotsUniform = null;
    let spotTintUniform = null;
    let spotCountUniform = null;
    let lightSpots = [];
    let mode = 'css';
    let width = 1;
    let height = 1;
    let frameId = 0;
    let lastFrame = 0;
    let disposed = false;
    const interaction = {
      x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, vx: 0, vy: 0,
      energy: 0, energyVelocity: 0, targetEnergy: 0,
      down: 0, downVelocity: 0, downAt: 0, pressing: false,
      focus: 0, focusVelocity: 0, targetFocus: 0, lastUpdate: 0,
      clickX: 0.5, clickY: 0.5, clickAt: -100000, clickStrength: 0,
    };

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function deleteResources() {
      if (!gl) return;
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      buffer = null;
      program = null;
      vertexShader = null;
      fragmentShader = null;
    }

    function initialiseWebGL() {
      try {
        gl = canvas.getContext('webgl2', attributes) || canvas.getContext('webgl', attributes) || canvas.getContext('experimental-webgl', attributes);
        if (!gl) return false;
        vertexShader = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        fragmentShader = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        if (!vertexShader || !fragmentShader) {
          deleteResources();
          return false;
        }
        program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          deleteResources();
          return false;
        }
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
        timeUniform = gl.getUniformLocation(program, 'u_time');
        pointerUniform = gl.getUniformLocation(program, 'u_pointer');
        pointerEnergyUniform = gl.getUniformLocation(program, 'u_pointerEnergy');
        pointerDownUniform = gl.getUniformLocation(program, 'u_pointerDown');
        clickUniform = gl.getUniformLocation(program, 'u_click');
        clickAgeUniform = gl.getUniformLocation(program, 'u_clickAge');
        clickStrengthUniform = gl.getUniformLocation(program, 'u_clickStrength');
        sceneIntensityUniform = gl.getUniformLocation(program, 'u_sceneIntensity');
        focusUniform = gl.getUniformLocation(program, 'u_focus');
        spotsUniform = gl.getUniformLocation(program, 'u_spots[0]');
        spotTintUniform = gl.getUniformLocation(program, 'u_spotTint[0]');
        spotCountUniform = gl.getUniformLocation(program, 'u_spotCount');
        return true;
      } catch (error) {
        deleteResources();
        return false;
      }
    }

    function drawCanvas() {
      if (!ctx2d) return;
      const base = ctx2d.createLinearGradient(0, 0, width, height);
      base.addColorStop(0, '#07080a');
      base.addColorStop(0.5, '#07080a');
      base.addColorStop(1, '#07080a');
      ctx2d.fillStyle = base;
      ctx2d.fillRect(0, 0, width, height);
      const glows = [
        [width * 0.24, height * 0.32, Math.max(width, height) * 0.34, 'rgba(222,226,231,0.18)'],
        [width * 0.72, height * 0.58, Math.max(width, height) * 0.38, 'rgba(235,236,238,0.12)'],
        [width * 0.48, height * 0.82, Math.max(width, height) * 0.3, 'rgba(200,205,211,0.08)'],
      ];
      glows.forEach((glow) => {
        const gradient = ctx2d.createRadialGradient(glow[0], glow[1], 0, glow[0], glow[1], glow[2]);
        gradient.addColorStop(0, glow[3]);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx2d.fillStyle = gradient;
        ctx2d.fillRect(0, 0, width, height);
      });
    }

    function updateInteraction(now) {
      const dt = interaction.lastUpdate ? Math.min(0.05, (now - interaction.lastUpdate) / 1000) : 1 / 60;
      interaction.lastUpdate = now;
      const downTarget = interaction.pressing ? Math.min(1, (now - interaction.downAt) / 650) : 0;
      if (motionQuery.matches) {
        interaction.x = interaction.targetX;
        interaction.y = interaction.targetY;
        interaction.energy = interaction.targetEnergy;
        interaction.down = downTarget;
        interaction.focus = interaction.targetFocus;
        interaction.vx = 0;
        interaction.vy = 0;
        interaction.energyVelocity = 0;
        interaction.downVelocity = 0;
        interaction.focusVelocity = 0;
        return;
      }
      const horizontal = springStep(interaction.x, interaction.targetX, interaction.vx, dt, 58, 15);
      const vertical = springStep(interaction.y, interaction.targetY, interaction.vy, dt, 58, 15);
      const energy = springStep(interaction.energy, interaction.targetEnergy, interaction.energyVelocity, dt, 52, 14);
      const down = springStep(interaction.down, downTarget, interaction.downVelocity, dt, 72, 17);
      const focus = springStep(interaction.focus, interaction.targetFocus, interaction.focusVelocity, dt, 46, 14);
      interaction.x = horizontal.value;
      interaction.vx = horizontal.velocity;
      interaction.y = vertical.value;
      interaction.vy = vertical.velocity;
      interaction.energy = energy.value;
      interaction.energyVelocity = energy.velocity;
      interaction.down = down.value;
      interaction.downVelocity = down.velocity;
      interaction.focus = focus.value;
      interaction.focusVelocity = focus.velocity;
    }

    function draw(timeSeconds) {
      if (disposed) return;
      updateInteraction(performance.now());
      if (mode === 'webgl' && gl && program) {
        const clickAge = Math.max(0, (performance.now() - interaction.clickAt) / 1000);
        const release = Math.exp(-clickAge * 1.7) * interaction.clickStrength;
        const envelope = sceneEnvelope(timeSeconds, interaction.down, release);
        if (root.SJ && root.SJ.lightFieldSpots) {
          const samples = root.SJ.lightFieldSpots.sampleSpots(lightSpots, timeSeconds, { width, height }, motionQuery.matches);
          const values = new Float32Array(40);
          const tints = new Float32Array(10);
          samples.forEach((spot, index) => {
            values[index * 4] = spot.x;
            values[index * 4 + 1] = spot.y;
            values[index * 4 + 2] = spot.radius;
            values[index * 4 + 3] = spot.alpha;
            tints[index] = spot.tint;
          });
          gl.uniform4fv(spotsUniform, values);
          gl.uniform1fv(spotTintUniform, tints);
          gl.uniform1i(spotCountUniform, samples.length);
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
        gl.uniform1f(timeUniform, timeSeconds);
        gl.uniform2f(pointerUniform, interaction.x, interaction.y);
        gl.uniform1f(pointerEnergyUniform, interaction.energy);
        gl.uniform1f(pointerDownUniform, interaction.down);
        gl.uniform2f(clickUniform, interaction.clickX, interaction.clickY);
        gl.uniform1f(clickAgeUniform, clickAge);
        gl.uniform1f(clickStrengthUniform, interaction.clickStrength);
        gl.uniform1f(sceneIntensityUniform, envelope.intensity);
        gl.uniform1f(focusUniform, interaction.focus);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (mode === 'canvas') {
        drawCanvas();
      }
    }

    function setPosition(clientX, clientY) {
      const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width, height };
      interaction.targetX = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      interaction.targetY = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
    }

    function drawStaticInteraction() {
      if (motionQuery.matches) draw(12);
    }

    function pointerMove(clientX, clientY, pointerType) {
      setPosition(clientX, clientY);
      interaction.targetEnergy = pointerType === 'touch' ? 0.9 : 0.52;
      drawStaticInteraction();
    }

    function pointerDown(clientX, clientY) {
      setPosition(clientX, clientY);
      interaction.targetEnergy = 1;
      interaction.downAt = performance.now();
      interaction.pressing = true;
      drawStaticInteraction();
    }

    function pulseNormalized(x, y, strength) {
      interaction.clickX = Math.max(0, Math.min(1, x));
      interaction.clickY = 1 - Math.max(0, Math.min(1, y));
      interaction.clickAt = performance.now();
      interaction.clickStrength = strength == null ? 1 : strength;
      drawStaticInteraction();
    }

    function pointerUp(clientX, clientY, emitPulse, pointerType) {
      setPosition(clientX, clientY);
      interaction.pressing = false;
      interaction.targetEnergy = pointerType === 'touch' ? 0 : 0.52;
      const pulseX = interaction.targetX;
      const pulseY = 1 - interaction.targetY;
      if (pointerType === 'touch') {
        interaction.targetX = 0.5;
        interaction.targetY = 0.5;
      }
      if (emitPulse) pulseNormalized(pulseX, pulseY, 0.9);
      drawStaticInteraction();
    }

    function pointerLeave() {
      interaction.pressing = false;
      interaction.targetEnergy = 0;
      interaction.targetX = 0.5;
      interaction.targetY = 0.5;
      drawStaticInteraction();
    }

    function setFocus(value) {
      interaction.targetFocus = value ? 1 : 0;
      drawStaticInteraction();
    }

    function resize() {
      width = Math.max(1, win.innerWidth);
      height = Math.max(1, win.innerHeight);
      const mobile = width <= 640;
      const dprCap = mobile ? 1.25 : 1.5;
      const pixelBudget = mobile ? 480000 : 1250000;
      const budgetScale = Math.sqrt(pixelBudget / (width * height));
      const scale = Math.max(0.35, Math.min(win.devicePixelRatio || 1, dprCap, budgetScale));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      if (!lightSpots.length && root.SJ && root.SJ.lightFieldSpots) {
        lightSpots = root.SJ.lightFieldSpots.createLightSpots(mobile ? 2 : 3, 43);
      }
      draw(motionQuery.matches ? 12 : performance.now() / 1000);
    }

    function frame(now) {
      if (disposed || motionQuery.matches || doc.hidden || mode !== 'webgl') {
        frameId = 0;
        return;
      }
      frameId = win.requestAnimationFrame(frame);
      const interval = width <= 640 ? 1000 / 24 : 1000 / 30;
      if (now - lastFrame < interval) return;
      lastFrame = now;
      draw(now / 1000);
    }

    function start() {
      if (disposed) return;
      win.cancelAnimationFrame(frameId);
      frameId = 0;
      lastFrame = 0;
      if (motionQuery.matches || doc.hidden || mode !== 'webgl') draw(12);
      else frameId = win.requestAnimationFrame(frame);
    }

    function onVisibilityChange() {
      start();
    }

    function onContextLost(event) {
      event.preventDefault();
      win.cancelAnimationFrame(frameId);
      frameId = 0;
      mode = 'css';
      canvas.dataset.lightRenderer = mode;
      canvas.style.background = CSS_FALLBACK;
    }

    if (initialiseWebGL()) {
      mode = 'webgl';
    } else {
      try { ctx2d = canvas.getContext('2d', { alpha: false }); } catch (error) { ctx2d = null; }
      mode = ctx2d ? 'canvas' : 'css';
      if (!ctx2d) canvas.style.background = CSS_FALLBACK;
    }
    canvas.dataset.lightRenderer = mode;
    resize();
    start();
    win.addEventListener('resize', resize);
    doc.addEventListener('visibilitychange', onVisibilityChange);
    motionQuery.addEventListener('change', start);
    canvas.addEventListener('webglcontextlost', onContextLost);

    return {
      mode,
      pointerMove,
      pointerDown,
      pointerUp,
      pointerLeave,
      pulseNormalized,
      setFocus,
      dispose() {
        if (disposed) return;
        disposed = true;
        win.cancelAnimationFrame(frameId);
        win.removeEventListener('resize', resize);
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        motionQuery.removeEventListener('change', start);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        deleteResources();
        if (gl) {
          const loseContext = gl.getExtension('WEBGL_lose_context');
          if (loseContext) loseContext.loseContext();
        }
        gl = null;
        ctx2d = null;
      },
    };
  }

  return { VERTEX_SHADER, FRAGMENT_SHADER, sceneEnvelope, springStep, createColorField };
});
