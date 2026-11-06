import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'uandwelabs_jwt_secret_key_2026_super_secure';

/**
 * Middleware to verify JWT token in Authorization header
 */
export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authorization token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token.',
      error: error.message,
    });
  }
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

