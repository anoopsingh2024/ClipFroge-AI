
import cors from 'cors';
import type { RequestHandler } from 'express';

const allowedOrigins = new Set([
  'https://clipfroge-ai.netlify.app',
  'http://localhost:4200',
  'http://127.0.0.1:4200'
]);

const netlifyDeployPreviewOrigin =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?--clipfroge-ai\.netlify\.app$/i;

function isAllowedOrigin(origin: string): boolean {
  return (
    allowedOrigins.has(origin) ||
    netlifyDeployPreviewOrigin.test(origin)
  );
}

export const corsMiddleware: RequestHandler = cors({
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin is not allowed.'));
  },
  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
  ],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With'
  ],
  optionsSuccessStatus: 204,
  credentials: true,
  maxAge: 86400
});

export const rejectDisallowedOrigins: RequestHandler = (
  req,
  res,
  next
) => {
  const origin = req.get('Origin');

  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({
      success: false,
      message: 'Origin is not allowed.'
    });
  }

  next();
};
