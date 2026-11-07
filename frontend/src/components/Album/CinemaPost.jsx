'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { cinema } from '@/lib/ambient/cinema';

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Depth of field, the way a long lens renders a room: the book is sharp, and things soften
 * with their distance in front of it or behind it.
 *
 * It takes two steps. The first works out each pixel's blur from its depth and stores it
 * in alpha. The second spirals out over a disc, and a sharp foreground keeps background blur
 * from smearing across its edges. It's split this way on purpose: with the depth maths
 * inside the sampling loop, this one shader took over a minute to compile on Windows, and
 * froze the page while it did. Keep that loop free of function calls and depth reads.
 *
 * This pass is switched off entirely while a book lies open. Open pages can't be softened
 * by any setting here, which is how photographs stay exactly as sharp as they were.
 */
class DepthOfFieldPass extends Pass {
  constructor(samples) {
    super();
    this.blurAmount = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uNear: { value: 1 },
        uFar: { value: 100 },
        uFocus: { value: 20 },
        uSharp: { value: 2 },
        uRange: { value: 6 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform float uNear, uFar, uFocus, uSharp, uRange;
        void main() {
          float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
          gl_FragColor = vec4(texture2D(tColor, vUv).rgb, smoothstep(uSharp, uSharp + uRange, abs(z - uFocus)));
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.material = new THREE.ShaderMaterial({
      defines: { SAMPLES: samples },
      uniforms: {
        tColor: { value: null },
        uMaxBlur: { value: 0 },
        uTexel: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tColor;
        uniform float uMaxBlur;
        uniform vec2 uTexel;
        void main() {
          vec4 centre = texture2D(tColor, vUv);
          float radius = centre.a * uMaxBlur;
          vec3 sum = centre.rgb;
          float total = 1.0;
          float angle = 0.0;
          for (int i = 1; i < SAMPLES; i++) {
            angle += 2.39996;
            float k = sqrt(float(i) / float(SAMPLES)) * radius;
            vec4 s = textureLod(tColor, vUv + vec2(cos(angle), sin(angle)) * k * uTexel, 0.0);
            // A sample that is itself in focus is in front of this blur, and stays out of it.
            float weight = clamp(s.a * 4.0, 0.0, 1.0);
            sum += s.rgb * weight;
            total += weight;
          }
          gl_FragColor = vec4(sum / total, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.step = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  }

  setSize(width, height) {
    this.step.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const amount = this.blurAmount.uniforms;
    amount.tColor.value = readBuffer.texture;
    amount.tDepth.value = readBuffer.depthTexture;
    this.quad.material = this.blurAmount;
    renderer.setRenderTarget(this.step);
    this.quad.render(renderer);

    this.material.uniforms.tColor.value = this.step.texture;
    this.quad.material = this.material;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.blurAmount.dispose();
    this.material.dispose();
    this.step.dispose();
    this.quad.dispose();
  }
}
/**
 * The lens and film, after everything else: corners falling away, and a trace of moving
 * grain. Runs on finished display colours, so it doesn't interact with tone mapping.
 */
class FilmPass extends Pass {
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uTime: { value: 0 },
        uVignette: { value: 0.5 },
        uGrain: { value: 0.012 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tColor;
        uniform float uTime, uVignette, uGrain;
        float noise(vec2 p) {
          return fract(sin(dot(p + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        }
        void main() {
          vec4 c = texture2D(tColor, vUv);
          vec2 d = vUv - 0.5;
          float fall = smoothstep(0.32, 0.86, length(d * vec2(1.0, 0.86)));
          c.rgb *= 1.0 - fall * uVignette;
          c.rgb += (noise(gl_FragCoord.xy) - 0.5) * uGrain;
          gl_FragColor = c;
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Draws the frame through a lens: depth of field, restrained bloom for anything brighter
 * than white (a flame, foil catching light), tone mapping, then vignette and grain.
 *
 * The tone curve is Khronos PBR Neutral, set on the renderer. It was designed to show
 * product colours truthfully, passing colours through 1:1 until close to white, which is
 * why it's used here rather than the usual filmic curves that shift every photograph.
 */
export default function CinemaPost({ controller, settings }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const pipeline = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      samples: settings.msaa,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType),
    });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const dof = settings.dof ? new DepthOfFieldPass(settings.dofSamples) : null;
    if (dof) composer.addPass(dof);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 1.15));
    composer.addPass(new OutputPass());
    const film = new FilmPass();
    composer.addPass(film);
    return { composer, dof, film, time: 0 };
  }, [gl, scene, camera, settings.msaa, settings.dof, settings.dofSamples]);

  useEffect(() => {
    pipeline.composer.setPixelRatio(dpr);
    pipeline.composer.setSize(size.width, size.height);
    if (pipeline.dof) pipeline.dof.material.uniforms.uTexel.value.set(1 / (size.width * dpr), 1 / (size.height * dpr));
  }, [pipeline, size, dpr]);

  useEffect(
    () => () => {
      const { composer } = pipeline;
      composer.passes.forEach((pass) => pass.dispose?.());
      composer.renderTarget1.depthTexture?.dispose();
      composer.renderTarget2.depthTexture?.dispose();
      composer.dispose();
    },
    [pipeline],
  );

  // A positive priority tells React Three Fiber this now draws the frame.
  useFrame((_, delta) => {
    if (!cinema.compiled) return;
    const { pose, layout } = controller;
    const moody = pose.closed;
    pipeline.time = (pipeline.time + Math.min(delta, 0.1)) % 60;
    pipeline.film.material.uniforms.uTime.value = pipeline.time;
    pipeline.film.material.uniforms.uVignette.value = 0.2 + moody * 0.62;
    pipeline.film.material.uniforms.uGrain.value = 0.006 + moody * 0.012;

    const { dof } = pipeline;
    if (dof) {
      dof.enabled = moody > 0.02;
      const u = dof.blurAmount.uniforms;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      // Focused on the middle of the book, wherever the camera has got to.
      u.uFocus.value = camera.position.distanceTo(FOCUS_POINT.set(0, 0, layout.blockT / 2));
      dof.material.uniforms.uMaxBlur.value = moody * moody * 11 * dpr;
    }
    pipeline.composer.render();
  }, 1);

  return null;
}

const FOCUS_POINT = new THREE.Vector3();
