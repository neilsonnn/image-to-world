import type * as Rapier from "@dimforge/rapier3d-compat";
import { Matrix4, Object3D, Quaternion, Ray, Vector3 } from "three";
import {
  modulePhysicsSchema,
  supportsNodePhysics,
  type PhysicsBody,
  type PhysicsJoint,
} from "../../../core/physics";
import { addColliders } from "./play-colliders";
import { effectivelyVisible, type SceneGraph } from "./scene";

type Engine = typeof Rapier;
let loading: Promise<Engine> | undefined;
function loadEngine() {
  return (loading ??= import("@dimforge/rapier3d-compat")
    .then(async (engine) => {
      await engine.init();
      return engine;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}

const timestep = 1 / 60;
const unitScale = new Vector3(1, 1, 1);

function hierarchy(object: Object3D, root?: Object3D) {
  let depth = 0;
  for (let p: Object3D | null = object; p; p = p.parent) {
    if (p === root) return depth;
    depth++;
  }
  return root ? -1 : depth;
}

function bindBody(
  engine: Engine,
  world: Rapier.World,
  definition: PhysicsBody,
  geometry: Object3D,
  objects: Set<Object3D>,
) {
  const { object } = definition;
  const position = object.getWorldPosition(new Vector3());
  const rotation = object.getWorldQuaternion(new Quaternion()).normalize();
  const restRigid = new Matrix4().compose(position, rotation, unitScale);
  const inverseRigid = restRigid.clone().invert();
  // The residual includes scale and any shear inherited from ancestors. Keep
  // it intact as the rigid pose moves, including through nested moving bodies.
  const localToBody = inverseRigid.clone().multiply(object.matrixWorld);
  const rigid =
    definition.type === "static"
      ? engine.RigidBodyDesc.fixed()
      : engine.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          .setGravityScale(definition.gravityScale ?? 1)
          .setLinearDamping(0.12)
          .setAngularDamping(0.24);
  const body = world.createRigidBody(
    rigid
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation),
  );
  if (definition.shape) {
    if (definition.shape.parent)
      throw new Error("Collider shape must be a detached body-local object");
    if (definition.shape.matrixAutoUpdate) definition.shape.updateMatrix();
    addColliders(
      engine,
      world,
      body,
      definition,
      definition.shape,
      localToBody.clone().multiply(definition.shape.matrix),
      objects,
    );
  } else {
    addColliders(
      engine,
      world,
      body,
      definition,
      geometry,
      inverseRigid.multiply(geometry.matrixWorld),
      objects,
    );
  }
  return {
    object,
    body,
    localToBody,
    depth: hierarchy(object),
    matrix: object.matrix.clone(),
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    auto: object.matrixAutoUpdate,
  };
}
type Binding = ReturnType<typeof bindBody>;

function connectJoint(
  engine: Engine,
  world: Rapier.World,
  joint: PhysicsJoint,
  a: Binding,
  b: Binding,
) {
  const anchorA = new Vector3(...joint.anchorA).applyMatrix4(a.localToBody);
  const anchorB = new Vector3(...joint.anchorB).applyMatrix4(b.localToBody);
  const constraint =
    joint.type === "ball"
      ? engine.JointData.spherical(anchorA, anchorB)
      : engine.JointData[joint.type === "hinge" ? "revolute" : "prismatic"](
          anchorA,
          anchorB,
          new Vector3(...joint.axis).transformDirection(a.localToBody),
        );
  const connection = world.createImpulseJoint(constraint, a.body, b.body, true);
  connection.setContactsEnabled(false);
  if (joint.type !== "ball") {
    const axial = connection as Rapier.UnitImpulseJoint;
    if (joint.limits) axial.setLimits(...joint.limits);
    if (joint.motor)
      axial.configureMotorPosition(
        joint.motor.target,
        joint.motor.stiffness,
        joint.motor.damping,
      );
  }
}

function populate(engine: Engine, world: Rapier.World, graph: SceneGraph) {
  graph.scene.updateMatrixWorld(true);
  const bindings: Binding[] = [];
  for (const entry of graph.entries.values()) {
    if (
      !supportsNodePhysics(entry.node.kind) ||
      !effectivelyVisible(entry.root) ||
      entry.node.physics?.type === "none"
    )
      continue;
    const geometry = entry.content;
    if (entry.error) throw new Error(entry.error);
    if (!geometry || !effectivelyVisible(geometry)) continue;
    try {
      const module = !entry.node.physics && entry.modulePhysics;
      const spec = module
        ? modulePhysicsSchema.parse(module)
        : {
            bodies: [
              {
                id: entry.node.id,
                object: entry.root,
                ...entry.node.physics,
                type: entry.node.physics?.type ?? "static",
              },
            ],
            joints: [],
          };
      const objects = new Set<Object3D>();
      const ids = new Set<string>();
      const local = new Map<string, Binding>();
      for (const def of spec.bodies) {
        if (ids.has(def.id)) throw new Error(`Duplicate body ID ${def.id}`);
        if (objects.has(def.object))
          throw new Error(`Two bodies own the same object (${def.id})`);
        if (
          module &&
          (!(def.object instanceof Object3D) ||
            hierarchy(def.object, geometry) < 0)
        )
          throw new Error(`Body ${def.id} must own an object in this module`);
        ids.add(def.id);
        objects.add(def.object);
      }
      for (const def of spec.bodies) {
        if (!effectivelyVisible(def.object)) continue;
        const binding = bindBody(
          engine,
          world,
          def,
          module ? def.object : geometry,
          objects,
        );
        if (!binding.body.numColliders()) {
          world.removeRigidBody(binding.body);
          if (module || entry.node.physics)
            throw new Error(`Body ${def.id} has no collider geometry`);
          continue;
        }
        bindings.push(binding);
        local.set(def.id, binding);
      }
      for (const joint of spec.joints ?? []) {
        if (joint.a === joint.b || !ids.has(joint.a) || !ids.has(joint.b))
          throw new Error(
            `Joint must connect two declared bodies (${joint.a}, ${joint.b})`,
          );
        const a = local.get(joint.a),
          b = local.get(joint.b);
        if (a && b) connectJoint(engine, world, joint, a, b);
      }
    } catch (error) {
      throw new Error(
        `Play physics on ${entry.node.name}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return bindings.sort((a, b) => a.depth - b.depth);
}

export async function startScenePlay(
  graph: SceneGraph,
  signal = new AbortController().signal,
) {
  const [engine] = await Promise.all([loadEngine(), graph.ready(signal)]);
  signal.throwIfAborted();
  const world = new engine.World({ x: 0, y: -9.81, z: 0 });
  let bindings: Binding[];
  try {
    world.timestep = timestep;
    world.numSolverIterations = 8;
    bindings = populate(engine, world, graph);
    world.updateSceneQueries();
  } catch (error) {
    world.free();
    throw error;
  }
  const position = new Vector3(),
    rotation = new Quaternion(),
    local = new Matrix4();
  const target = new Vector3(),
    next = new Vector3();
  let held: { cursor: Rapier.RigidBody; distance: number } | undefined;
  let accumulator = 0;
  let disposed = false;
  const release = () => {
    if (held) world.removeRigidBody(held.cursor); // Also removes its grab joint.
    held = undefined;
  };
  return {
    bodyCount: bindings.length,
    step(seconds: number) {
      if (disposed) return;
      accumulator += Math.max(
        0,
        Math.min(Number.isFinite(seconds) ? seconds : 0, 0.1),
      );
      while (accumulator >= timestep) {
        if (held) {
          // Bound cursor speed after a large pointer jump to keep impulses stable.
          next.copy(held.cursor.translation());
          next.add(
            position
              .copy(target)
              .sub(next)
              .clampLength(0, 16 * timestep),
          );
          held.cursor.setNextKinematicTranslation(next);
        }
        world.step();
        accumulator -= timestep;
      }
      for (const binding of bindings) {
        const { body, object } = binding;
        const q = body.rotation();
        rotation.set(q.x, q.y, q.z, q.w);
        local
          .compose(position.copy(body.translation()), rotation, unitScale)
          .multiply(binding.localToBody);
        if (object.parent) {
          object.parent.updateWorldMatrix(true, false);
          local.premultiply(
            object.matrix.copy(object.parent.matrixWorld).invert(),
          );
        }
        object.matrixAutoUpdate = false;
        object.matrix
          .copy(local)
          .decompose(object.position, object.quaternion, object.scale);
        object.matrixWorldNeedsUpdate = true;
      }
      graph.scene.updateMatrixWorld(true);
    },
    grab(ray: Ray) {
      if (disposed) return false;
      release();
      const hit = world.castRay(
        new engine.Ray(ray.origin, ray.direction),
        100000,
        true,
      );
      const body = hit?.collider.parent();
      if (!hit || !body?.isDynamic()) return false;
      ray.at(hit.toi, target);
      const q = body.rotation();
      const anchor = target
        .clone()
        .sub(body.translation())
        .applyQuaternion(rotation.set(q.x, q.y, q.z, q.w).invert());
      const cursor = world.createRigidBody(
        engine.RigidBodyDesc.kinematicPositionBased().setTranslation(
          target.x,
          target.y,
          target.z,
        ),
      );
      // A compliant handle lets contacts and articulated joints resist the drag.
      const mass = body.mass();
      world.createImpulseJoint(
        engine.JointData.spring(
          0,
          mass * 440,
          mass * 34,
          { x: 0, y: 0, z: 0 },
          anchor,
        ),
        cursor,
        body,
        true,
      );
      held = { cursor, distance: hit.toi };
      return true;
    },
    moveGrab(ray: Ray) {
      if (held) ray.at(held.distance, target);
    },
    release,
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
      for (const binding of bindings) {
        const { object } = binding;
        object.matrix.copy(binding.matrix);
        object.position.copy(binding.position);
        object.quaternion.copy(binding.quaternion);
        object.scale.copy(binding.scale);
        object.matrixAutoUpdate = binding.auto;
        object.matrixWorldNeedsUpdate = true;
      }
      graph.scene.updateMatrixWorld(true);
      world.free();
    },
  };
}
export type ScenePlay = Awaited<ReturnType<typeof startScenePlay>>;
