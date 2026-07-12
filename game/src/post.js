// Post-processing: rendert de scene naar een buffer en voegt FXAA (randverzachting),
// bloom (zachte gloed rond felle plekken), vignet en lichte verzadiging toe.
// Werkt zonder de three.js 'examples' — eigen fullscreen-passes.
window.Post = (function () {
  const P = {};
  let renderer, scene, camera;
  let rtScene, rtBrightA, rtBrightB;
  let fsScene, fsCam, quad;
  let brightMat, blurMat, compMat;
  const size = new THREE.Vector2();

  P.enabled = true;
  P.bloom = true;
  P.vignette = true;
  P.godrays = true;
  P.bloomStrength = 0.55;
  P.godStrength = 0.8;
  const sunUV = new THREE.Vector2(0.5, 0.5);
  let sunVisible = false;
  let godMat;
  P.setSun = function (x, y, visible) { sunUV.set(x, y); sunVisible = visible; };

  const FXAA = `
    vec3 fxaa(sampler2D tex, vec2 uv, vec2 res) {
      vec2 inv = 1.0 / res;
      const float SPAN = 8.0, RMUL = 1.0/8.0, RMIN = 1.0/128.0;
      vec3 luma = vec3(0.299, 0.587, 0.114);
      vec3 nw = texture2D(tex, uv + vec2(-1.0,-1.0)*inv).rgb;
      vec3 ne = texture2D(tex, uv + vec2( 1.0,-1.0)*inv).rgb;
      vec3 sw = texture2D(tex, uv + vec2(-1.0, 1.0)*inv).rgb;
      vec3 se = texture2D(tex, uv + vec2( 1.0, 1.0)*inv).rgb;
      vec3 m  = texture2D(tex, uv).rgb;
      float lnw=dot(nw,luma), lne=dot(ne,luma), lsw=dot(sw,luma), lse=dot(se,luma), lm=dot(m,luma);
      float lmin=min(lm,min(min(lnw,lne),min(lsw,lse)));
      float lmax=max(lm,max(max(lnw,lne),max(lsw,lse)));
      vec2 dir = vec2(-((lnw+lne)-(lsw+lse)), ((lnw+lsw)-(lne+lse)));
      float red = max((lnw+lne+lsw+lse)*0.25*RMUL, RMIN);
      float rcp = 1.0 / (min(abs(dir.x),abs(dir.y)) + red);
      dir = clamp(dir*rcp, -SPAN, SPAN) * inv;
      vec3 rA = 0.5*(texture2D(tex,uv+dir*(1.0/3.0-0.5)).rgb + texture2D(tex,uv+dir*(2.0/3.0-0.5)).rgb);
      vec3 rB = rA*0.5 + 0.25*(texture2D(tex,uv+dir*-0.5).rgb + texture2D(tex,uv+dir*0.5).rgb);
      float lb = dot(rB,luma);
      return (lb<lmin||lb>lmax) ? rA : rB;
    }`;

  const VERT = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  function makeTargets() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
    const opt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType };
    if (rtScene) rtScene.dispose();
    rtScene = new THREE.WebGLRenderTarget(w, h, Object.assign({ depthBuffer: true, stencilBuffer: false }, opt));
    // MSAA op de scene-buffer (WebGL2)
    if ('samples' in rtScene) rtScene.samples = 4;
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    if (rtBrightA) rtBrightA.dispose();
    if (rtBrightB) rtBrightB.dispose();
    rtBrightA = new THREE.WebGLRenderTarget(bw, bh, opt);
    rtBrightB = new THREE.WebGLRenderTarget(bw, bh, opt);
  }

  P.init = function (theRenderer, theScene, theCamera) {
    renderer = theRenderer; scene = theScene; camera = theCamera;
    fsScene = new THREE.Scene();
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    fsScene.add(quad);

    brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: 0.80 } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.299,0.587,0.114));
          float k = max(0.0, l - threshold) / max(l, 1e-4);
          gl_FragColor = vec4(c * k * smoothstep(0.0,0.3,l), 1.0);
        }`,
    });

    blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
        void main(){
          vec3 s = vec3(0.0);
          s += texture2D(tDiffuse, vUv + dir*-4.0).rgb * 0.051;
          s += texture2D(tDiffuse, vUv + dir*-3.0).rgb * 0.092;
          s += texture2D(tDiffuse, vUv + dir*-2.0).rgb * 0.124;
          s += texture2D(tDiffuse, vUv + dir*-1.0).rgb * 0.152;
          s += texture2D(tDiffuse, vUv).rgb            * 0.162;
          s += texture2D(tDiffuse, vUv + dir* 1.0).rgb * 0.152;
          s += texture2D(tDiffuse, vUv + dir* 2.0).rgb * 0.124;
          s += texture2D(tDiffuse, vUv + dir* 3.0).rgb * 0.092;
          s += texture2D(tDiffuse, vUv + dir* 4.0).rgb * 0.051;
          gl_FragColor = vec4(s, 1.0);
        }`,
    });

    // zonnestralen (radiaal uitvegen van de felle plekken naar de zon toe)
    godMat = new THREE.ShaderMaterial({
      uniforms: { tBright: { value: null }, sunUV: { value: sunUV }, aspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tBright; uniform vec2 sunUV; uniform float aspect; varying vec2 vUv;
        void main(){
          const int STEPS = 28;
          float density = 0.85, decay = 0.95, weight = 0.5;
          vec2 delta = (vUv - sunUV) * (density / float(STEPS));
          vec2 c = vUv;
          vec3 col = vec3(0.0);
          float illum = 1.0;
          for (int i = 0; i < STEPS; i++) {
            c -= delta;
            vec3 s = texture2D(tBright, c).rgb;
            col += s * illum * weight;
            illum *= decay;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null }, tGod: { value: null },
        res: { value: new THREE.Vector2() }, sunUV: { value: sunUV },
        bloomStr: { value: 0.65 }, godStr: { value: 0.0 }, vig: { value: 0.9 }, sat: { value: 1.08 }, fxaaOn: { value: 1 }, flare: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse, tBloom, tGod; uniform vec2 res, sunUV;
        uniform float bloomStr, godStr, vig, sat, fxaaOn, flare; varying vec2 vUv;
        ${FXAA}
        float ghost(vec2 uv, vec2 p, float r, float aspect){
          vec2 d = uv - p; d.x *= aspect;
          return smoothstep(r, 0.0, length(d));
        }
        void main(){
          vec3 base = fxaaOn > 0.5 ? fxaa(tDiffuse, vUv, res) : texture2D(tDiffuse, vUv).rgb;
          vec3 bloom = texture2D(tBloom, vUv).rgb;
          vec3 god = texture2D(tGod, vUv).rgb;
          vec3 c = base + bloom * bloomStr + god * godStr * vec3(1.0, 0.92, 0.78);

          // lensflare: enkele spookjes op de lijn zon → schermmidden
          if (flare > 0.5) {
            float occ = smoothstep(0.05, 0.3, texture2D(tBloom, sunUV).r);
            float aspect = res.x / res.y;
            vec2 toC = vec2(0.5) - sunUV;
            float g = ghost(vUv, sunUV + toC * 0.30, 0.05, aspect) * 0.5;
            g += ghost(vUv, sunUV + toC * 0.55, 0.09, aspect) * 0.3;
            g += ghost(vUv, sunUV + toC * 0.80, 0.03, aspect) * 0.6;
            g += ghost(vUv, sunUV + toC * 1.35, 0.14, aspect) * 0.18;
            c += vec3(1.0, 0.88, 0.66) * g * occ * 0.6;
          }

          float l = dot(c, vec3(0.299,0.587,0.114));
          c = mix(vec3(l), c, sat);              // lichte verzadiging
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * vig;            // vignet
          gl_FragColor = vec4(c, 1.0);
        }`,
    });

    makeTargets();
  };

  P.resize = function () { if (renderer) makeTargets(); };

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  }

  P.render = function () {
    if (!P.enabled) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    // 1. scene naar buffer (met MSAA)
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    const doGod = P.godrays && sunVisible;
    const needBright = P.bloom || doGod;

    // 2. felle plekken isoleren + blurren (voor bloom en/of zonnestralen)
    if (needBright) {
      brightMat.uniforms.tDiffuse.value = rtScene.texture;
      pass(brightMat, rtBrightA);
      const bw = rtBrightA.width, bh = rtBrightA.height;
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tDiffuse.value = rtBrightA.texture;
        blurMat.uniforms.dir.value.set(1.4 / bw, 0);
        pass(blurMat, rtBrightB);
        blurMat.uniforms.tDiffuse.value = rtBrightB.texture;
        blurMat.uniforms.dir.value.set(0, 1.4 / bh);
        pass(blurMat, rtBrightA);
      }
    }

    // 3. zonnestralen (radiaal uitvegen naar de zon)
    if (doGod) {
      godMat.uniforms.tBright.value = rtBrightA.texture;
      pass(godMat, rtBrightB);   // resultaat in rtBrightB
    }

    // 4. compositie naar scherm
    compMat.uniforms.tDiffuse.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtBrightA.texture;
    compMat.uniforms.tGod.value = rtBrightB.texture;
    compMat.uniforms.res.value.set(rtScene.width, rtScene.height);
    compMat.uniforms.bloomStr.value = P.bloom ? P.bloomStrength : 0.0;
    compMat.uniforms.godStr.value = doGod ? P.godStrength : 0.0;
    compMat.uniforms.vig.value = P.vignette ? 0.72 : 0.0;
    compMat.uniforms.flare.value = (P.bloom && sunVisible) ? 1 : 0;
    quad.material = compMat;
    renderer.setRenderTarget(null);
    renderer.render(fsScene, fsCam);
  };

  return P;
})();
