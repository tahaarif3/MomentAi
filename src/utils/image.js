import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '../..');

export function guessMimeFromPath(imagePath) {
  const ext = path.extname(imagePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Read a queue source image after it has been written to durable storage.
 * Remote URLs are used for object storage; local /uploads paths keep local/dev working.
 */
export async function loadImageBytes(imagePath) {
  if (!imagePath) throw new Error('Missing source image path.');

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch stored image: ${response.status} ${response.statusText}`);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type')?.split(';')[0] || guessMimeFromPath(imagePath)
    };
  }

  const relative = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
  const localPath = path.resolve(projectRoot, relative);
  return {
    buffer: await fs.promises.readFile(localPath),
    mimeType: guessMimeFromPath(imagePath)
  };
}
