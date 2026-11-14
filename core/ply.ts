/** Gaussian PLY is distinguished by its declared attributes, not its extension. */
export function isGaussianPly(header: string) {
  const end = header.indexOf("end_header");
  if (!/^ply\r?\n/.test(header) || end < 0) return false;
  const lines = header.slice(0, end).split(/\r?\n/);
  if (
    !lines.some((line) =>
      /^format (ascii|binary_little_endian) 1\.0$/.test(line),
    )
  )
    return false;
  let vertex = false;
  const fields = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("element "))
      vertex = /^element vertex [1-9]\d*$/.test(line);
    if (vertex) {
      const match = /^property (float|double) (\w+)$/.exec(line);
      if (match) fields.add(match[2]);
    }
  }
  return [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ].every((field) => fields.has(field));
}
