import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

let s3Client = null;

function initS3Client() {
  if (process.env.STORAGE_PROVIDER !== 's3') return null;

  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.warn(
      'WARNING: S3 storage provider is selected, but AWS credentials are missing. Falling back to local storage behavior.'
    );
    return null;
  }

  const config = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  };

  // DigitalOcean Spaces / R2 / MinIO: set AWS_S3_ENDPOINT
  if (process.env.AWS_S3_ENDPOINT) {
    config.endpoint = process.env.AWS_S3_ENDPOINT;
    if (process.env.AWS_S3_FORCE_PATH_STYLE === 'true') {
      config.forcePathStyle = true;
    }
  }

  return new S3Client(config);
}

s3Client = initS3Client();

export function isRemoteStorageEnabled() {
  return Boolean(s3Client && process.env.STORAGE_PROVIDER === 's3');
}

function publicUrlForKey(fileKey) {
  if (process.env.AWS_S3_CUSTOM_DOMAIN) {
    const domain = process.env.AWS_S3_CUSTOM_DOMAIN.replace(/\/$/, '');
    return `${domain}/${fileKey}`;
  }
  if (process.env.AWS_S3_ENDPOINT) {
    const endpoint = process.env.AWS_S3_ENDPOINT.replace(/\/$/, '');
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    if (process.env.AWS_S3_FORCE_PATH_STYLE === 'true') {
      return `${endpoint}/${bucketName}/${fileKey}`;
    }
    return endpoint.replace('://', `://${bucketName}.`) + `/${fileKey}`;
  }
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  const s3Region = process.env.AWS_REGION || 'us-east-1';
  return `https://${bucketName}.s3.${s3Region}.amazonaws.com/${fileKey}`;
}

/**
 * Extract object key from a stored absolute URL (Spaces/S3/CDN) when possible.
 */
export function keyFromStoredUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('/uploads/')) return url.replace(/^\//, '');

  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/^\//, '');
    // path-style: /bucket/uploads/...
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    if (bucket && pathname.startsWith(`${bucket}/`)) {
      return pathname.slice(bucket.length + 1);
    }
    // virtual-host or CDN: /uploads/...
    if (pathname.startsWith('uploads/')) return pathname;
    return pathname || null;
  } catch {
    return null;
  }
}

/**
 * Upload a file to the configured storage provider (S3/Spaces or local fallback)
 * @returns {Promise<string>} Absolute public URL (remote) or relative /uploads/... path (local)
 */
export async function uploadFile(localFilePath, mimeType) {
  if (s3Client && process.env.STORAGE_PROVIDER === 's3') {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured.');
    }

    const fileBuffer = await fs.promises.readFile(localFilePath);
    const fileKey = `uploads/${Date.now()}-${path.basename(localFilePath)}`;

    console.log(`Uploading file ${localFilePath} to bucket ${bucketName} as key ${fileKey}...`);

    const params = {
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: mimeType
    };

    // Spaces often needs ACL public-read OR bucket CDN; skip ACL when blocked
    if (process.env.AWS_S3_SKIP_ACL !== 'true') {
      params.ACL = 'public-read';
    }

    await s3Client.send(new PutObjectCommand(params));
    const fileUrl = publicUrlForKey(fileKey);

    try {
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
        console.log(`Cleaned up temporary local upload file: ${localFilePath}`);
      }
    } catch (cleanupErr) {
      console.warn(`Failed to clean up temporary file: ${localFilePath}`, cleanupErr);
    }

    return fileUrl;
  }

  return '/' + localFilePath.replace(/\\/g, '/');
}

/**
 * Best-effort delete of a stored object (Spaces/S3 or local /uploads file).
 */
export async function deleteStoredObject(storedPathOrUrl) {
  if (!storedPathOrUrl) return false;

  if (storedPathOrUrl.startsWith('/uploads/')) {
    const localPath = path.resolve(process.cwd(), storedPathOrUrl.slice(1));
    try {
      await fs.promises.unlink(localPath);
      return true;
    } catch {
      return false;
    }
  }

  if (!s3Client || process.env.STORAGE_PROVIDER !== 's3') return false;

  const key = keyFromStoredUrl(storedPathOrUrl);
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  if (!key || !bucketName) return false;

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      })
    );
    return true;
  } catch (err) {
    console.warn(`Failed to delete stored object ${key}:`, err.message);
    return false;
  }
}
