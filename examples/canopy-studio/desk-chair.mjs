import { boxShape, roundShape, compound } from "./colliders.mjs";
import {
  T,
  paint,
  ink,
  group,
  box,
  cyl,
  rod,
  cord,
  ball,
  poly,
  finish,
} from "./desk-craft.mjs";
function pillow(root, m, outline, rings, profile) {
  const v = [],
    f = [],
    count = outline.length;
  for (const [s, h] of rings)
    for (const [x, z] of outline) v.push(profile(x * s, h, z * s));
  for (let i = 1; i < rings.length; i++)
    for (let j = 0; j < count; j++) {
      const a = (i - 1) * count + j,
        b = (i - 1) * count + ((j + 1) % count);
      f.push(a, a + count, b, b, a + count, b + count);
    }
  const a = (rings.length - 1) * count;
  for (let j = 1; j < count - 1; j++) {
    f.push(a, a + j + 1, a + j, 0, j, j + 1);
  }
  return poly(root, m, v, f);
}
export default {
  create({ params }) {
    const r = new T.Group(),
      c = group(r, 0.085, 0, 0.71);
    c.rotation.y = params.turn ?? -0.87;
    const leather = paint(params.upholstery ?? "#a35b37", "cloth"),
      pip = paint("#6b3525", "cloth"),
      metal = paint("#233235", "enamel"),
      highlight = paint("#435255", "enamel");
    const points = [
      [-0.17, -0.29],
      [0.17, -0.29],
      [0.24, -0.265],
      [0.285, -0.187],
      [0.29, 0.124],
      [0.263, 0.212],
      [0.205, 0.251],
      [-0.196, 0.251],
      [-0.257, 0.218],
      [-0.289, 0.157],
      [-0.29, -0.184],
      [-0.26, -0.252],
    ];
    const seat = (x, h, z) => [
      x,
      0.409 + h + 0.015 * Math.cos(x * 6.7) - 0.014 * z,
      z,
    ];
    pillow(
      c,
      leather,
      points,
      [
        [0.91, 0],
        [0.995, 0.015],
        [1, 0.07],
        [0.974, 0.091],
        [0.82, 0.102],
        [0.54, 0.107],
        [0.24, 0.109],
        [0.05, 0.11],
      ],
      seat,
    );
    for (const y of [0.026, 0.067])
      cord(
        c,
        pip,
        [...points, points[0]].map(([x, z]) => seat(x * 1.003, y, z * 1.003)),
        0.003,
      );
    for (let i = 0; i < 2; i++)
      cord(
        c,
        pip,
        [
          [-0.23 + i * 0.105, 0.502, -0.19],
          [-0.216 + i * 0.1, 0.509, -0.125],
          [-0.211 + i * 0.1, 0.517, -0.052],
        ],
        0.0019,
      );
    const backShape = [
      [-0.18, -0.144],
      [0.16, -0.144],
      [0.208, -0.118],
      [0.217, 0.096],
      [0.197, 0.15],
      [0.155, 0.17],
      [-0.158, 0.17],
      [-0.204, 0.145],
      [-0.22, 0.096],
      [-0.213, -0.11],
    ];
    const back = (x, h, y) => [
      x * 1.16,
      0.768 + y,
      0.242 + h + 0.032 * (1 - Math.pow(x / 0.23, 2)) + 0.17 * y,
    ];
    pillow(
      c,
      leather,
      backShape,
      [
        [0.88, -0.024],
        [0.98, -0.013],
        [1, 0.016],
        [0.971, 0.036],
        [0.83, 0.042],
        [0.55, 0.046],
      ],
      back,
    );
    for (const v of [0.012, 0.03])
      cord(
        c,
        pip,
        [...backShape, backShape[0]].map(([x, y]) =>
          back(x * 1.001, v, y * 0.998),
        ),
        0.0032,
      );
    cord(
      c,
      pip,
      [
        [-0.19, 0.849, 0.295],
        [-0.15, 0.846, 0.305],
        [-0.082, 0.837, 0.323],
        [0.014, 0.834, 0.333],
        [0.084, 0.835, 0.328],
      ],
      0.0024,
    );
    cord(
      c,
      pip,
      [
        seat(-0.205, 0.087, -0.238),
        seat(-0.167, 0.096, -0.201),
        seat(-0.117, 0.102, -0.183),
        seat(-0.063, 0.108, -0.166),
      ],
      0.0028,
    );
    cord(
      c,
      metal,
      [
        [0, 0.349, -0.085],
        [0, 0.345, 0.19],
        [0, 0.367, 0.279],
        [0, 0.454, 0.29],
        [0, 0.608, 0.295],
        [0, 0.743, 0.3],
      ],
      0.024,
    );
    for (let i = 0; i < 13; i++)
      cyl(c, highlight, 0, 0.429 + 0.016 * i, 0.295, 0.026, 0.026, 0.005, 16);
    box(c, metal, 0, 0.735, 0.306, 0.172, 0.108, 0.035, 0.015);
    for (const x of [-0.065, 0.065])
      ball(c, highlight, x, 0.74, 0.329, 0.009, 0.009, 0.003);
    cyl(c, metal, 0, 0.26, 0, 0.032, 0.041, 0.281);
    cyl(c, highlight, 0, 0.337, 0, 0.023, 0.023, 0.138);
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      const x = Math.sin(a) * 0.28,
        z = Math.cos(a) * 0.28;
      rod(c, metal, [0, 0.134, 0], [x, 0.071, z], 0.025, 0.017);
      ball(c, metal, x, 0.038, z, 0.034, 0.034, 0.026);
    }
    const shape = compound(
      boxShape([0.56, 0.095, 0.54], [0, 0.465, -0.01]),
      boxShape([0.48, 0.31, 0.065], [0, 0.78, 0.275]),
      roundShape(0.037, 0.31, [0, 0.27, 0]),
    );
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      shape.add(
        roundShape(0.035, 0.07, [
          0.28 * Math.sin(a),
          0.038,
          0.28 * Math.cos(a),
        ]),
      );
    }
    return finish(r, {
      bodies: [
        {
          id: "swivel-chair",
          type: "dynamic",
          object: c,
          collider: "hull",
          shape,
          density: 195,
          friction: 0.38,
        },
      ],
    });
  },
};
