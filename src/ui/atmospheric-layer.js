// Integrated from the supplied MIT-licensed fog module.
const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}
`;

const FRAGMENT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_coverage;
    uniform float u_openings;
    uniform float u_speed;
    uniform float u_turbulence;
    uniform float u_scale;
    uniform float u_shadows;
    uniform float u_direction;
    uniform float u_opacity;

    // Value noise contínuo, estável no tempo, sem textura externa.
    float hash21(vec2 p){
      vec3 p3=fract(vec3(p.xyx)*.1031);
      p3+=dot(p3,p3.yzx+33.33);
      return fract((p3.x+p3.y)*p3.z);
    }
    float noise2(vec2 x){
      vec2 i=floor(x), f=fract(x);
      f=f*f*(3.0-2.0*f);
      float a=hash21(i),b=hash21(i+vec2(1.,0.));
      float c=hash21(i+vec2(0.,1.)),d=hash21(i+vec2(1.,1.));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    float fbm(vec2 p){
      float v=0.,w=.5;
      for(int i=0;i<4;i++){
        v+=noise2(p)*w;
        p=p*2.037+vec2(13.7,9.2);
        w*=.5;
      }
      return v/.9375;
    }
    void main(){
      vec2 uv=v_uv;
      float aspect=u_resolution.x/max(u_resolution.y,1.);
      // ZOOM: números menores tornam os volumes de nuvem maiores.
      float zoom=mix(5.25,2.05,u_scale);
      vec2 p=(uv-.5)*vec2(aspect,1.)*zoom;
      float velocity=.024+.20*u_speed;
      vec2 drift=vec2(u_direction*u_time*velocity, -u_time*.010);

      // Deformação (domain warping) gera dobras, rolos e bordas orgânicas.
      vec2 warp=vec2(
        fbm(p*.72-drift*.51+vec2(3.1,11.9)),
        fbm(p*.71-drift*.49+vec2(22.2,5.8))
      )-.5;
      vec2 q=p+warp*mix(.08,.91,u_turbulence);

      // Nuvens longas, espessas, com detalhes menores no contorno.
      float macro=fbm(q*.83-drift*.83+vec2(8.7,5.1));
      float body=fbm(q*1.75-drift*1.12+vec2(42.2,7.6));
      float wisps=fbm(q*4.2-drift*1.45+vec2(13.2,38.4));
      float volume=macro*.59+body*.31+wisps*.10;
      float fog=smoothstep(mix(.54,.33,u_coverage),mix(.70,.55,u_coverage),volume);

      // Aberturas recortam A MESMA massa de névoa e atravessam todas
      // as camadas. Elas se deslocam, mudam suavemente e nunca piscam.
      float cavities=fbm(q*1.03-drift*.97+vec2(21.3,58.4));
      float openings=smoothstep(
        mix(.77,.50,u_openings),
        mix(.84,.635,u_openings),
        cavities + (body-.5)*.10
      );
      float mask=1.0-openings*.984;
      float softMist=.12+.86*fog;
      float alpha=clamp(softMist*mask,0.,.96);
      // Fios quase invisíveis nas margens tornam a fumaça mais natural.
      alpha*=.93+.07*wisps;

      // Luz da névoa: EXATAMENTE as cores da arte original.
      vec3 ivory=vec3(252.,254.,239.)/255.; // #FCFEEF
      vec3 bodyColor=vec3(229.,233.,205.)/255.; // #E5E9CD
      vec3 warm=vec3(219.,216.,190.)/255.; // #DBD8BE
      vec3 navy=vec3(36.,42.,59.)/255.;   // #242A3B
      float brightness=clamp(.43+(1.-macro)*.39+wisps*.19,0.,1.);
      vec3 color=mix(bodyColor,ivory,brightness);
      color=mix(color,warm,clamp((1.-uv.y)*.14+(body-.5)*.20,0.,.24));
      // A sombra fica concentrada no interior/dobras, como o sprite.
      float underside=smoothstep(.48,.75,macro+(.5-body)*.15);
      float shadow= u_shadows*(.055+.47*underside)*( .72+ .28*(1.-uv.y));
      color=mix(color,navy,shadow);
      // Discreta granulação interna, sem perder a estética suave.
      float grain=(noise2(uv*u_resolution*.23+vec2(u_time*.017,0.))-.5)*.014;
      color=clamp(color+grain,0.,1.);
      gl_FragColor=vec4(color,alpha*u_opacity);
    }
`;

