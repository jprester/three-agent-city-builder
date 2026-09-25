import * as THREE from 'three';

/**
 * Planar reflection of the scene in the ground plane (y = 0), rendered at a fraction of the
 * canvas into a half-float target so emissive highlights keep their HDR range for bloom.
 * Adapted from three's Reflector: mirrored virtual camera plus an oblique near plane that
 * clips everything below the ground. `matrix` maps world positions to target UVs.
 */
export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly matrix = new THREE.Matrix4();
  private readonly virtual = new THREE.PerspectiveCamera();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();

  constructor(private readonly scale: number) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.target.texture.name = 'reflection';
    this.target.texture.generateMipmaps = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  /** Render the mirrored scene; `hidden` objects (the ground itself) are skipped. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hidden: THREE.Object3D[]) {
    const v = this.virtual;
    camera.updateMatrixWorld();
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= 0.01) return;
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(eye);
    v.position.set(eye.x, -eye.y, eye.z);
    v.up.set(0, 1, 0).applyMatrix4(rot);
    v.up.y = -v.up.y;
    v.lookAt(look.x, -look.y, look.z);
    v.near = camera.near;
    v.far = camera.far;
    v.updateMatrixWorld();
    v.projectionMatrix.copy(camera.projectionMatrix);

    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(v.projectionMatrix)
      .multiply(v.matrixWorldInverse);

    // Oblique near plane at y = 0 (Lengyel), so nothing below the ground leaks in.
    this.plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(v.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = v.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + p[8]) / p[0], (Math.sign(this.clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1 - 0.003;
    p[14] = this.clip.w;

    const visible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, v);
    renderer.setRenderTarget(prev);
    hidden.forEach((o, i) => (o.visible = visible[i]));
  }
}
