
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

const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = new Set(
  (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .filter(origin => {
      if (!isProduction) return true;
      try {
        return !['localhost', '127.0.0.1', '[::1]'].includes(
          new URL(origin).hostname
        );
      } catch {
        return false;
      }
    })
);

if (!isProduction) {
  allowedOrigins.add('http://localhost:4200');
  allowedOrigins.add('http://127.0.0.1:4200');
}

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, !origin || allowedOrigins.has(origin));
    },
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

app.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClipForge AI Backend is Running',
    status: 'Live'
  });
});

// Video API routes
app.use('/api/videos', videoRoutes);

// Video Editor API routes
app.use('/api/editor', editorRoutes);
app.use('/api/text-video', textVideoRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'ClipForge AI API is working'
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
  console.log(`🌐 Listening on port ${PORT}`);
  console.log(`❤️ /api/health`);
  console.log(`🎬 /api/videos`);
  console.log(`🎨 /api/editor/catalog`);
  console.log('====================================');
  console.log('');
});