/**
 * Kingdom atmospheric layer · névoa procedural infinita com brechas naturais.
 * @license MIT
 * @version 1.0.0
 * @description ES Module independente de framework, WebGL 1 + fallback Canvas 2D.
 */

export const CLOUD_PALETTE = Object.freeze({
  light: '#FCFEEF',
  body: '#E5E9CD',
  midtone: '#DBD8BE',
  shadow: '#242A3B',
});

export const CLOUD_PRESETS = Object.freeze({
  inside: Object.freeze({ coverage: .76, openings: .62, speed: .35, turbulence: .54, scale: .66, shadows: .50 }),
  open: Object.freeze({ coverage: .67, openings: .89, speed: .41, turbulence: .58, scale: .53, shadows: .35 }),
  dense: Object.freeze({ coverage: .96, openings: .25, speed: .20, turbulence: .35, scale: .76, shadows: .67 }),
});

const SETTING_KEYS = ['coverage', 'openings', 'speed', 'turbulence', 'scale', 'shadows', 'opacity'];
const DEFAULTS = Object.freeze({ ...CLOUD_PRESETS.inside, opacity: 1 });
const clamp01 = n => Math.max(0, Math.min(1, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!this.gl) throw new Error('Contexto WebGL indisponível');
    const gl = this.gl;
    const compile = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s) || 'Falha ao compilar shader';
        gl.deleteShader(s);
        throw new Error(error);
      }
      return s;
    };
    const vert = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    let frag;
    try {
      frag = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    } catch (highPrecisionError) {
      // Alguns dispositivos WebGL 1 não aceitam highp no fragment shader.
      frag = compile(gl.FRAGMENT_SHADER,
        FRAGMENT_SHADER.replace('precision highp float;', 'precision mediump float;'));
    }
    this.program = gl.createProgram();
    gl.attachShader(this.program, vert);
    gl.attachShader(this.program, frag);
    gl.linkProgram(this.program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(this.program);
      gl.deleteProgram(this.program);
      throw new Error(message || 'Falha ao vincular programa WebGL');
    }
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {};
    for (const key of ['resolution', 'time', 'direction', ...SETTING_KEYS]) {
      this.uniforms[key] = gl.getUniformLocation(this.program, `u_${key}`);
    }
    gl.disable(gl.BLEND);
  }

  resize(width, height) {
    this.gl.viewport(0, 0, width, height);
  }

  draw(time, direction, opts) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.time, time);
    gl.uniform1f(this.uniforms.direction, direction);
    for (const key of SETTING_KEYS) gl.uniform1f(this.uniforms[key], opts[key]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  destroy() {
    if (!this.gl.isContextLost()) {
      this.gl.deleteBuffer(this.buffer);
      this.gl.deleteProgram(this.program);
    }
  }
}

