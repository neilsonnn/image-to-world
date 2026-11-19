import { Box3, Matrix4, type Mesh, type Object3D, type Vector3 } from "three";

export type NodeSpatial = {
  object: Object3D;
  // Bounds and optional interaction center are local to object.
  getBounds: () => Box3;
  getCenter?: () => Vector3;
};

export function geometrySpatial(object: Object3D): NodeSpatial {
  return {
    object,
    getBounds: () => {
      const bounds = new Box3();
      const append = (child: Object3D, matrix: Matrix4) => {
        const localBounds = child.userData.localBounds as
          (() => Box3) | undefined;
        if (localBounds)
          bounds.union(localBounds().clone().applyMatrix4(matrix));
        // Instancing, batching and skinning can give an Object3D its own bounds
        // beyond the prototype geometry. Follow Three's object-first contract.
        const mesh = child as Mesh & {
          boundingBox?: Box3 | null;
          computeBoundingBox?: () => void;
        };
        const extent = mesh.boundingBox !== undefined ? mesh : mesh.geometry;
        if (extent) {
          if (!extent.boundingBox) extent.computeBoundingBox?.();
          if (extent.boundingBox)
            bounds.union(extent.boundingBox.clone().applyMatrix4(matrix));
        }
        for (const nested of child.children) {
          if (nested.matrixAutoUpdate) nested.updateMatrix();
          append(nested, matrix.clone().multiply(nested.matrix));
        }
      };
      append(object, new Matrix4());
      return bounds;
    },
  };
}
