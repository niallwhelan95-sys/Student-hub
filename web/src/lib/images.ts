/**
 * Downscale large photos/screenshots in the browser before upload: phone photos are often
 * >5 MB (the vision model's per-image limit) and far larger than needed to read text.
 */
export async function prepareImage(file: File, maxDim = 2400, maxBytes = 4 * 1024 * 1024): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  if (file.size <= maxBytes) {
    const dims = await imageSize(file).catch(() => null);
    if (!dims || Math.max(dims.w, dims.h) <= maxDim) return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function imageSize(file: File): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const out = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return out;
}

export function pastedFileName(file: File, i: number): File {
  if (file.name && file.name !== "image.png") return file;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new File([file], `screenshot-${stamp}${i ? `-${i}` : ""}.${file.type.split("/")[1] ?? "png"}`, { type: file.type });
}
