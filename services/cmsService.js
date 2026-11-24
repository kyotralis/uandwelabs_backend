import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSession, writeQuery, readQuery } from '../config/neo4j.js';
import { DEFAULT_CMS_DATA } from '../data/defaultCms.js';
import { isCloudinaryConfigured, uploadToCloudinary } from '../config/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local JSON file path for ultra-resilient persistence
const DATA_DIR = path.resolve(__dirname, '../data');
const CMS_JSON_PATH = path.join(DATA_DIR, 'cmsData.json');

// Frontend and Admin public folder paths for uploaded media assets
const FRONTEND_PUBLIC_DIR = path.resolve(__dirname, '../../../frontend/public');
const ADMIN_PUBLIC_DIR = path.resolve(__dirname, '../../../admin/public');

/**
 * Ensure data directory and fallback JSON file exist
 */
function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CMS_JSON_PATH)) {
      fs.writeFileSync(CMS_JSON_PATH, JSON.stringify(DEFAULT_CMS_DATA, null, 2), 'utf8');
    }
  } catch (err) {
    // Read-only filesystem in Vercel/serverless environments - ignore safely
  }
}

/**
 * Deep merge utility to ensure nested structures and slide arrays are never lost
 */
export function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target?.[key];
    if (srcVal === undefined || srcVal === null) continue;
    if (Array.isArray(srcVal)) {
      result[key] = srcVal.length > 0 ? srcVal : (tgtVal && tgtVal.length > 0 ? tgtVal : srcVal);
    } else if (typeof srcVal === 'object' && typeof tgtVal === 'object' && !Array.isArray(tgtVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    for (const key of Object.keys(target)) {
      if (!(key in result) || result[key] === undefined) {
        result[key] = target[key];
      }
    }
  }
  return result;
}

/**
 * Clean up legacy or deprecated items from data structures
 */
function sanitizeCmsData(data) {
  if (!data || typeof data !== 'object') return data;

  // Unnest data if accidentally wrapped in { data: ... }
  while (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const inner = data.data;
    delete data.data;
    delete data.source;
    delete data.updatedAt;
    Object.assign(data, inner);
  }
  delete data.data;
  delete data.source;
  delete data.updatedAt;

  if (data.aura?.gallery && Array.isArray(data.aura.gallery)) {
    data.aura.gallery = data.aura.gallery.filter(
      (item) => !item.title?.toLowerCase().includes('biomimetic')
    );
  }
  if (data.dara?.gallery && Array.isArray(data.dara.gallery) && data.dara.gallery.length > 2) {
    data.dara.gallery = data.dara.gallery.slice(0, 2);
  }
  return data;
}

/**
 * Read CMS data from local file cache
 */
