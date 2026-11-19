import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ShapeUtils, Vector2 } from "three";
import fs from "node:fs/promises";
import path from "node:path";
import { objects } from "./geometry.mjs";
import { encodeDepth } from "../../web/src/server/depth.ts";
const W = 1200,
  H = 672,
  F = 735,
  CX = W / 2,
  CY = H / 2;
export const projection = { fx: F, fy: F, cx: CX, cy: CY, width: W, height: H };
export async function buildRoomMeshes(original, root) {
  const im = await loadImage(original),
    flat = createCanvas(W, H),
    flatCtx = flat.getContext("2d");
  flatCtx.drawImage(im, 0, 0, W, H);
  const originalPx = flatCtx.getImageData(0, 0, W, H).data;
  const ownership = createCanvas(W, H),
    oc = ownership.getContext("2d");
  const faces = objects.flatMap((o) => o.faces);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    oc.beginPath();
    f.outline.forEach(([x, y], n) => (n ? oc.lineTo(x, y) : oc.moveTo(x, y)));
    oc.closePath();
    oc.fillStyle = "rgb(" + [i + 1, 0, 0].join(",") + ")";
    oc.fill();
    if (objects.find((o) => o.id === "lamp").faces.includes(f)) {
      oc.strokeStyle = oc.fillStyle;
      oc.lineJoin = "round";
      oc.lineWidth = 6;
      oc.stroke();
    }
  }
  const ids = oc.getImageData(0, 0, W, H).data;
  const bound = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const depth = (face, x, y) =>
    typeof face.depth === "function" ? face.depth(x, y) : face.depth;
  const p3 = (x, y, z) => [((x - CX) * z) / F, 1.58 + ((CY - y) * z) / F, -z];
  const color = (hex) =>
    [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  // The nearest painted surface owns the visible color, also where a constructed face crosses another.
  const grid = new Float32Array(W * H).fill(Infinity),
    visibleFace = new Uint16Array(W * H);
  const coverage = createCanvas(W, H),
    coverageCtx = coverage.getContext("2d");
  for (let i = 0; i < faces.length; i++) {
    const face = faces[i],
      points = face.outline;
    const x0 = bound(
        Math.floor(Math.min(...points.map((p) => p[0]))),
        0,
        W - 1,
      ),
      y0 = bound(Math.floor(Math.min(...points.map((p) => p[1]))), 0, H - 1),
      x1 = bound(Math.ceil(Math.max(...points.map((p) => p[0]))), x0 + 1, W),
      y1 = bound(Math.ceil(Math.max(...points.map((p) => p[1]))), y0 + 1, H);
    coverageCtx.clearRect(0, 0, W, H);
    coverageCtx.beginPath();
    points.forEach(([x, y], j) =>
      j ? coverageCtx.lineTo(x, y) : coverageCtx.moveTo(x, y),
    );
    coverageCtx.closePath();
    coverageCtx.fill();
    const mask = coverageCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (mask[((y - y0) * (x1 - x0) + x - x0) * 4 + 3] < 128) continue;
        const ix = y * W + x,
          z = depth(face, x + 0.5, y + 0.5);
        if (z > 0 && z < grid[ix]) {
          grid[ix] = z;
          visibleFace[ix] = i + 1;
        }
      }
  }
  for (let i = 0; i < grid.length; i++)
    if (!Number.isFinite(grid[i])) grid[i] = NaN;
  const paintedLampId =
    faces.indexOf(objects.find((o) => o.id === "lamp").faces[0]) + 1;
  const outDir = path.join(root, "meshes");
  await fs.mkdir(outDir, { recursive: true });
  await Bun.write(
    path.join(root, "attic-authored-depth.exr"),
    await encodeDepth({ data: grid, width: W, height: H, stride: 1 }),
  );

  const placements = [];
  for (const obj of objects) {
    // A texture for each constructed face keeps hidden wood or upholstery underneath foreground silhouettes.
    const blobs = [],
      gltf = {
        asset: {
          version: "2.0",
          generator: "Paper Moon • hand-authored reference geometry",
        },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: obj.name, mesh: 0 }],
        meshes: [{ name: obj.name, primitives: [] }],
        buffers: [{ byteLength: 0 }],
        bufferViews: [],
        accessors: [],
        images: [],
        textures: [],
        materials: [],
        extensionsUsed: ["KHR_materials_unlit"],
      };
    let offset = 0;
    function bufferView(v) {
      let b = Buffer.from(v.buffer || v, v.byteOffset || 0, v.byteLength),
        i = gltf.bufferViews.length;
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: b.length,
      });
      blobs.push(b);
      offset += b.length;
      if (offset % 4) {
        const pad = 4 - (offset % 4);
        blobs.push(Buffer.alloc(pad));
        offset += pad;
      }
      return i;
    }
    function accessor(arr, n) {
      let vi = bufferView(new Float32Array(arr)),
        i = gltf.accessors.length,
        k = n === 3 ? "VEC3" : "VEC2",
        lo = Array(n).fill(Infinity),
        hi = Array(n).fill(-Infinity);
      arr.forEach((v, j) => {
        lo[j % n] = Math.min(lo[j % n], v);
        hi[j % n] = Math.max(hi[j % n], v);
      });
      gltf.accessors.push({
        bufferView: vi,
        componentType: 5126,
        count: arr.length / n,
        type: k,
        min: lo,
        max: hi,
      });
      return i;
    }
    const sideMat =
      gltf.materials.push({
        name: "Hidden faces • " + obj.name,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [
            ...color(obj.color).map((c) => (c / 255) ** 2.2),
            1,
          ],
          roughnessFactor: 0.96,
          metallicFactor: 0,
        },
      }) - 1;
    let allPos = [],
      prims = [];
    for (const face of obj.faces) {
      const poly = face.outline,
        id = faces.indexOf(face) + 1;
      const lx = bound(
          Math.floor(Math.min(...poly.map((p) => p[0]))) - 2,
          0,
          W - 1,
        ),
        ly = bound(
          Math.floor(Math.min(...poly.map((p) => p[1]))) - 2,
          0,
          H - 1,
        ),
        wx = Math.min(
          W - lx,
          Math.ceil(Math.max(...poly.map((p) => p[0]))) - lx + 3,
        ),
        hy = Math.min(
          H - ly,
          Math.ceil(Math.max(...poly.map((p) => p[1]))) - ly + 3,
        );
      const nearest = new Int32Array(wx * hy).fill(-1),
        cost = new Int32Array(wx * hy).fill(wx + hy + 1);
      for (let j = 0; j < hy; j++)
        for (let i = 0; i < wx; i++) {
          let k = j * wx + i;
          if (ids[((j + ly) * W + i + lx) * 4] === id) {
            nearest[k] = k;
            cost[k] = 0;
          }
        }
      const relax = (k, q) => {
        if (cost[q] + 1 < cost[k]) {
          cost[k] = cost[q] + 1;
          nearest[k] = nearest[q];
        }
      };
      for (let j = 0; j < hy; j++)
        for (let i = 0; i < wx; i++) {
          const k = j * wx + i;
          if (i) relax(k, k - 1);
          if (j) relax(k, k - wx);
        }
      for (let j = hy - 1; j >= 0; j--)
        for (let i = wx - 1; i >= 0; i--) {
          const k = j * wx + i;
          if (i + 1 < wx) relax(k, k + 1);
          if (j + 1 < hy) relax(k, k + wx);
        }
      const texture = createCanvas(wx, hy),
        tc = texture.getContext("2d"),
        pixels = tc.createImageData(wx, hy),
        rgb = color(face.fill);
      for (let j = 0; j < hy; j++)
        for (let i = 0; i < wx; i++) {
          const x = i + lx,
            y = j + ly,
            idx = (y * W + x) * 4,
            out = (j * wx + i) * 4,
            own = ids[idx];
          // Preserve visible artwork. Under an occluder, continue the surface with directional grain/bands.
          let use =
              own <= id ||
              (visibleFace[y * W + x] === id && own !== paintedLampId),
            grain = ((Math.sin(x * 13.237 + y * 7.851) * 43758.5453) % 1) * 3,
            panel =
              obj.id === "shell" ||
              [
                "cupboard",
                "dresser",
                "desk",
                "bedstead",
                "stool",
                "loft",
              ].includes(obj.id);
          const shade = panel
            ? 0.9 +
              0.065 * Math.sin(x * 0.153 + y * 0.011) +
              0.035 * Math.cos(x * 0.57) +
              ((x + Math.round(y / 60)) % 55 < 2 ? -0.19 : 0)
            : 0.94 + 0.06 * Math.sin((x + y * 0.3) * 0.053);
          const donor = nearest[j * wx + i];
          const dx = donor % wx,
            dy = Math.floor(donor / wx);
          let tx = bound(
              dx + Math.sign(dx - i) * (3 + Math.floor((j % 7) / 2)),
              0,
              wx - 1,
            ),
            ty = bound(
              dy + Math.sign(dy - j) * (3 + Math.floor((i % 5) / 2)),
              0,
              hy - 1,
            );
          if (ids[((ty + ly) * W + tx + lx) * 4] !== id) {
            tx = dx;
            ty = dy;
          }
          const previous = ((ty + ly) * W + tx + lx) * 4;
          for (let c = 0; c < 3; c++)
            pixels.data[out + c] = use
              ? originalPx[idx + c]
              : Math.round(
                  donor < 0
                    ? rgb[c] * shade + grain
                    : originalPx[previous + c] * 0.87 +
                        rgb[c] * shade * 0.13 +
                        grain,
                );
          pixels.data[out + 3] = 255;
        }
      tc.putImageData(pixels, 0, 0);
      const image =
          gltf.images.push({
            bufferView: bufferView(texture.toBuffer("image/jpeg", 93)),
            mimeType: "image/jpeg",
          }) - 1,
        ti = gltf.textures.push({ source: image }) - 1,
        mi =
          gltf.materials.push({
            name: "Painted surface " + id,
            doubleSided: true,
            extensions: { KHR_materials_unlit: {} },
            pbrMetallicRoughness: {
              baseColorTexture: { index: ti },
              metallicFactor: 0,
              roughnessFactor: 1,
            },
          }) - 1;
      let front = [],
        uv = [],
        sides = [];
      function at(pt, back = 0) {
        let [x, y] = pt;
        return p3(x, y, depth(face, x, y) + back);
      }
      const triangles = ShapeUtils.triangulateShape(
        poly.map(([x, y]) => new Vector2(x, y)),
        [],
      );
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      function tessellate(a, b, c, l) {
        let dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (l < 8 && Math.max(dist(a, b), dist(a, c), dist(b, c)) > 48) {
          let ab = mid(a, b),
            bc = mid(b, c),
            ac = mid(a, c);
          tessellate(a, ab, ac, l + 1);
          tessellate(ab, b, bc, l + 1);
          tessellate(ac, bc, c, l + 1);
          tessellate(ab, bc, ac, l + 1);
          return;
        }
        for (const p of [a, b, c]) {
          front.push(...at(p));
          uv.push((p[0] - lx + 0.5) / wx, (p[1] - ly + 0.5) / hy);
        }
        for (const p of [c, b, a]) sides.push(...at(p, obj.thickness));
      }
      for (const [a, b, c] of triangles) {
        tessellate(poly[a], poly[b], poly[c], 0);
      }
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length],
          steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 24);
        for (let k = 0; k < steps; k++) {
          const mix = (t) => [
              a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t,
            ],
            q = mix(k / steps),
            r = mix((k + 1) / steps);
          sides.push(
            ...at(q),
            ...at(r),
            ...at(r, obj.thickness),
            ...at(q),
            ...at(r, obj.thickness),
            ...at(q, obj.thickness),
          );
        }
      }
      prims.push({ pos: front, uv, mat: mi }, { pos: sides, mat: sideMat });
      for (let j = 0; j < front.length; j++) allPos.push(front[j]);
    }
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < allPos.length; k++) {
      let i = k % 3;
      lo[i] = Math.min(lo[i], allPos[k]);
      hi[i] = Math.max(hi[i], allPos[k]);
    }
    const center = lo.map((x, i) => (x + hi[i]) / 2);
    center[1] = lo[1];
    for (const prim of prims) {
      const pos = prim.pos.map((v, i) => v - center[i % 3]);
      const at = { POSITION: accessor(pos, 3) };
      if (prim.uv) at.TEXCOORD_0 = accessor(prim.uv, 2);
      gltf.meshes[0].primitives.push({
        attributes: at,
        material: prim.mat,
        mode: 4,
      });
    }
    gltf.buffers[0].byteLength = offset;
    const json = Buffer.from(JSON.stringify(gltf));
    const jp = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
    json.copy(jp);
    const head = Buffer.alloc(20);
    head.write("glTF");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(28 + jp.length + offset, 8);
    head.writeUInt32LE(jp.length, 12);
    head.write("JSON", 16);
    const bin = Buffer.alloc(8);
    bin.writeUInt32LE(offset, 0);
    bin.writeUInt32LE(0x004e4942, 4);
    const dest = path.join(outDir, obj.id + ".glb");
    await Bun.write(dest, Buffer.concat([head, jp, bin, ...blobs]));
    placements.push({
      name: obj.name,
      id: "attic-" + obj.id,
      center,
      file: dest,
    });
  }
  return { placements, depth: path.join(root, "attic-authored-depth.exr") };
}
