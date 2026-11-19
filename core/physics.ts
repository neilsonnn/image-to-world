import type { Object3D } from "three";
import { z } from "zod";

export const physicsTypes = ["static", "dynamic", "none"] as const;
export const physicsColliders = ["box", "hull", "mesh"] as const;
export const supportsNodePhysics = (kind: string) =>
  kind === "mesh" || kind === "procedural";

const finite = z.number().finite();
const point = z.tuple([finite, finite, finite]);
const materialFields = {
  collider: z.enum(physicsColliders).optional(),
  density: finite.positive().optional(),
  gravityScale: finite.nonnegative().optional(),
  friction: finite.nonnegative().optional(),
  restitution: finite.min(0).max(1).optional(),
};
const solid = z
  .object({
    type: z.enum(["static", "dynamic"]),
    ...materialFields,
  })
  .strict();
const supportedCollider = (value: { type: string; collider?: string }) =>
  !(value.type === "dynamic" && value.collider === "mesh");
const colliderError = "Use a box or convex hull for a dynamic body";

export const nodePhysicsSchema = z.union([
  z.object({ type: z.literal("none") }).strict(),
  solid.refine(supportedCollider, colliderError),
]);

// Three objects are live module output. Only the node-level settings above
// cross a project serialization boundary.
const object = z.custom<Object3D>(
  (value) => value?.isObject3D === true,
  "Expected a Three.js Object3D",
);
const body = solid
  .extend({
    id: z.string().min(1),
    object,
    shape: object.optional(),
  })
  .refine(supportedCollider, colliderError);
const anchors = {
  a: z.string().min(1),
  b: z.string().min(1),
  anchorA: point,
  anchorB: point,
};
const axial = {
  ...anchors,
  axis: point.refine((v) => Math.hypot(...v) > 1e-8, "Joint axis is zero"),
  limits: z
    .tuple([finite, finite])
    .refine(([min, max]) => min <= max, "Joint limits are reversed")
    .optional(),
  motor: z
    .object({
      target: finite,
      stiffness: finite.nonnegative(),
      damping: finite.nonnegative(),
    })
    .strict()
    .optional(),
};
const joint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ball"), ...anchors }).strict(),
  z.object({ type: z.literal("hinge"), ...axial }).strict(),
  z.object({ type: z.literal("slider"), ...axial }).strict(),
]);
export const modulePhysicsSchema = z
  .object({
    bodies: z.array(body),
    joints: z.array(joint).optional(),
  })
  .strict();
export type PhysicsBody = z.infer<typeof body>;
export type PhysicsJoint = z.infer<typeof joint>;
export type ModulePhysics = z.infer<typeof modulePhysicsSchema>;
