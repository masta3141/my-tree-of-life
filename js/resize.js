// Downscaling of photos in the browser (canvas), so stored images, thumbnails and Gemini uploads stay small.

export const PHOTO_MAX = 1600; // stored photos: longer side in px
export const THUMB_MAX = 192;  // list, tree and gallery tiles
export const GEMINI_MAX = 1024; // sent for identification

// Returns a JPEG whose longer side is at most `max` px, or the original blob if it is already small enough.
export async function downscale(blob, max, quality = 0.85) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1) { bmp.close(); return blob; }
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.convertToBlob
    ? canvas.convertToBlob({ type: "image/jpeg", quality })
    : new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

// Same, but never fails: formats the browser cannot decode are passed through unchanged (or null for thumbnails).
export const tryDownscale = (blob, max, fallback = blob) => downscale(blob, max).catch((e) => {
  console.warn("Downscaling failed", e);
  return fallback;
});
