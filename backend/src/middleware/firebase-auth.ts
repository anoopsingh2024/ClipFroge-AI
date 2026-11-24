import { NextFunction, Request, Response } from 'express';
import { getFirebaseAdminAuth } from '../services/firebase-admin';

export interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    phoneNumber: string;
    claims: Record<string, unknown>;
  };
}

export async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authorization = req.header('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ success: false, message: 'Please sign in to continue.' });
    return;
  }

  try {
    const claims = await getFirebaseAdminAuth().verifyIdToken(match[1]!, true);
    if (!claims.phone_number) {
      res.status(401).json({ success: false, message: 'Verified phone authentication is required.' });
      return;
    }
    (req as AuthenticatedRequest).authUser = {
      uid: claims.uid,
      phoneNumber: claims.phone_number,
      claims: claims as Record<string, unknown>
    };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Firebase Admin is not configured|FIREBASE_SERVICE_ACCOUNT_JSON/i.test(message)) {
      console.error('[AUTH] Firebase Admin configuration is missing.');
      res.status(503).json({
        success: false,
        message: 'Authentication service is not configured on the server.'
      });
      return;
    }
    console.error('[AUTH] Firebase token verification failed:', message);
    res.status(401).json({
      success: false,
      message: 'Your session is invalid or expired. Please sign in again.'
    });
  }
}
