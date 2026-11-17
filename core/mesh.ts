/** Portable meshes are self-contained GLB 2.0 files. No renderer-time remote fetches. */
export function validateGlb(buffer: ArrayBuffer) {
  const bytes = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    bytes.getUint32(0, true) !== 0x46546c67 ||
    bytes.getUint32(4, true) !== 2 ||
    bytes.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error("Expected a complete GLB 2.0 file");
  const length = bytes.getUint32(12, true);
  if (
    bytes.getUint32(16, true) !== 0x4e4f534a ||
    length + 20 > buffer.byteLength
  )
    throw new Error("GLB JSON chunk is invalid");
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim(),
  );
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri && !item.uri.startsWith("data:"))
      throw new Error(
        "Mesh must embed all buffers and textures; external GLB resources are unsupported",
      );
  const supported = new Set([
    // GLTFLoader decodes embedded WebP textures natively, without a plugin.
    "EXT_texture_webp",
    "KHR_materials_unlit",
    "KHR_materials_clearcoat",
    "KHR_materials_transmission",
    "KHR_materials_ior",
    "KHR_materials_specular",
    "KHR_materials_sheen",
    "KHR_materials_volume",
    "KHR_materials_emissive_strength",
    "KHR_texture_transform",
    "KHR_mesh_quantization",
    "KHR_materials_iridescence",
    "KHR_materials_anisotropy",
  ]);
  for (const extension of json.extensionsRequired ?? [])
    if (!supported.has(extension))
      throw new Error(
        `Unsupported required GLB extension: ${extension}. Export an uncompressed GLB with embedded textures.`,
      );
  if (!json.meshes?.length) throw new Error("GLB contains no meshes");
  return json;
}
