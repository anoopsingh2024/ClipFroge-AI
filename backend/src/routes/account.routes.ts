import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, requireFirebaseAuth } from '../middleware/firebase-auth';
import {
  createRegisteredUser,
  getAccount,
  listGenerationHistory,
  listTransactions
} from '../services/wallet';

const router = Router();
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many account requests. Try again later.' }
});

function currentUser(req: AuthenticatedRequest, res: Response) {
  if (!req.authUser) {
    res.status(401).json({ success: false, message: 'Please sign in to continue.' });
    return null;
  }
  return req.authUser;
}

router.post(
  '/register',
  accountLimiter,
  requireFirebaseAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = currentUser(req, res);
      if (!user) return;
      const account = await createRegisteredUser(
        user.uid,
        user.phoneNumber,
        req.body?.phoneNumber,
        req.body?.name
      );
      return res.status(201).json({ success: true, account });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists/i.test(message)) {
        return res.status(409).json({ success: false, message });
      }
      if (/valid Indian|verified phone|full name/i.test(message)) {
        return res.status(400).json({ success: false, message });
      }
      console.error('[ACCOUNT] Registration failed:', message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create your account. Please try again.'
      });
    }
  }
);

router.get('/me', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const account = await getAccount(user.uid);
    if (!account) {
      return res.status(404).json({
        success: false,
        registered: false,
        message: 'No ClipForge account exists for this phone number. Please register.'
      });
    }
    return res.json({ success: true, account });
  } catch (error) {
    console.error('[ACCOUNT] Profile lookup failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load your account.' });
  }
});

router.get('/transactions', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const transactions = await listTransactions(user.uid);
    return res.json({ success: true, transactions });
  } catch (error) {
    console.error('[ACCOUNT] Transaction history failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load transaction history.' });
  }
});

router.get('/history', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = currentUser(req, res);
    if (!user) return;
    const history = await listGenerationHistory(user.uid);
    return res.json({ success: true, history });
  } catch (error) {
    console.error('[ACCOUNT] Clip history failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load clip history.' });
  }
});

export default router;
