import {
  Box3,
  PerspectiveCamera,
  Sphere,
  Vector3,
  WebGPUCoordinateSystem,
} from "three";
import type { Activity } from "../../../core/activity";
import type { SceneGraph } from "./scene";

type Change = NonNullable<Activity["sceneChange"]>;

export function changeBounds(graph: SceneGraph, change: Change) {
  const bounds = graph.bounds(change.nodeIds);
  return (
    bounds ??
    new Box3().setFromCenterAndSize(
      new Vector3(...change.position),
      new Vector3(0.25, 0.25, 0.25),
    )
  );
}

export function followCamera(camera: PerspectiveCamera, bounds: Box3) {
  const { center, radius } = bounds.getBoundingSphere(new Sphere());
  const direction = camera.position.clone().sub(center);
  if (direction.lengthSq() < 0.0001)
    camera.getWorldDirection(direction).negate();
  const projection = camera.projectionMatrix.elements;
  const halfAngle = Math.atan(1 / Math.max(projection[0], projection[5]));
  const distance = Math.max(1.5, (radius * 1.4) / Math.sin(halfAngle));
  const target = camera.clone();
  target.position.copy(center).addScaledVector(direction.normalize(), distance);
  target.lookAt(center);
  return target;
}

// React owns the accessible markers. Only their projection changes at render rate.
export class AgentPresence {
  private points = new WeakMap<
    HTMLElement,
    {
      event: string;
      version: number;
      nodes: object;
      current: Vector3;
      target: Vector3;
    }
  >();
  private screen = new Vector3();

  update(
    layer: HTMLElement,
    graph: SceneGraph,
    camera: PerspectiveCamera,
    anchors: Map<string, Activity>,
    nodes: object,
    seconds: number,
    reducedMotion: boolean,
  ) {
    const placed: { x: number; y: number; width: number; height: number }[] =
      [];
    for (const child of layer.children) {
      const marker = child as HTMLElement;
      const anchor = anchors.get(marker.dataset.actor!);
      if (!anchor?.sceneChange) {
        marker.hidden = true;
        continue;
      }
      let point = this.points.get(marker);
      if (
        !point ||
        point.event !== anchor.id ||
        point.version !== graph.spatialVersion ||
        point.nodes !== nodes
      ) {
        const target = changeBounds(graph, anchor.sceneChange).getCenter(
          new Vector3(),
        );
        point = {
          event: anchor.id,
          version: graph.spatialVersion,
          nodes,
          current: point?.current ?? target.clone(),
          target,
        };
        this.points.set(marker, point);
      }
      point.current.lerp(
        point.target,
        reducedMotion ? 1 : 1 - Math.exp(-9 * seconds),
      );
      const p = this.screen.copy(point.current).project(camera);
      marker.hidden =
        p.z < (camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1) ||
        p.z > 1 ||
        Math.abs(p.x) > 1 ||
        Math.abs(p.y) > 1;
      if (marker.hidden) continue;
      const width = marker.offsetWidth,
        height = marker.offsetHeight;
      const x = Math.min(
        layer.clientWidth - width,
        ((p.x + 1) * layer.clientWidth) / 2,
      );
      const top = Math.min(
        layer.clientHeight - height,
        ((1 - p.y) * layer.clientHeight) / 2,
      );
      const overlaps = placed.filter(
        (r) => x + width > r.x && x < r.x + r.width,
      );
      const y =
        [
          top,
          ...overlaps.flatMap((r) => [r.y + r.height + 2, r.y - height - 2]),
        ]
          .sort((a, b) => Math.abs(a - top) - Math.abs(b - top))
          .find(
            (y) =>
              y >= 0 &&
              y + height <= layer.clientHeight &&
              overlaps.every((r) => y >= r.y + r.height || y + height <= r.y),
          ) ?? top;
      placed.push({ x, y, width, height });
      marker.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }
}
