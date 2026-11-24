import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import cmsRoutes from './routes/cms.js';
import { initNeo4j, closeNeo4j } from './config/neo4j.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// CORS configuration (allow Vite frontend, admin, and all Vercel domains)
const allowedOrigins = [
  'http://localhost:5174',
  'http://localhost:5173',
  'http://localhost:5175',
  'https://uandwelabs.vercel.app',
  'https://uandwelabs-backend.vercel.app',
  'https://uandwelabs-admin-rho.vercel.app'
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost')
    ) {
      return callback(null, true);
    }
    return callback(null, true); // Dev/permissive fallback
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-passcode', 'Accept'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsing middleware (25MB limit for CMS image uploads)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'UandWe Labs Backend API is live',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      cms: '/api/cms',
      auth: '/api/auth',
    },
  });
});

// Health & Status endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'UandWe Labs Backend API',
    database: 'Neo4j Graph Database',
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/cms', cmsRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start Express server in standalone / local mode (avoid port binding on Vercel serverless)
if (!process.env.VERCEL) {
  const server = app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`🚀 UandWe Labs Backend running on port ${PORT}`);
    console.log(`📡 Base API URL: http://localhost:${PORT}/api`);
    console.log(`⚡ Neo4j URI: ${process.env.NEO4J_URI || 'neo4j://localhost:7687'}`);
    console.log(`===============================================`);

    // Initialize Neo4j connectivity
    await initNeo4j().catch((err) => {
      console.warn('[Neo4j] Initial connection warning:', err.message);
    });
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down gracefully...');
    await closeNeo4j().catch(() => {});
    server.close(() => {
      console.log('[Server] HTTP service closed.');
      process.exit(0);
    });
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Server] Terminating gracefully...');
    await closeNeo4j().catch(() => {});
    server.close(() => {
      process.exit(0);
    });
  });
}

export default app;

