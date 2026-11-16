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
        const geometry = (child as Mesh).geometry;
        if (geometry) {
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          if (geometry.boundingBox)
            bounds.union(geometry.boundingBox.clone().applyMatrix4(matrix));
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
