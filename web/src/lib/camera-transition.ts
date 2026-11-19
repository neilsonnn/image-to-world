import { PerspectiveCamera } from "three";

export const CAMERA_TRANSITION_MS = 160;

export class CameraTransition {
  private movement?: {
    from: PerspectiveCamera;
    to: PerspectiveCamera;
    startedAt: number;
    duration: number;
  };

  constructor(private camera: PerspectiveCamera) {}

  get active() {
    return this.movement !== undefined;
  }

  start(
    target: PerspectiveCamera,
    now: number,
    duration = CAMERA_TRANSITION_MS,
  ) {
    this.movement = {
      from: this.camera.clone(),
      to: target.clone(),
      startedAt: now,
      duration,
    };
  }

  cancel() {
    this.movement = undefined;
  }

  finish() {
    if (this.movement)
      this.update(this.movement.startedAt + this.movement.duration);
  }

  update(now: number) {
    if (!this.movement) return;
    const { from, to, startedAt, duration } = this.movement;
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const alpha = 1 - (1 - progress) ** 3;
    this.camera.position.lerpVectors(from.position, to.position, alpha);
    this.camera.quaternion.slerpQuaternions(
      from.quaternion,
      to.quaternion,
      alpha,
    );
    this.camera.fov = from.fov + (to.fov - from.fov) * alpha;
    // Interpolate the calibrated projection too, including off-center intrinsics.
    for (let i = 0; i < 16; i++) {
      const start = from.projectionMatrix.elements[i];
      this.camera.projectionMatrix.elements[i] =
        start + (to.projectionMatrix.elements[i] - start) * alpha;
    }
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.camera.updateMatrixWorld();
    if (progress === 1) this.cancel();
  }
}
