import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const HEIC_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function isHeicMime(mimeType = '') {
  return HEIC_MIME.has(String(mimeType).toLowerCase());
}

export function isAllowedImageMime(mimeType = '') {
  const m = String(mimeType).toLowerCase();
  return m === 'image/jpeg' || m === 'image/png' || m === 'image/webp' || isHeicMime(m);
}

/**
 * Normalize uploads for Gemini/storage: convert HEIC→JPEG, strip metadata,
 * optionally downscale very large images. Mutates file on disk when conversion needed.
 *
 * @returns {{ path: string, mimeType: string, converted: boolean }}
 */
export async function normalizeUploadImage(filePath, mimeType) {
  const inputMime = (mimeType || '').toLowerCase();
  const ext = path.extname(filePath || '').toLowerCase();
  const needsConvert =
    isHeicMime(inputMime) || ext === '.heic' || ext === '.heif';

  if (!needsConvert) {
    return { path: filePath, mimeType: inputMime || 'image/jpeg', converted: false };
  }

  const outPath = filePath.replace(/\.[^.]+$/, '') + '-normalized.jpg';

  try {
    await sharp(filePath)
      .rotate() // honor orientation, drop other EXIF in JPEG encode
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(outPath);

    try {
      if (fs.existsSync(filePath) && filePath !== outPath) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }

    return { path: outPath, mimeType: 'image/jpeg', converted: true };
  } catch (err) {
    // Clean partial output
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Unable to process image (${path.basename(filePath)}). ` +
        `HEIC/HEIF conversion failed: ${err.message}`
    );
  }
}
