import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary from environment variables
if (process.env.CLOUDINARY_URL) {
  cloudinary.config();
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'fukpn05e',
    api_key: process.env.CLOUDINARY_API_KEY || '461777117981126',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'aP3TWt13tvvrLlVB_tNQT0l_ku4',
    secure: true,
  });
}

/**
 * Checks if Cloudinary credentials are fully configured
 */
export function isCloudinaryConfigured() {
  if (process.env.CLOUDINARY_URL && process.env.CLOUDINARY_URL.startsWith('cloudinary://')) {
    return true;
  }
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET &&
    process.env.CLOUDINARY_API_SECRET !== 'your_api_secret_here'
  );
}

/**
 * Extract Cloudinary public_id from a URL
 * e.g. https://res.cloudinary.com/fukpn05e/image/upload/v12345/uandwelabs/cms/sample.jpg -> uandwelabs/cms/sample
 */
export function extractPublicId(url) {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    let pathPart = parts[1];
    // Remove version tag (e.g. v1732338292/)
    pathPart = pathPart.replace(/^v\d+\//, '');
    // Remove file extension
    const dotIndex = pathPart.lastIndexOf('.');
    if (dotIndex !== -1) {
      pathPart = pathPart.substring(0, dotIndex);
    }
    return pathPart;
  } catch {
    return null;
  }
}

/**
 * Upload an image (base64 or remote URL) to Cloudinary and optionally delete the previous image
 */
export async function uploadToCloudinary(base64Data, filename = 'image', previousUrl = null) {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary credentials (CLOUDINARY_API_SECRET) not yet configured in .env');
  }

  // 1. If a previous Cloudinary image exists, automatically destroy it to keep storage 100% clean
  if (previousUrl) {
    const oldPublicId = extractPublicId(previousUrl);
    if (oldPublicId) {
      try {
        await cloudinary.uploader.destroy(oldPublicId);
        console.log(`[Cloudinary] Successfully deleted previous image: ${oldPublicId}`);
      } catch (delErr) {
        console.warn(`[Cloudinary] Warning: Could not delete previous image (${oldPublicId}):`, delErr.message);
      }
    }
  }

  // 2. Upload new image with automatic optimization (auto webp/avif, auto quality)
  const cleanName = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const uploadOptions = {
    folder: 'uandwelabs/cms',
    public_id: `${cleanName}_${Date.now()}`,
    resource_type: 'image',
    fetch_format: 'auto',
    quality: 'auto',
  };

  const result = await cloudinary.uploader.upload(base64Data, uploadOptions);

  return {
    success: true,
    url: result.secure_url,
    public_id: result.public_id,
    format: result.format,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
  };
}

export default cloudinary;
