import express from 'express';
import {
  getCmsContent,
  updateCmsContent,
  resetCmsContent,
  saveMediaUpload,
} from '../services/cmsService.js';

const router = express.Router();

const VALID_ADMIN_PASSCODES = ['uandwe2026', 'admin'];

/**
 * Confidential Admin Passcode Validation Middleware
 */
function requireAdminPasscode(req, res, next) {
  const passcode =
    req.headers['x-admin-passcode'] ||
    req.body?.passcode ||
    req.query?.passcode;

  if (!passcode || !VALID_ADMIN_PASSCODES.includes(passcode.toString().trim())) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Valid Admin Passcode required to modify CMS data.',
    });
  }

  next();
}

/**
 * @route   GET /api/cms
 * @desc    Fetch active CMS content for all pages
 * @access  Public (so visitors get the published site content)
 */
router.get('/', async (req, res) => {
  try {
    const result = await getCmsContent();
    res.json({
      success: true,
      data: result.data,
      source: result.source,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    console.error('[CMS Route Error - GET]:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve CMS content',
      error: error.message,
    });
  }
});

/**
 * @route   PUT /api/cms
 * @desc    Save/publish updated CMS content across all pages
 * @access  Protected (Admin Passcode)
 */
router.put('/', requireAdminPasscode, async (req, res) => {
  try {
    const { data, updatedBy } = req.body;
    if (!data) {
      return res.status(400).json({
        success: false,
        message: 'Missing "data" field in request body',
      });
    }

    const result = await updateCmsContent(data, updatedBy || 'admin');
    res.json({
      success: true,
      message: 'CMS content saved and synchronized successfully',
      source: result.source,
      updatedAt: result.updatedAt,
      data: result.data,
    });
  } catch (error) {
    console.error('[CMS Route Error - PUT]:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update CMS content',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/cms/reset
 * @desc    Reset all CMS content back to factory default seed data
 * @access  Protected (Admin Passcode)
 */
router.post('/reset', requireAdminPasscode, async (req, res) => {
  try {
    const result = await resetCmsContent(req.body?.updatedBy || 'admin');
    res.json({
      success: true,
      message: 'CMS content restored to system factory defaults',
      source: result.source,
      updatedAt: result.updatedAt,
      data: result.data,
    });
  } catch (error) {
    console.error('[CMS Route Error - RESET]:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset CMS content',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/cms/upload
 * @desc    Upload an image asset directly from Admin Console to frontend/public
 * @access  Protected (Admin Passcode)
 */
router.post('/upload', requireAdminPasscode, async (req, res) => {
  try {
    const { filename, base64Data, previousUrl } = req.body;
    if (!filename || !base64Data) {
      return res.status(400).json({
        success: false,
        message: 'Both filename and base64Data are required',
      });
    }

    const result = await saveMediaUpload(filename, base64Data, previousUrl);
    res.json({
      success: true,
      message: 'Media asset uploaded successfully',
      filename: result.filename,
      path: result.path,
      size: result.size,
    });
  } catch (error) {
    console.error('[CMS Route Error - UPLOAD]:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload media asset',
    });
  }
});

export default router;