function readLocalCmsData() {
  ensureDataFile();
  try {
    if (fs.existsSync(CMS_JSON_PATH)) {
      const raw = fs.readFileSync(CMS_JSON_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return sanitizeCmsData(deepMerge(DEFAULT_CMS_DATA, parsed));
    }
  } catch (err) {
    console.error('[CMS Service] Error reading local CMS file:', err.message);
  }
  return sanitizeCmsData(DEFAULT_CMS_DATA);
}

/**
 * Write CMS data to local file cache
 */
function writeLocalCmsData(data) {
  ensureDataFile();
  try {
    fs.writeFileSync(CMS_JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[CMS Service] Error writing local CMS file:', err.message);
    return false;
  }
}

/**
 * Helper to enforce timeouts on external queries
 */
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Fetch current CMS content (Neo4j with File fallback)
 */
export async function getCmsContent() {
  ensureDataFile();
  const localData = readLocalCmsData();

  // Try Neo4j first with an 8000ms timeout for cold starts
  try {
    const records = await withTimeout(
      readQuery(
        `MATCH (c:CmsDocument { id: 'uandwe_cms_main' })
         RETURN c.payload AS payload, toString(c.updatedAt) AS updatedAt
         LIMIT 1`
      ),
      8000
    );

    if (records && records.length > 0) {
      const payloadStr = records[0].get('payload');
      if (payloadStr) {
        const parsed = JSON.parse(payloadStr);
        const merged = sanitizeCmsData(deepMerge(DEFAULT_CMS_DATA, parsed));
        // Preserve local sections if Neo4j record is missing them
        if (!merged.privacyPolicy && localData?.privacyPolicy) {
          merged.privacyPolicy = localData.privacyPolicy;
        }
        if (!merged.termsOfService && localData?.termsOfService) {
          merged.termsOfService = localData.termsOfService;
        }
        // Sync local file with updated record
        writeLocalCmsData(merged);
        return {
          data: merged,
          source: 'neo4j',
          updatedAt: records[0].get('updatedAt') || new Date().toISOString(),
        };
      }
    }
  } catch (neoErr) {
    console.warn('[CMS Service] Neo4j read unavailable, using local file cache:', neoErr.message);
  }

  // Fallback to local JSON file
  return {
    data: localData,
    source: 'local_file',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist updated CMS content (Dual-write: Neo4j + Local File)
 */
export async function updateCmsContent(nextData, updatedBy = 'admin') {
  if (!nextData || typeof nextData !== 'object') {
    throw new Error('Invalid CMS content payload');
  }

  const merged = sanitizeCmsData(deepMerge(DEFAULT_CMS_DATA, nextData));
  const payloadStr = JSON.stringify(merged);
  const now = new Date().toISOString();

  // 1. Immediately write to local file for zero-loss reliability
  writeLocalCmsData(merged);

  // 2. Dual-write to Neo4j with timeout
  let neo4jSaved = false;
  try {
    await withTimeout(
      writeQuery(
        `MERGE (c:CmsDocument { id: 'uandwe_cms_main' })
         SET c.payload = $payload,
             c.updatedAt = datetime(),
             c.updatedBy = $updatedBy
         RETURN c.id AS id`,
        { payload: payloadStr, updatedBy }
      ),
      10000
    );
    neo4jSaved = true;
    console.log('[CMS Service] Successfully synchronized CMS data to Neo4j');
  } catch (neoErr) {
    console.warn('[CMS Service] Neo4j write failed or timed out (saved to local file):', neoErr.message);
  }

  return {
    success: true,
    source: neo4jSaved ? 'neo4j' : 'local_file',
    updatedAt: now,
    data: merged,
  };
}

/**
 * Reset CMS content back to Default System Seed
 */
export async function resetCmsContent(updatedBy = 'admin') {
  return await updateCmsContent(DEFAULT_CMS_DATA, updatedBy);
}

/**
 * Save an uploaded media file (e.g. image from admin console)
 */
export async function saveMediaUpload(filename, base64Data, previousUrl = null) {
  if (!filename || !base64Data) {
    throw new Error('Filename and base64Data are required');
  }

  // 1. If Cloudinary is configured, upload to Cloudinary and clean up previous image
  if (isCloudinaryConfigured()) {
    try {
      console.log(`[CMS Service] Uploading ${filename} to Cloudinary...`);
      const cldResult = await uploadToCloudinary(base64Data, filename, previousUrl);
      console.log(`[CMS Service] Cloudinary upload successful: ${cldResult.url}`);
      return {
        success: true,
        filename: filename,
        path: cldResult.url,
        provider: 'cloudinary',
        public_id: cldResult.public_id,
        size: cldResult.bytes,
      };
    } catch (cldErr) {
      console.warn('[CMS Service] Cloudinary upload failed, falling back to local file storage:', cldErr.message);
    }
  }

  // 2. Ensure frontend public dir exists
  if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
    fs.mkdirSync(FRONTEND_PUBLIC_DIR, { recursive: true });
  }

  // Clean filename: remove slashes, spaces to underscores
  const cleanName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(cleanName).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'];

  if (!allowedExtensions.includes(ext)) {
    throw new Error(`File extension "${ext}" not supported. Use JPG, PNG, WEBP, or SVG.`);
  }

  // Remove data URL prefix if present (e.g. data:image/png;base64,...)
  const base64Clean = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  // Prevent overwriting: if exists, append timestamp
  let finalName = cleanName;
  let targetPath = path.join(FRONTEND_PUBLIC_DIR, finalName);

  if (fs.existsSync(targetPath)) {
    const baseWithoutExt = path.basename(cleanName, ext);
    finalName = `${baseWithoutExt}_${Date.now()}${ext}`;
    targetPath = path.join(FRONTEND_PUBLIC_DIR, finalName);
  }

  fs.writeFileSync(targetPath, buffer);
  try {
    if (!fs.existsSync(ADMIN_PUBLIC_DIR)) {
      fs.mkdirSync(ADMIN_PUBLIC_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(ADMIN_PUBLIC_DIR, finalName), buffer);
  } catch (err) {
    console.warn('[CMS Service] Note: could not mirror upload to admin/public:', err.message);
  }
  console.log(`[CMS Service] Saved uploaded media asset: ${finalName} (${buffer.length} bytes)`);

  return {
    success: true,
    filename: finalName,
    path: `/${finalName}`,
    size: buffer.length,
  };
}
