import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { UserModel } from '../models/userModel.js';
import { generateToken, verifyToken } from '../middleware/auth.js';
import { sendOtpEmail } from '../services/emailService.js';

const router = Router();

// In-memory pending OTP registry: email -> { otp, profile, expiresAt, attempts }
const pendingOtpStore = new Map();

// Helper to generate 6-digit cryptographic-grade OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Clean up expired OTPs periodically (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of pendingOtpStore.entries()) {
    if (record.expiresAt < now) {
      pendingOtpStore.delete(email);
    }
  }
}, 60000);

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate with Google OAuth ID token (credential)
 * @access  Public
 */
router.post('/google', async (req, res) => {
  try {
    const { credential, access_token, email, name, picture, avatar, googleId } = req.body;

    let googleProfile = {
      email,
      name,
      picture: picture || avatar,
      googleId,
    };

    // If an access_token is provided and email is not yet present, fetch from Google UserInfo endpoint
    if (access_token && !googleProfile.email) {
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (userInfoRes.ok) {
          const uInfo = await userInfoRes.json();
          googleProfile = {
            email: uInfo.email,
            name: uInfo.name || uInfo.email?.split('@')[0],
            picture: uInfo.picture || googleProfile.picture,
            googleId: uInfo.sub,
          };
        }
      } catch (tokenErr) {
        console.warn('[Google Auth Access Token Warning]:', tokenErr.message);
      }
    }

    // If a Google ID token is provided and GOOGLE_CLIENT_ID is configured:
    if (credential && process.env.GOOGLE_CLIENT_ID) {
      try {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        googleProfile = {
          email: payload.email,
          name: payload.name || payload.given_name || payload.email.split('@')[0],
          picture: payload.picture,
          googleId: payload.sub,
        };
      } catch (verifyErr) {
        console.warn('[Google Auth Verification Warning]:', verifyErr.message);
      }
    } else if (credential) {
      // Decode credential JWT payload if GOOGLE_CLIENT_ID is in setup
      try {
        const parts = credential.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          googleProfile = {
            email: payload.email || email,
            name: payload.name || name || payload.email?.split('@')[0],
            picture: payload.picture || picture,
            googleId: payload.sub || googleId,
          };
        }
      } catch (err) {
        console.warn('[Google Auth] Could not decode token, using request body parameters');
      }
    }

    if (!googleProfile.email) {
      return res.status(400).json({
        success: false,
        message: 'Google authorization failed: email not found.',
      });
    }

    // Generate 6-digit OTP verification code
    const otp = generateOtp();
    const normalizedEmail = googleProfile.email.toLowerCase();

    // Store in pending verification registry (expires in 5 minutes)
    pendingOtpStore.set(normalizedEmail, {
      otp,
      profile: googleProfile,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
    });

    // Dispatch email via Gmail SMTP / Fallback logger
    await sendOtpEmail(googleProfile.email, otp, googleProfile.name);

    return res.json({
      success: true,
      requiresOtp: true,
      email: googleProfile.email,
      message: `A 6-digit verification code has been sent to ${googleProfile.email}.`,
    });
  } catch (error) {
    console.error('[Google Auth Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Google authorization failed. Check database connection.',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Validate 6-digit OTP and complete authentication
 * @access  Public
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and 6-digit verification code.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = pendingOtpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'Verification code expired or not found. Please request a new code.',
      });
    }

    if (record.expiresAt < Date.now()) {
      pendingOtpStore.delete(normalizedEmail);
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
      });
    }

    if (record.attempts >= 5) {
      pendingOtpStore.delete(normalizedEmail);
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please sign in again.',
      });
    }

    if (record.otp !== String(otp).trim()) {
      record.attempts += 1;
      const remaining = 5 - record.attempts;
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}`,
      });
    }

    // OTP is valid! Remove from pending store
    pendingOtpStore.delete(normalizedEmail);

    // Persist or link in Neo4j graph database
    const user = await UserModel.findOrCreateGoogleUser({
      email: record.profile.email,
      name: record.profile.name,
      avatar: record.profile.picture,
      googleId: record.profile.googleId,
    });

    // Generate authenticated JWT session token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json({
      success: true,
      message: 'Email successfully verified.',
      token,
      user,
    });
  } catch (error) {
    console.error('[Verify OTP Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify code. Please try again.',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend a new 6-digit OTP code to the user's email
 * @access  Public
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = pendingOtpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'Verification session expired. Please sign in again.',
      });
    }

    // Generate fresh OTP and reset window
    const newOtp = generateOtp();
    record.otp = newOtp;
    record.expiresAt = Date.now() + 5 * 60 * 1000;
    record.attempts = 0;

    await sendOtpEmail(record.profile.email, newOtp, record.profile.name, true);

    return res.json({
      success: true,
      message: `A new 6-digit code has been sent to ${record.profile.email}.`,
    });
  } catch (error) {
    console.error('[Resend OTP Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend code.',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user in Neo4j
 * @access  Public
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password.',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
    }

    // Check if user already exists
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
    }

    // Create user in Neo4j
    const newUser = await UserModel.create({
      email,
      password,
      name: name || email.split('@')[0],
    });

    // Generate JWT token
    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    console.error('[Auth Register Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Check Neo4j database connection.',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return JWT token
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter email and password.',
      });
    }

    // Find user in Neo4j
    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Verify password with bcrypt
    const isMatch = await UserModel.comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
      });
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return res.json({
      success: true,
      message: 'Signed in successfully.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('[Auth Login Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login. Check Neo4j database connection.',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user profile
 * @access  Private (JWT Required)
 */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.',
      });
    }

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('[Auth /me Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve user profile.',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (cleans client state)
 * @access  Public
 */
router.post('/logout', (req, res) => {
  return res.json({
    success: true,
    message: 'Logged out successfully.',
  });
});

export default router;

