
import express from 'express';
import path from 'path';
import dotenv from 'dotenv';

import videoRoutes from './routes/video.routes';
import editorRoutes from './routes/editor.routes';
import textVideoRoutes from './routes/text-video.routes';

import {
  corsMiddleware,
  rejectDisallowedOrigins
} from './middleware/cors';

// Load environment variables
dotenv.config();

const app = express();

// Trust Render reverse proxy
app.set('trust proxy', 1);

// =====================================================
// CORS CONFIGURATION
// =====================================================

// CORS must run before origin validation and API routes
app.use(corsMiddleware);
app.use(rejectDisallowedOrigins);

// =====================================================
// BODY PARSERS
// =====================================================

app.use(
  express.json({
    limit: '10mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb'
  })
);

// =====================================================
// STATIC VIDEO DIRECTORIES
// =====================================================

// Uploaded videos
app.use(
  '/uploads',
  express.static(
    path.join(process.cwd(), 'uploads')
  )
);

// Processed videos
app.use(
  '/outputs',
  express.static(
    path.join(process.cwd(), 'outputs')
  )
);

// =====================================================
// ROOT ROUTE
// =====================================================

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClipForge AI Backend is Running',
    status: 'Live'
  });
});

// =====================================================
// API ROUTES
// =====================================================

// Video upload, download and AI processing
app.use('/api/videos', videoRoutes);

// Video editor
app.use('/api/editor', editorRoutes);

// Text to video
app.use('/api/text-video', textVideoRoutes);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClipForge AI API is working',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// 404 HANDLER
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
    path: req.originalUrl
  });
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('Backend Error:', err);

    if (res.headersSent) {
      return next(err);
    }

    const statusCode = err.status || err.statusCode || 500;

    res.status(statusCode).json({
      success: false,
      message:
        err.message || 'Something went wrong'
    });
  }
);

// =====================================================
// START SERVER
// =====================================================

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('====================================');
  console.log('🚀 ClipForge AI Backend Started');
  console.log(`🌐 Listening on port ${PORT}`);
  console.log('❤️  /api/health');
  console.log('🎬 /api/videos');
  console.log('🎨 /api/editor/catalog');
  console.log('📝 /api/text-video');
  console.log('====================================');
  console.log('');
});
