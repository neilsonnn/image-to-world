// Human-editable defaults written into each module's Properties panel.
export const modules = [
  [
    "dome",
    "Limewash, window joinery and pinned studies",
    43,
    { plaster: "#9f988b", paper: "#afa594", paperTooth: 1 },
  ],
  [
    "stonework",
    "Split limestone plinth and masonry",
    43,
    { limestone: "#677060", grain: 1 },
  ],
  [
    "woodland",
    "Alders beyond the glass",
    1,
    { sky: "#edf5f2", meadow: "#9ab76b", paperTooth: 1, leafDensity: 1 },
  ],
  [
    "old-tree",
    "House tree · fluted bark, moss and ivy",
    43,
    { moss: 0.55, leafDensity: 1 },
  ],
  [
    "desk-furniture",
    "Oak trestles and corner return",
    43,
    { tableWood: "#ba8652" },
  ],
  [
    "desk-chair",
    "Russet studio chair",
    43,
    { upholstery: "#a35b37", turn: -0.87 },
  ],
  [
    "desk-machine",
    "Typewriter, journals and satchel",
    43,
    { typewriterYaw: 1.06 },
  ],
  [
    "desk-paper",
    "Folio, drawing sheets and bound studies",
    43,
    { boardTilt: 0.143, folioYaw: -0.09 },
  ],
  [
    "desk-tools",
    "Articulated lamps and the brush collection",
    43,
    { mugColor: "#315570" },
  ],
  [
    "planters",
    "Window shelf · spider plants and amber bottle",
    154,
    { bladeDensity: 1, leafTone: "#274235", bottleColor: "#ad824d" },
  ],
];
export const lighting = {
  fillColor: "#d2dddc",
  fillIntensity: 1.16,
  keyColor: "#ffeed9",
  keyIntensity: 1.65,
  keyShadows: true,
  azimuth: -155,
  elevation: 38,
  background: "#cfdee5",
};
export const projection = (fov, width = 2944, height = 1648) => {
  const fy = height / (2 * Math.tan((fov * Math.PI) / 360));
  return { fx: fy, fy, cx: width / 2, cy: height / 2, width, height };
};
export const heroCamera = {
  extrinsics: {
    position: [0, 1.45, 4.2],
    quaternion: [0, 0, 0, 1],
    coordinateSystem: "rub",
  },
  intrinsics: projection(38),
};
export async function inspectionCamera(cli, frame) {
  const angled = await cli(
    "camera",
    "solve",
    "--position=-1.14,1.65,2.72",
    "--look-at=0.15,1.31,-0.74",
    "--fov",
    "54",
  );
  angled.intrinsics = projection(54, 2208, 1236);
  const transform = (position = [0, 0, 0], quaternion = [0, 0, 0, 1]) => ({
    position,
    quaternion,
    scale: [1, 1, 1],
  });
  await cli(
    "command",
    JSON.stringify({
      type: "nodes.put",
      nodes: [
        {
          id: "canopy-inspection",
          name: "Inspection cameras",
          kind: "group",
          visible: true,
          parentId: frame,
          transform: transform(),
        },
        {
          id: "canopy-oblique",
          name: "Across the drafting table",
          kind: "camera",
          visible: false,
          parentId: "canopy-inspection",
          transform: transform(
            angled.extrinsics.position,
            angled.extrinsics.quaternion,
          ),
          projection: angled.intrinsics,
        },
      ],
    }),
  );
  return angled;
}