/** Fallback sem dependências: resolução dinâmica reduzida com interpolação bilinear. */
class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    if (!this.ctx) throw new Error('Canvas 2D indisponível');
    const doc = canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
    this.small = doc ? doc.createElement('canvas') : new OffscreenCanvas(256, 144);
    this.sc = this.small.getContext('2d');
    this.lastDraw = -1;
  }

  resize(width, height) {
    const source = width / Math.max(height, 1);
    this.small.width = Math.max(40, Math.min(260, Math.round(width / 3.25)));
    this.small.height = Math.max(30, Math.round(this.small.width / Math.max(source, 0.01)));
    this.lastDraw = -1;
  }

  draw(t, direction, opts, force = false) {
    // Recalcular ruído por pixel é custoso; fallback limitado a ~13 fps.
    if (!force && this.lastDraw >= 0 && t - this.lastDraw < .075) return;
    this.lastDraw = t;
    const w = this.small.width, h = this.small.height;
    const im = this.sc.createImageData(w, h);
    const hash = (x, y) => {
      let k = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
      k = Math.imul(k ^ (k >>> 13), 1274126177);
      return ((k ^ (k >>> 16)) >>> 0) / 4294967295;
    };
    const noise = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = smooth(x - ix), fy = smooth(y - iy);
      return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), fx),
        lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
    };
    const fbm = (x, y) => {
      let value = 0, weight = .5;
      for (let k = 0; k < 4; k++) {
        value += noise(x, y) * weight;
        x = x * 2.037 + 13.7;
        y = y * 2.037 + 9.2;
        weight *= .5;
      }
      return value / .9375;
    };
    const zoom = lerp(5.25, 2.05, opts.scale);
    const windX = direction * t * (.024 + .20 * opts.speed);
    const windY = -t * .010;
    const warpForce = lerp(.08, .91, opts.turbulence);
    const c1 = lerp(.54, .33, opts.coverage), c2 = lerp(.70, .55, opts.coverage);
    const o1 = lerp(.77, .50, opts.openings), o2 = lerp(.84, .635, opts.openings);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + .5) / w, v = 1 - (y + .5) / h;
      const px = (u - .5) * (w / h) * zoom, py = (v - .5) * zoom;
      const wx = fbm(px * .72 - windX * .51 + 3.1, py * .72 - windY * .51 + 11.9) - .5;
      const wy = fbm(px * .71 - windX * .49 + 22.2, py * .71 - windY * .49 + 5.8) - .5;
      const qx = px + wx * warpForce, qy = py + wy * warpForce;
      const macro = fbm(qx * .83 - windX * .83 + 8.7, qy * .83 - windY * .83 + 5.1);
      const body = fbm(qx * 1.75 - windX * 1.12 + 42.2, qy * 1.75 - windY * 1.12 + 7.6);
      const wisps = fbm(qx * 4.2 - windX * 1.45 + 13.2, qy * 4.2 - windY * 1.45 + 38.4);
      const volume = macro * .59 + body * .31 + wisps * .10;
      const fog = smooth((volume - c1) / Math.max(c2 - c1, .0001));
      const cavities = fbm(qx * 1.03 - windX * .97 + 21.3, qy * 1.03 - windY * .97 + 58.4);
      const hole = smooth((cavities + (body - .5) * .10 - o1) / Math.max(o2 - o1, .0001));
      const alpha = clamp01(Math.min(.96, (.12 + .86 * fog) * (1 - hole * .984)) * (.93 + .07 * wisps) * opts.opacity);
      const brightness = clamp01(.43 + (1 - macro) * .39 + wisps * .19);
      const warmth = Math.min(.24, Math.max(0, (1 - v) * .14 + (body - .5) * .20));
      const shade = opts.shadows * (.055 + .47 * smooth((macro + (.5 - body) * .15 - .48) / .27)) * (.72 + .28 * (1 - v));
      const colors = [
        lerp(229, 252, brightness), lerp(233, 254, brightness), lerp(205, 239, brightness),
      ];
      const i = 4 * (y * w + x);
      for (let channel = 0; channel < 3; channel++) {
        im.data[i + channel] = lerp(lerp(colors[channel], [219,216,190][channel], warmth), [36,42,59][channel], shade);
      }
      im.data[i + 3] = Math.round(alpha * 255);
    }
    this.sc.putImageData(im, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.small, 0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}

/**
 * Camada de neblina para engines Canvas/WebGL no navegador.
 * Opções visuais em [0,1]. Não há timers ativos com `autoStart:false`.
 */
