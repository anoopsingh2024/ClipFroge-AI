
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import videoRoutes from './routes/video.routes';
import editorRoutes from './routes/editor.routes';
import accountRoutes from './routes/account.routes';
import paymentRoutes, { webhookRouter } from './routes/payments.routes';
import adminRoutes from './routes/admin.routes';
import { refundStaleGenerations } from './services/wallet';

const app = express();

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true
  })
);

// Razorpay signature verification requires the unparsed request body.
app.use('/api/payments/webhook', webhookRouter);

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
app.use('/api/account', accountRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

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
      musicLibrary: true,
      authentication: true,
      wallet: true,
      payments: true
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

app.listen(PORT, () => {
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_PROJECT_ID
  );
  if (firebaseConfigured) {
    setInterval(() => {
      void refundStaleGenerations()
        .then(count => {
          if (count) console.warn(`[WALLET] Refunded ${count} stale generation reservation(s).`);
        })
        .catch(error => console.error('[WALLET] Stale reservation recovery failed:', error));
    }, 15 * 60 * 1000).unref();
  }
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
