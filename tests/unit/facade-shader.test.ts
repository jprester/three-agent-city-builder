import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFacadeMaterial, createFacadeUniforms } from '../../src/materials/facade';

/** The facade GLSL is assembled from chunks (src/materials/facade/); a bad cut breaks every building. */
function compiled() {
  const material = createFacadeMaterial(createFacadeUniforms({ value: 0 }, 1, null));
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
}

describe('facade shader assembly', () => {
  const { vertexShader, fragmentShader, uniforms } = compiled();

  it('splices every chunk in', () => {
    for (const include of ['color_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps', 'emissivemap_fragment']) {
      expect(fragmentShader).not.toContain(`#include <${include}>`);
    }
    expect(vertexShader).not.toContain('#include <color_vertex>');
    expect(fragmentShader).toContain('if (fType == T_ATLAS)');
    expect(fragmentShader).toContain('diffuseColor.rgb = fBase;');
  });

  it('has no unresolved interpolation', () => {
    for (const src of [vertexShader, fragmentShader]) {
      expect(src).not.toMatch(/\$\{|undefined|NaN/);
    }
  });

  it('balances braces (the surface if/else chain spans several chunks)', () => {
    const depth = (s: string) => [...s].reduce((d, ch) => d + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
    expect(depth(fragmentShader)).toBe(depth(THREE.ShaderLib.standard.fragmentShader));
  });

  it('binds every declared facade uniform', () => {
    for (const name of fragmentShader.matchAll(/uniform [^;]*?\b(u[A-Z]\w*)/g)) {
      expect(uniforms, name[1]).toHaveProperty(name[1]);
    }
  });
});
