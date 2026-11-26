
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import videoRoutes from './routes/video.routes';
import editorRoutes from './routes/editor.routes';
import textVideoRoutes from './routes/text-video.routes';

const app = express();
app.set('trust proxy', 1);

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

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

// Video API routes
app.use('/api/videos', videoRoutes);

// Video Editor API routes
app.use('/api/editor', editorRoutes);
app.use('/api/text-video', textVideoRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClipForge AI Backend is running 🚀',
    services: {
      videoProcessing: true,
      videoEditor: true,
      filters: 50,
      effects: 50,
      animations: 5,
      musicLibrary: true
    }
  });
});

// Global error handler
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

    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Something went wrong'
    });
  }
);

// Start server
const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('====================================');
  console.log('🚀 ClipForge AI Backend Started');
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`❤️ http://localhost:${PORT}/api/health`);
  console.log(`🎬 http://localhost:${PORT}/api/videos`);
  console.log(`🎨 http://localhost:${PORT}/api/editor/catalog`);
  console.log('====================================');
  console.log('');
});
