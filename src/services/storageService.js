import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

let s3Client = null;

if (process.env.STORAGE_PROVIDER === 's3') {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.warn("WARNING: S3 storage provider is selected, but AWS credentials are missing. Falling back to local storage behavior.");
  } else {
    const config = {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    };
    
    // Support custom S3-compatible endpoints (like Cloudflare R2, MinIO, etc.)
    if (process.env.AWS_S3_ENDPOINT) {
      config.endpoint = process.env.AWS_S3_ENDPOINT;
      // Depending on endpoint, we might need forcePathStyle
      if (process.env.AWS_S3_FORCE_PATH_STYLE === 'true') {
        config.forcePathStyle = true;
      }
    }

    s3Client = new S3Client(config);
  }
}

/**
 * Upload a file to the configured storage provider (S3 or local fallback)
 * @param {string} localFilePath - Path to the local file (e.g. from Multer)
 * @param {string} mimeType - The mime type of the file
 * @returns {Promise<string>} The public or relative web URL of the uploaded file
 */
export async function uploadFile(localFilePath, mimeType) {
  // If provider is S3 and client is initialized
  if (s3Client && process.env.STORAGE_PROVIDER === 's3') {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error("AWS_S3_BUCKET_NAME is not configured.");
    }

    const fileBuffer = await fs.promises.readFile(localFilePath);
    const fileKey = `uploads/${Date.now()}-${path.basename(localFilePath)}`;

    console.log(`Uploading file ${localFilePath} to S3 bucket ${bucketName} as key ${fileKey}...`);
    
    const params = {
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: mimeType
    };

    // If using AWS S3, ACL: 'public-read' is common, but may fail if Block Public Access is active.
    // Allow configuration of ACL or skip it if disabled.
    if (process.env.AWS_S3_SKIP_ACL !== 'true') {
      params.ACL = 'public-read';
    }

    await s3Client.send(new PutObjectCommand(params));

    // Construct public URL
    let fileUrl = '';
    if (process.env.AWS_S3_CUSTOM_DOMAIN) {
      // E.g. Cloudflare CDN domain or custom domain mapped to bucket
      fileUrl = `${process.env.AWS_S3_CUSTOM_DOMAIN}/${fileKey}`;
    } else if (process.env.AWS_S3_ENDPOINT) {
      // E.g. Cloudflare R2 endpoint or custom S3 service
      // R2 endpoint formats look like: https://<account_id>.r2.cloudflarestorage.com
      const endpoint = process.env.AWS_S3_ENDPOINT.replace(/\/$/, '');
      if (process.env.AWS_S3_FORCE_PATH_STYLE === 'true') {
        fileUrl = `${endpoint}/${bucketName}/${fileKey}`;
      } else {
        // Virtual host-style
        fileUrl = endpoint.replace('://', `://${bucketName}.`) + `/${fileKey}`;
      }
    } else {
      // Standard AWS S3 public URL format
      const s3Region = process.env.AWS_REGION || 'us-east-1';
      fileUrl = `https://${bucketName}.s3.${s3Region}.amazonaws.com/${fileKey}`;
    }

    // Proactively clean up local temporary upload file
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

  // Local fallback: Return the relative path used by Express static middleware
  // e.g. "/uploads/playlist-xxx.jpg"
  return '/' + localFilePath.replace(/\\/g, '/');
}
