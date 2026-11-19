import { defaults } from "./defaults.mjs";
import { T, wood, paint, lathe, rod, books, finish, tau } from "./craft.mjs";
export default {
  create({ params, random }) {
    params = { ...defaults.stool, ...params };
    const root = new T.Group(),
      oak = wood("#6b4835", "#b08755", "y"),
      seat = wood("#745034", "#b9895a", "x"),
      brass = paint("#b99456", 0.48, 0.4);
    const h = params.height;
    lathe(root, seat, 0, h, 0, [
      [0, -0.047],
      [0.253, -0.047],
      [0.278, -0.032],
      [0.284, -0.006],
      [0.267, 0.02],
      [0.21, 0.025],
      [0.07, 0.019],
      [0, 0.02],
    ]);
    const radius = (y) => 0.216 - (0.055 * y) / h;
    const point = (i, y) => [
      Math.cos((tau * i) / 4 + 0.65) * radius(y),
      y,
      Math.sin((tau * i) / 4 + 0.65) * radius(y),
    ];
    for (let i = 0; i < 4; i++) {
      rod(root, oak, point(i, 0.025), point(i, h - 0.035), 0.022, 0.032, 12);
      rod(root, brass, point(i, 0.012), point(i, 0.043), 0.024, 0.0235, 12);
      rod(root, oak, point(i, 0.18), point(i + 1, 0.18), 0.014);
    }
    books(root, -0.3, 0, -0.4, random, 8);
    return finish(root);
  },
};
