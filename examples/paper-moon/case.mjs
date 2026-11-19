import { defineSceneModule } from "image-to-world/runtime";
export default defineSceneModule({
  create({ THREE: T }) {
    const group = new T.Group(),
      m = (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.88 });
    const walnut = m("#45392e"),
      dark = m("#242925"),
      brass = m("#a5884f"),
      oak = m("#8f6c46"),
      reeds = m("#514a3c");
    const from = (w, h, d, x, y, z, mat) => {
      let mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
    };
    const left = -3.24,
      right = 3.16,
      front = -2.6,
      back = -6.42,
      top = 3.53,
      bottom = -0.15;
    const width = right - left,
      height = top - bottom,
      depth = front - back,
      cx = (left + right) / 2,
      cy = (top + bottom) / 2,
      cz = (front + back) / 2;
    from(width + 0.16, 0.105, depth + 0.16, cx, bottom - 0.11, cz, dark);
    from(width + 0.09, 0.12, depth + 0.09, cx, bottom - 0.02, cz, walnut);
    from(width + 0.12, 0.016, depth + 0.12, cx, bottom - 0.067, cz, brass);
    from(width, 0.11, depth, cx, top, cz, walnut);
    from(0.105, height, depth, left, cy, cz, walnut);
    from(0.105, height, depth, right, cy, cz, walnut);
    from(width, height, 0.08, cx, cy, back, dark);
    for (let i = 0; i < 20; i++) {
      const x = left + 0.18 + (i * (width - 0.36)) / 19;
      from(0.014, 0.014, depth - 0.03, x, top + 0.06, cz, reeds);
    }
    for (const x of [left, right]) {
      for (let i = 0; i < 11; i++) {
        let z = back + 0.17 + (i * (depth - 0.34)) / 10;
        from(0.113, height - 0.18, 0.014, x, cy, z, reeds);
      }
      from(0.135, height + 0.03, 0.11, x, cy, front, oak);
      from(0.155, 0.1, 0.124, x, top - 0.12, front, brass);
      from(0.155, 0.1, 0.124, x, bottom + 0.13, front, brass);
    }
    from(width + 0.15, 0.13, 0.12, cx, top + 0.005, front, oak);
    from(width + 0.15, 0.105, 0.14, cx, bottom, front, oak);
    for (const x of [left, right])
      for (const y of [bottom + 0.12, top - 0.13]) {
        let pin = new T.Mesh(new T.SphereGeometry(0.023, 10, 6), dark);
        pin.scale.z = 0.35;
        pin.position.set(x, y, front + 0.07);
        group.add(pin);
      }
    // Continue the tatami up to the opening. The visible source floor lies farther inside.
    from(width - 0.1, 0.035, depth - 0.08, cx, bottom + 0.03, cz, m("#6d7354"));
    for (let i = 0; i < 68; i++)
      from(
        width - 0.14,
        0.003,
        0.009,
        cx,
        bottom + 0.05,
        back + 0.1 + (i * (depth - 0.2)) / 67,
        reeds,
      );
    for (const x of [left + 1, left + 3.2, right - 0.78])
      from(0.027, 0.004, depth - 0.12, x, bottom + 0.054, cz, dark);
    return { object: group };
  },
});
