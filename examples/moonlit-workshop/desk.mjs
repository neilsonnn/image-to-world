import { defaults } from "./defaults.mjs";
import {
  T,
  group,
  box,
  cylinder,
  lathe,
  ellipse,
  wood,
  paint,
  lit,
  rod,
  finish,
  books,
  cord,
  panel,
  tau,
} from "./craft.mjs";
export default {
  create({ params, random }) {
    params = { ...defaults.desk, ...params };
    const root = new T.Group(),
      oak = wood("#393a36", "#796144", "x"),
      door = wood("#373831", "#82654a", "y"),
      edge = wood("#35362f", "#655039", "z"),
      brass = paint("#c9a16a", 0.39, 0.53),
      steel = paint("#485163", 0.4, 0.45),
      ink = paint("#303e4b", 0.3, 0.35);
    const cream = paint("#e5cfaa"),
      russet = paint("#ac6543");
    // Narrow writing table with dovetailed drawers facing in toward the bed.
    box(root, oak, 0, 0.86, 0, 0.87, 0.095, 1.6, 0.021);
    for (const x of [-0.355, 0.355])
      for (const z of [-0.705, 0.705])
        box(root, door, x, 0.421, z, 0.105, 0.842, 0.12, 0.01);
    box(root, edge, 0, 0.74, -0.66, 0.75, 0.13, 0.12);
    box(root, edge, 0.34, 0.72, 0, 0.13, 0.22, 1.5);
    box(root, door, 0, 0.451, 0.39, 0.76, 0.72, 0.66, 0.015);
    box(root, edge, 0, 0.09, 0.39, 0.77, 0.15, 0.67, 0.009);
    for (let i = 0; i < 4; i++) {
      const y = 0.215 + i * 0.167;
      box(root, oak, -0.391, y, 0.38, 0.036, 0.151, 0.596, 0.006);
      rod(
        root,
        brass,
        [-0.42, y + 0.015, 0.31],
        [-0.44, y + 0.015, 0.31],
        0.013,
      );
      rod(
        root,
        brass,
        [-0.42, y + 0.015, 0.46],
        [-0.44, y + 0.015, 0.46],
        0.013,
      );
      rod(
        root,
        brass,
        [-0.44, y + 0.015, 0.31],
        [-0.44, y + 0.015, 0.46],
        0.012,
      );
    }
    books(root, -0.04, 0.907, 0.23, random, 3);
    // Blue thermos, stopper, rolled rim and a pair of handbound notebooks.
    const flask = lathe(root, steel, 0.21, 0.905, 0.53, [
      [0, 0],
      [0.064, 0],
      [0.068, 0.018],
      [0.063, 0.32],
      [0.048, 0.35],
      [0.046, 0.392],
      [0, 0.392],
    ]);
    for (const h of [0.016, 0.31, 0.347, 0.385])
      cylinder(root, ink, 0.21, 0.905 + h, 0.53, 0.061, 0.061, 0.011);
    const shade = paint(params.enamel, 0.33, 0.5),
      inside = paint("#e8cc93", 0.6),
      filament = lit("#fff0b6");
    const lamp = group(root, -0.135, 0.907, -0.22);
    lathe(lamp, shade, 0, 0, 0, [
      [0, 0],
      [0.139, 0],
      [0.138, 0.018],
      [0.117, 0.042],
      [0.055, 0.051],
      [0.034, 0.061],
      [0, 0.061],
    ]);
    const joints = [
      [0, 0.055, 0],
      [0.065, 0.36, 0.08],
      [0.13, 0.76, -0.018],
      [-0.094, 1.04, -0.072],
      [-0.224, 0.995, -0.057],
    ];
    for (let i = 0; i < joints.length - 1; i++) {
      rod(
        lamp,
        shade,
        joints[i],
        joints[i + 1],
        i === 0 ? 0.02 : 0.013,
        undefined,
        12,
      );
      if (i === 1 || i === 2)
        rod(
          lamp,
          brass,
          [joints[i][0] + 0.026, joints[i][1], joints[i][2]],
          [joints[i + 1][0] + 0.026, joints[i + 1][1], joints[i + 1][2]],
          0.006,
        );
    }
    for (const p of joints.slice(1, 4)) {
      ellipse(lamp, shade, ...p, 0.038, 0.038, 0.027);
      ellipse(lamp, brass, p[0], p[1], p[2] + 0.025, 0.012, 0.012, 0.007);
    }
    const hood = group(lamp, -0.22, 0.985, -0.058);
    hood.rotation.z = -0.75;
    hood.rotation.x = -0.15;
    lathe(hood, shade, 0, 0, 0, [
      [0.145, -0.146],
      [0.15, -0.133],
      [0.108, -0.066],
      [0.069, 0.033],
      [0.052, 0.055],
      [0.04, 0.083],
      [0, 0.083],
    ]);
    lathe(hood, inside, 0, -0.001, 0, [
      [0.143, -0.143],
      [0.102, -0.065],
      [0.063, 0.03],
      [0.043, 0.045],
    ]).material.side = T.DoubleSide;
    ellipse(hood, filament, 0, -0.092, 0, 0.033, 0.051, 0.033);
    cylinder(hood, brass, 0, -0.021, 0, 0.026, 0.026, 0.043);
    cord(
      root,
      ink,
      [
        [-0.13, 0.94, -0.24],
        [-0.1, 0.93, -0.5],
        [0.16, 0.916, -0.69],
        [0.3, 0.86, -0.77],
        [0.3, 0.21, -0.79],
        [0.32, 0.045, -0.91],
      ],
      0.007,
    );
    const bulb = new T.PointLight("#ffdb9a", params.lampPower, 3, 2);
    bulb.position.set(-0.43, 1.73, -0.28);
    root.add(bulb);
    // An opened astronomical notebook: separately cut covers and ruled leaves.
    const notebook = group(root, -0.07, 0.924, -0.52);
    notebook.rotation.y = 0.19;
    for (const d of [-1, 1]) {
      const leaf = group(notebook, d * 0.088, 0.007, 0);
      leaf.rotation.z = -d * 0.078;
      box(leaf, russet, 0, 0, 0, 0.182, 0.015, 0.255, 0.004);
      box(leaf, cream, 0, 0.011, 0, 0.171, 0.012, 0.246);
      for (let i = 0; i < 5; i++)
        box(leaf, steel, 0, 0.02, -0.06 + i * 0.024, 0.122, 0.002, 0.0025);
    }
    // Stationery tin at the foot of the desk contains two ferrule-tipped pencils
    // and a spread of paintbrushes; each brush has a real tapered tuft.
    const tin = group(root, 0.04, 0.045, 0.97),
      ivory = paint("#b8bbac"),
      graphite = paint("#363942"),
      cedar = paint("#c38651");
    lathe(tin, steel, 0, 0, 0, [
      [0, 0],
      [0.094, 0],
      [0.097, 0.22],
      [0.105, 0.224],
      [0.105, 0.239],
      [0.089, 0.239],
      [0.089, 0.196],
    ]);
    for (const h of [0.018, 0.052, 0.211])
      cylinder(tin, ivory, 0, h, 0, 0.098, 0.098, 0.008);
    for (let i = 0; i < 10; i++) {
      const angle = (tau * i) / 10,
        stem = [Math.cos(angle) * 0.051, 0.19, Math.sin(angle) * 0.052],
        y = 0.37 + random() * 0.12;
      const tip = [
        Math.cos(angle) * (0.065 + random() * 0.028),
        y,
        Math.sin(angle) * (0.073 + random() * 0.025),
      ];
      rod(tin, i % 3 ? cedar : russet, stem, tip, 0.009, 0.009, 7);
      rod(
        tin,
        i % 3 === 0 ? graphite : brass,
        tip,
        [tip[0] * 1.03, y + 0.024, tip[2] * 1.03],
        0.009,
        0.008,
        7,
      );
      rod(
        tin,
        i % 3 === 0 ? graphite : ink,
        [tip[0] * 1.03, y + 0.024, tip[2] * 1.03],
        [tip[0] * 1.12, y + 0.067, tip[2] * 1.12],
        0.008,
        0.0008,
        7,
      );
    }
    return finish(root);
  },
};
