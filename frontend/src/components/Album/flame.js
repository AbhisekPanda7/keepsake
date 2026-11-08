/**
 * A candle or lamp flame, drawn on a small card that always faces the camera: white-gold at
 * the root, orange at the tip, swaying a little more the higher it goes. Shared by the oil
 * lamp and the candelabra.
 */
export const FLAME_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const FLAME_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uStrength;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Pinched to a point at the top, swaying more the higher it goes.
    float rise = vUv.y;
    p.x += sin(uTime * 7.0 + rise * 4.0) * 0.07 * rise + sin(uTime * 13.0) * 0.03 * rise;
    // Never quite zero: a smoothstep with equal edges divides by zero, and one bad pixel
    // becomes a black block once bloom has spread it.
    float width = 0.002 + mix(0.5, 0.03, pow(max(rise, 0.0), 1.4)) * smoothstep(0.0, 0.14, rise);
    float body = 1.0 - smoothstep(width * 0.25, width, abs(p.x));
    vec3 colour = mix(vec3(6.0, 2.1, 0.5), vec3(9.0, 6.5, 2.6), (1.0 - smoothstep(0.05, 0.75, rise)) * body);
    float halo = exp(-dot(p, p) * 2.4) * 0.14;
    gl_FragColor = vec4(colour * body + vec3(1.0, 0.5, 0.18) * halo, (body + halo) * uStrength);
  }
`;
