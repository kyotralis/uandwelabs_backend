import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import { initNeo4j, closeNeo4j } from './config/neo4j.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration (allow Vite frontend)
const allowedOrigins = [
  'http://localhost:5174',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Dev mode: allow all local origins
    },
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Start Express server and connect to Neo4j
const server = app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 UandWe Labs Backend running on port ${PORT}`);
  console.log(`📡 Base API URL: http://localhost:${PORT}/api`);
  console.log(`⚡ Neo4j URI: ${process.env.NEO4J_URI || 'neo4j://localhost:7687'}`);
  console.log(`===============================================`);

  // Initialize Neo4j connectivity
  await initNeo4j();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');
  await closeNeo4j();
  server.close(() => {
    console.log('[Server] HTTP service closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Terminating gracefully...');
  await closeNeo4j();
  server.close(() => {
    process.exit(0);
  });
});

export default app;

