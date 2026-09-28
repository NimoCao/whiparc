'use client';

import * as React from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useReducedMotion } from 'framer-motion';

// A minimal full-screen shader: a slow flowing indigo/amber noise field
// under a faint blueprint grid — reads as "canvas" rather than literal
// 3D geometry. No post-processing passes, single fullscreen quad.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amp * noise(p);
      p *= 2.02;
      amp *= 0.55;
    }
    return value;
  }

  void main() {
    vec2 aspectUv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);

    vec2 drift = aspectUv * 1.6 + uMouse * 0.12;
    float t = uTime * 0.035;

    float n1 = fbm(drift + vec2(t, -t * 0.6));
    float n2 = fbm(drift * 1.6 - vec2(t * 0.4, t));

    float glow = smoothstep(0.15, 0.85, n1);
    vec3 color = mix(uColorC, uColorA, glow);
    color = mix(color, uColorB, smoothstep(0.55, 1.0, n2) * 0.55);

    float dist = length(aspectUv);
    float vignette = smoothstep(1.15, 0.1, dist);

    // faint blueprint grid, ties the shader back to "canvas"
    vec2 gridUv = aspectUv * 14.0;
    vec2 gridF = abs(fract(gridUv) - 0.5);
    float gridLine = smoothstep(0.485, 0.5, max(gridF.x, gridF.y));
    color += gridLine * 0.05 * vignette;

    float alpha = vignette * (0.2 + glow * 0.26);
    gl_FragColor = vec4(color, alpha);
  }
`;

function ShaderPlane() {
  const matRef = React.useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const reduceMotion = useReducedMotion();
  const mouse = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const uniforms = React.useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uColorA: { value: new THREE.Color('#FF6A3D') }, // indigo-500
      uColorB: { value: new THREE.Color('#F59E0B') }, // amber-500
      uColorC: { value: new THREE.Color('#101114') }, // graphite base
    }),
    []
  );

  useFrame((_, delta) => {
    const mat = matRef.current;
    if (!mat) return;
    if (!reduceMotion) {
      mat.uniforms.uTime.value += delta;
    }
    mat.uniforms.uResolution.value.set(size.width, size.height);
    const target = reduceMotion ? { x: 0, y: 0 } : mouse.current;
    const u = mat.uniforms.uMouse.value as THREE.Vector2;
    u.x += (target.x - u.x) * 0.04;
    u.y += (target.y - u.y) * 0.04;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

// WebGL context creation can fail on locked-down or ancient browsers — the
// hero must degrade to the gradient background rather than take the page down.
class Canvas3DBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function HeroShaderField({ className }: { className?: string }) {
  return (
    <div className={className ?? 'absolute inset-0'} style={{ pointerEvents: 'none' }}>
      <Canvas3DBoundary>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
          orthographic
          camera={{ position: [0, 0, 1], near: 0, far: 1 }}
        >
          <ShaderPlane />
        </Canvas>
      </Canvas3DBoundary>
    </div>
  );
}

export default HeroShaderField;