export class AtmosphericLayer {
  constructor(config = {}) {
    const {
      canvas: providedCanvas, container,
      preset = 'inside', options = {}, direction = 1,
      autoStart = false, autoResize = true, renderer = 'auto',
      pixelRatio = 'auto', maxPixels = 1_000_000,
    } = config;
    if (!['auto', 'webgl', 'canvas2d'].includes(renderer)) {
      throw new RangeError('renderer deve ser auto, webgl ou canvas2d');
    }
    if (providedCanvas && container) throw new Error('Use canvas OU container, não ambos');
    if (!providedCanvas && !container) throw new Error('Informe canvas ou container');
    if (!own(CLOUD_PRESETS, preset)) throw new RangeError(`Preset inválido: ${preset}`);
    if (!Number.isFinite(maxPixels) || maxPixels <= 0) throw new RangeError('maxPixels deve ser positivo');
    if (pixelRatio !== 'auto' && (!Number.isFinite(pixelRatio) || pixelRatio <= 0)) throw new RangeError('pixelRatio inválido');
    this._ownsCanvas = !providedCanvas;
    this.canvas = providedCanvas || (container.ownerDocument || document).createElement('canvas');
    if (!this.canvas || typeof this.canvas.getContext !== 'function') throw new TypeError('canvas inválido');
    if (container) {
      this.canvas.className = 'kingdom-atmosphere-layer';
      Object.assign(this.canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        display: 'block', pointerEvents: 'none',
      });
      container.appendChild(this.canvas);
    }
    this.options = { ...DEFAULTS };
    this._applyOptions(CLOUD_PRESETS[preset]);
    this._applyOptions(options);
    this.direction = (direction === -1 || direction === 'left') ? -1 : 1;
    this.time = 0;
    this.isRunning = false;
    this.rendererType = '';
    this._destroyed = false;
    this._lost = false;
    this._rafId = 0;
    this._pixelRatio = pixelRatio;
    this._maxPixels = maxPixels;
    this._lastFrame = 0;
    this._canvasCSSSize = null;
    this._onContextLost = (event) => {
      event.preventDefault();
      this._lost = true;
    };
    this._onContextRestored = () => {
      this._lost = false;
      this._renderer = new WebGLRenderer(this.canvas);
      this.resize();
      this.render();
    };
    try {
      if (renderer === 'canvas2d') this._renderer = new Canvas2DRenderer(this.canvas);
      else if (renderer === 'webgl') this._renderer = new WebGLRenderer(this.canvas);
      else {
        // Se WebGL não puder ser obtido, o contexto 2D ainda estará livre.
        const available = this.canvas.getContext('webgl', {
          alpha: true, antialias: false, depth: false, stencil: false,
          premultipliedAlpha: false, preserveDrawingBuffer: true,
          powerPreference: 'low-power',
        });
        this._renderer = available ? new WebGLRenderer(this.canvas) : new Canvas2DRenderer(this.canvas);
      }
    } catch (err) {
      if (this._ownsCanvas) this.canvas.remove();
      throw err;
    }
    this.rendererType = this._renderer instanceof WebGLRenderer ? 'webgl' : 'canvas2d';
    if (this.rendererType === 'webgl' && this.canvas.addEventListener) {
      this.canvas.addEventListener('webglcontextlost', this._onContextLost);
      this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);
    }
    this._renderer.resize(this.canvas.width, this.canvas.height);
    this.resize();
    if (autoResize && typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => { if (!this._destroyed) this.resize(); });
      this._observer.observe(container || this.canvas);
    } else if (autoResize && typeof window !== 'undefined') {
      this._onWindowResize = () => this.resize();
      window.addEventListener('resize', this._onWindowResize);
    }
    this.render();
    if (autoStart) this.start();
  }

  _assertAlive() {
    if (this._destroyed) throw new Error('Camada atmosférica já foi destruída');
  }
  _applyOptions(changes) {
    for (const [key, raw] of Object.entries(changes)) {
      if (!SETTING_KEYS.includes(key)) throw new RangeError(`Parâmetro desconhecido: ${key}`);
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
        throw new RangeError(`${key} deve estar entre 0 e 1`);
      }
      this.options[key] = raw;
    }
  }

  setOptions(changes) {
    this._assertAlive();
    this._applyOptions(changes);
    this.render();
    return this;
  }

  setPreset(preset) {
    this._assertAlive();
    if (!own(CLOUD_PRESETS, preset)) throw new RangeError(`Preset inválido: ${preset}`);
    // Mantém opacidade personalizada ao trocar predefinição.
    return this.setOptions(CLOUD_PRESETS[preset]);
  }

  setDirection(direction) {
    this._assertAlive();
    if (![1, -1, 'left', 'right'].includes(direction)) {
      throw new RangeError('Direção aceita: left/right ou -1/1');
    }
    this.direction = (direction === 'left' || direction === -1) ? -1 : 1;
    this.render();
    return this;
  }

  /** Ajusta o canvas a seu tamanho CSS (DPR limitado por maxPixels). */
  resize(width, height) {
    this._assertAlive();
    if (width !== undefined || height !== undefined) {
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new RangeError('Informe largura e altura positivas');
      }
      // Somente quando explicitamente especificado; CSS continua a cargo do jogo.
      this._canvasCSSSize = { width, height };
    }
    const rect = !this._canvasCSSSize && this.canvas.getBoundingClientRect
      ? this.canvas.getBoundingClientRect() : null;
    const w = this._canvasCSSSize?.width || rect?.width || this.canvas.clientWidth || this.canvas.width || 1;
    const h = this._canvasCSSSize?.height || rect?.height || this.canvas.clientHeight || this.canvas.height || 1;
    const nativeDPR = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const desired = this._pixelRatio === 'auto' ? Math.min(1.5, nativeDPR) : this._pixelRatio;
    const ratio = Math.min(desired, Math.sqrt(this._maxPixels / Math.max(1, w * h)));
    const pw = Math.max(1, Math.round(w * ratio)), ph = Math.max(1, Math.round(h * ratio));
    if (pw !== this.canvas.width || ph !== this.canvas.height) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this._renderer.resize(pw, ph);
      this.render();
    } else if (this._canvasCSSSize && this._renderer) {
      this._renderer.resize(pw, ph);
    }
    return this;
  }

  /** Atualiza em segundos; ideal para o loop já existente no jogo. */
  update(deltaSeconds) {
    this._assertAlive();
    if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds deve ser um número >= 0');
    }
    // Evita saltos quando a aba retorna do segundo plano.
    this.time += Math.min(deltaSeconds, .1);
    this.render(false);
    return this;
  }

  /** Redesenha sem avançar o tempo (útil após trocar parâmetros). */
  render(force = true) {
    this._assertAlive();
    if (this._lost) return this;
    this._renderer.draw(this.time, this.direction, this.options, force);
    return this;
  }

  /** Loop opcional próprio: NÃO usar simultaneamente com update() do jogo. */
  start() {
    this._assertAlive();
    if (this.isRunning) return this;
    if (typeof requestAnimationFrame !== 'function') throw new Error('requestAnimationFrame indisponível; use update(dt)');
    this.isRunning = true;
    this._lastFrame = 0;
    const frame = timestamp => {
      if (!this.isRunning || this._destroyed) return;
      const dt = this._lastFrame ? Math.min(.1, (timestamp - this._lastFrame) / 1000) : 0;
      this._lastFrame = timestamp;
      this.update(dt);
      this._rafId = requestAnimationFrame(frame);
    };
    this._rafId = requestAnimationFrame(frame);
    return this;
  }

  stop() {
    this._assertAlive();
    this.isRunning = false;
    if (typeof cancelAnimationFrame === 'function' && this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    this._lastFrame = 0;
    return this;
  }

  pause() { return this.stop(); }
  resume() { return this.start(); }

  /** Devolve PNG com transparência; não pausa o efeito. */
  async toBlob() {
    this._assertAlive();
    this.render();
    if (typeof this.canvas.convertToBlob === 'function') return this.canvas.convertToBlob({ type: 'image/png' });
    if (typeof this.canvas.toBlob !== 'function') throw new Error('Este canvas não pode exportar PNG');
    return new Promise((resolve, reject) => this.canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('Falha ao exportar PNG'));
    }, 'image/png'));
  }

  destroy() {
    if (this._destroyed) return;
    this.stop();
    this._observer?.disconnect();
    if (this._onWindowResize) window.removeEventListener('resize', this._onWindowResize);
    if (this.rendererType === 'webgl' && this.canvas.removeEventListener) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    }
    this._renderer.destroy();
    if (this._ownsCanvas) this.canvas.remove();
    this._destroyed = true;
  }
}

export function createAtmosphericLayer(config) { return new AtmosphericLayer(config); }
export default AtmosphericLayer;
