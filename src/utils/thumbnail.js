import sharp from 'sharp';

/**
 * Build a small JPEG data-URL thumbnail for durable history cards.
 * Survives ephemeral /uploads and private S3 URLs (~15–40KB typical).
 */
export async function createThumbnailDataUrl(buffer, mimeType = 'image/jpeg', {
  maxWidth = 480,
  quality = 72
} = {}) {
  if (!buffer?.length) return null;

  try {
    const out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: maxWidth,
        height: maxWidth,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[thumbnail] sharp failed, trying raw fallback:', err.message);
    // Tiny originals only — avoid bloating the DB
    if (buffer.length <= 60_000 && typeof mimeType === 'string') {
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
    return null;
  }
}
