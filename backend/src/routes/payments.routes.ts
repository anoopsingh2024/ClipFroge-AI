import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest, requireFirebaseAuth } from '../middleware/firebase-auth';
import {
  createPaymentOrder,
  getActiveCoinPackages,
  verifyAndFulfillPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  verifyWebhookAndFulfillPayment
} from '../services/payments';

const router = Router();
const webhookRouter = Router();
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests. Try again later.' }
});

router.get('/packages', async (_req, res) => {
  try {
    return res.json({
      success: true,
      packages: await getActiveCoinPackages(),
      premium: { priceRupees: 100, validityDays: 90 }
    });
  } catch (error) {
    console.error('[PAYMENTS] Could not load packages:', error);
    return res.status(500).json({ success: false, message: 'Unable to load purchase options.' });
  }
});

router.post(
  '/order',
  paymentLimiter,
  requireFirebaseAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const body = req.body as { type?: string; packageId?: string };
      const purchase = body.type === 'PREMIUM'
        ? { type: 'PREMIUM' as const }
        : body.type === 'COINS' && typeof body.packageId === 'string'
          ? { type: 'COINS' as const, packageId: body.packageId }
          : null;
      if (!purchase) {
        return res.status(400).json({ success: false, message: 'Select a valid coin package or Premium plan.' });
      }
      const order = await createPaymentOrder(user.uid, purchase);
      return res.status(201).json({ success: true, ...order });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PAYMENTS] Order creation failed:', message);
      const status = /not configured/i.test(message) ? 503 : 400;
      return res.status(status).json({ success: false, message });
    }
  }
);

router.post(
  '/verify',
  paymentLimiter,
  requireFirebaseAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } =
      req.body || {};
    if (
      typeof orderId !== 'string' ||
      typeof paymentId !== 'string' ||
      typeof signature !== 'string' ||
      !verifyCheckoutSignature(orderId, paymentId, signature)
    ) {
      return res.status(400).json({ success: false, message: 'Payment signature verification failed.' });
    }
    try {
      const result = await verifyAndFulfillPayment(req.authUser!.uid, orderId, paymentId);
      return res.json({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PAYMENTS] Verification failed:', message);
      return res.status(400).json({ success: false, message });
    }
  }
);

webhookRouter.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req: Request, res: Response) => {
    const signature = req.header('x-razorpay-signature') || '';
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).send('Invalid webhook signature.');
    }
    try {
      const event = JSON.parse(rawBody.toString('utf8')) as {
        event?: string;
        payload?: {
          payment?: { entity?: Record<string, unknown> };
        };
      };
      if (event.event !== 'payment.captured') {
        return res.status(200).json({ received: true, ignored: true });
      }
      const payment = event.payload?.payment?.entity;
      const orderId = String(payment?.['order_id'] || '');
      const paymentId = String(payment?.['id'] || '');
      if (
        !orderId ||
        !paymentId ||
        (payment && payment['status'] !== 'captured')
      ) {
        return res.status(400).json({ received: false, message: 'Captured payment details are missing.' });
      }
      await verifyWebhookAndFulfillPayment(orderId, paymentId);
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('[PAYMENTS] Webhook processing failed:', error);
      return res.status(500).json({ received: false });
    }
  }
);

export { webhookRouter };
export default router;
