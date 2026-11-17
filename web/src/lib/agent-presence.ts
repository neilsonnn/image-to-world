import {
  Color,
  Group,
  Mesh,
  OctahedronGeometry,
  MeshBasicMaterial,
  CameraHelper,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  type Scene,
} from "three";
import {
  recentActivities,
  actorColor,
  type Activity,
} from "../../../core/activity";
import type { SceneGraph } from "./scene";

/** Ephemeral editor projection of ordinary activity; never persisted or exported. */
export class AgentPresence {
  private root = new Group();
  private actors = new Map<
    string,
    {
      group: Group;
      marker: Mesh;
      camera: PerspectiveCamera;
      helper: CameraHelper;
      label: Sprite;
      event: string;
    }
  >();
  private last = 0;
  constructor(private scene: Scene) {
    this.root.userData.editorOverlay = true;
    scene.add(this.root);
  }
  update(events: Activity[], graph: SceneGraph, enabled: boolean) {
    const now = Date.now();
    this.root.visible = enabled;
    if (!enabled || now - this.last < 200) return;
    this.last = now;
    const latest = new Map<string, Activity>();
    for (const event of recentActivities(events, now))
      if (
        !["You", "System"].includes(event.actorId) &&
        (event.camera || event.nodeIds.length)
      )
        latest.set(event.actorId, event);
    for (const [actor, entry] of this.actors)
      if (!latest.has(actor)) {
        this.release(entry);
        this.actors.delete(actor);
      }
    for (const [actor, event] of latest) {
      let entry = this.actors.get(actor);
      if (!entry) {
        const color = actorColor(actor),
          group = new Group();
        const marker = new Mesh(
          new OctahedronGeometry(0.08),
          new MeshBasicMaterial({ color, transparent: true, depthTest: false }),
        );
        group.add(marker);
        const camera = new PerspectiveCamera(50, 16 / 9, 0.03, 0.4);
        group.add(camera);
        const helper = new CameraHelper(camera);
        helper.setColors(
          new Color(color),
          new Color(color),
          new Color(color),
          new Color(color),
          new Color(color),
        );
        helper.raycast = () => {};
        helper.renderOrder = 1000;
        this.root.add(helper);
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 48;
        const ctx = canvas.getContext("2d")!;
        ctx.font = "24px sans-serif";
        ctx.fillStyle = color;
        ctx.fillText(actor.slice(0, 28), 6, 32);
        const texture = new CanvasTexture(canvas),
          label = new Sprite(
            new SpriteMaterial({
              map: texture,
              transparent: true,
              depthTest: false,
            }),
          );
        label.scale.set(0.9, 0.1125, 1);
        label.position.set(0.35, 0.16, 0);
        group.add(label);
        group.traverse((o) => {
          o.raycast = () => {};
          o.renderOrder = 1000;
        });
        this.root.add(group);
        entry = { group, marker, camera, helper, label, event: "" };
        this.actors.set(actor, entry);
      }
      const opacity = ["queued", "running"].includes(event.phase)
        ? 1
        : Math.min(1, (60000 - (now - event.at)) / 15000);
      (entry.marker.material as MeshBasicMaterial).opacity = opacity;
      entry.label.material.opacity = opacity;
      if (entry.event === event.id) continue;
      entry.event = event.id;
      if (event.camera) {
        entry.group.position.fromArray(event.camera.position);
        entry.group.quaternion.fromArray(event.camera.quaternion);
        entry.helper.visible = true;
      } else {
        const center = event.nodeIds
          .map((id) => graph.center(id))
          .find(Boolean);
        entry.group.visible = !!center;
        if (center) entry.group.position.copy(center);
        entry.group.quaternion.identity();
        entry.helper.visible = false;
      }
    }
  }
  private release(entry: {
    group: Group;
    marker: Mesh;
    helper: CameraHelper;
    label: Sprite;
  }) {
    this.root.remove(entry.group, entry.helper);
    entry.marker.geometry.dispose();
    (entry.marker.material as MeshBasicMaterial).dispose();
    entry.helper.dispose();
    entry.label.material.map?.dispose();
    entry.label.material.dispose();
  }
  dispose() {
    for (const entry of this.actors.values()) this.release(entry);
    this.actors.clear();
    this.scene.remove(this.root);
  }
}
