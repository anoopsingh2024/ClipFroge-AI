import { Router, Response } from 'express';
import { AuthenticatedRequest, requireFirebaseAuth } from '../middleware/firebase-auth';
import { getFirestoreDb } from '../services/firebase-admin';
import { adminAdjustCoins, listAdminUsers, updateCoinPackages } from '../services/payments';
import { Timestamp } from 'firebase-admin/firestore';

const router = Router();

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
  const admins = (process.env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!req.authUser || !admins.includes(req.authUser.uid)) {
    res.status(403).json({ success: false, message: 'Administrator access is required.' });
    return false;
  }
  return true;
}

router.use(requireFirebaseAuth);

router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    return res.json({ success: true, users: await listAdminUsers() });
  } catch (error) {
    console.error('[ADMIN] User listing failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load users.' });
  }
});

router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const db = getFirestoreDb();
    const [users, payments, generations] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('payments').count().get(),
      db.collection('generations').where('status', '==', 'COMPLETED').count().get()
    ]);
    return res.json({
      success: true,
      stats: {
        registeredUsers: users.data().count,
        capturedPayments: payments.data().count,
        successfulGenerations: generations.data().count
      }
    });
  } catch (error) {
    console.error('[ADMIN] Statistics lookup failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load statistics.' });
  }
});

router.get('/payments', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const snapshot = await getFirestoreDb().collection('payments').orderBy('createdAt', 'desc').limit(100).get();
    return res.json({
      success: true,
      payments: snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: (data['createdAt'] as Timestamp).toDate().toISOString()
        };
      })
    });
  } catch (error) {
    console.error('[ADMIN] Payment listing failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to load payment history.' });
  }
});

router.post('/users/:userId/coins', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    await adminAdjustCoins(
      req.authUser!.uid,
      String(req.params['userId'] || ''),
      Number(req.body?.amount),
      req.body?.reason
    );
    return res.json({ success: true, message: 'Wallet adjustment recorded.' });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Wallet adjustment failed.'
    });
  }
});

router.put('/coin-packages', async (req: AuthenticatedRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const packages = await updateCoinPackages(req.body?.packages);
    return res.json({ success: true, packages });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Could not update packages.'
    });
  }
});

export default router;
