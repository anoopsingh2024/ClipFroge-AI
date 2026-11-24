import { createHmac, timingSafeEqual } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from './firebase-admin';

const Razorpay = require('razorpay');

export interface CoinPackage {
  id: string;
  coins: number;
  priceRupees: number;
  label: string;
}

export const PREMIUM_PRICE_RUPEES = 100;
export const PREMIUM_VALIDITY_DAYS = 90;
const PACKAGE_SETTINGS_PATH = 'settings/coinPackages';

const DEFAULT_PACKAGES: CoinPackage[] = [
  { id: 'coins-100', coins: 100, priceRupees: 49, label: '100 Coins' },
  { id: 'coins-250', coins: 250, priceRupees: 99, label: '250 Coins' },
  { id: 'coins-500', coins: 500, priceRupees: 179, label: '500 Coins' },
  { id: 'coins-1000', coins: 1000, priceRupees: 299, label: '1000 Coins' }
];

function validateCoinPackages(value: unknown): CoinPackage[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Coin packages must be a non-empty array.');
  }
  const packages = value.map((item, index) => {
    const entry = item as Partial<CoinPackage>;
    if (
      typeof entry.id !== 'string' ||
      !/^[a-z0-9-]{2,40}$/.test(entry.id) ||
      !Number.isSafeInteger(entry.coins) || Number(entry.coins) <= 0 ||
      Number(entry.coins) > 10_000_000 ||
      !Number.isSafeInteger(entry.priceRupees) || Number(entry.priceRupees) <= 0 ||
      Number(entry.priceRupees) > 1_000_000 ||
      typeof entry.label !== 'string' || entry.label.trim().length < 2 ||
      entry.label.length > 60
    ) {
      throw new Error(`Invalid coin package at index ${index}.`);
    }
    return entry as CoinPackage;
  });
  if (new Set(packages.map(item => item.id)).size !== packages.length) {
    throw new Error('Coin package IDs must be unique.');
  }
  return packages;
}

export function getCoinPackages(): CoinPackage[] {
  const configured = process.env.COIN_PACKAGES_JSON?.trim();
  if (!configured) return DEFAULT_PACKAGES;
  let value: unknown;
  try {
    value = JSON.parse(configured);
  } catch (error) {
    throw new Error('COIN_PACKAGES_JSON must contain valid JSON.', { cause: error });
  }
  return validateCoinPackages(value);
}

export async function getActiveCoinPackages(): Promise<CoinPackage[]> {
  const settings = await getFirestoreDb().doc(PACKAGE_SETTINGS_PATH).get();
  if (settings.exists) {
    return validateCoinPackages(settings.data()?.['packages']);
  }
  return getCoinPackages();
}

export async function updateCoinPackages(input: unknown): Promise<CoinPackage[]> {
  const packages = validateCoinPackages(input);
  await getFirestoreDb().doc(PACKAGE_SETTINGS_PATH).set({
    packages,
    updatedAt: Timestamp.now()
  });
  return packages;
}

export function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured. Add test-mode API keys to backend/.env.');
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function createPaymentOrder(
  uid: string,
  purchase: { type: 'COINS'; packageId: string } | { type: 'PREMIUM' }
) {
  const db = getFirestoreDb();
  const user = await db.collection('users').doc(uid).get();
  if (!user.exists) throw new Error('Register an account before purchasing.');

  const packageInfo = purchase.type === 'COINS'
    ? (await getActiveCoinPackages()).find(item => item.id === purchase.packageId)
    : undefined;
  if (purchase.type === 'COINS' && !packageInfo) {
    throw new Error('The selected coin package is not available.');
  }

  const amountRupees = purchase.type === 'PREMIUM'
    ? PREMIUM_PRICE_RUPEES
    : packageInfo!.priceRupees;
  const amount = amountRupees * 100;
  const order = await getRazorpay().orders.create({
    amount,
    currency: 'INR',
    receipt: `cf-${uid.slice(0, 12)}-${Date.now()}`.slice(0, 40),
    notes: {
      userId: uid,
      purchaseType: purchase.type,
      packageId: packageInfo?.id || '',
      coins: String(packageInfo?.coins || 0)
    }
  });
  await db.collection('paymentOrders').doc(order.id).create({
    userId: uid,
    razorpayOrderId: order.id,
    amount,
    currency: 'INR',
    paymentType: purchase.type,
    packageId: packageInfo?.id || null,
    coins: packageInfo?.coins || 0,
    status: 'CREATED',
    createdAt: Timestamp.now()
  });
  return {
    orderId: order.id,
    amount,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID,
    package: packageInfo || null,
    paymentType: purchase.type
  };
}

export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !/^[\w|]+$/.test(orderId) || !/^[\w|]+$/.test(paymentId)) return false;
  const expected = createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function verifyAndFulfillPayment(
  uid: string,
  orderId: string,
  paymentId: string
) {
  const orderSnapshot = await getFirestoreDb().collection('paymentOrders').doc(orderId).get();
  if (!orderSnapshot.exists || orderSnapshot.data()?.['userId'] !== uid) {
    throw new Error('Payment order was not found for this account.');
  }
  const order = orderSnapshot.data()!;
  const existingPayment = await getFirestoreDb().collection('payments').doc(paymentId).get();
  if (existingPayment.exists) {
    const existing = existingPayment.data()!;
    if (existing['razorpayOrderId'] !== orderId || existing['userId'] !== uid) {
      throw new Error('Payment ID has already been used.');
    }
    return { alreadyProcessed: true, paymentType: order['paymentType'] };
  }
  const payment = await getRazorpay().payments.fetch(paymentId);
  if (
    payment['order_id'] !== orderId ||
    payment['status'] !== 'captured' ||
    Number(payment['amount']) !== Number(order['amount']) ||
    payment['currency'] !== order['currency']
  ) {
    throw new Error('Payment is not captured or does not match the order.');
  }
  return fulfillCapturedPayment(orderId, paymentId);
}

export async function verifyWebhookAndFulfillPayment(orderId: string, paymentId: string) {
  const orderSnapshot = await getFirestoreDb().collection('paymentOrders').doc(orderId).get();
  if (!orderSnapshot.exists) throw new Error('Payment order does not exist.');
  const order = orderSnapshot.data()!;
  const existingPayment = await getFirestoreDb().collection('payments').doc(paymentId).get();
  if (existingPayment.exists) {
    const existing = existingPayment.data()!;
    if (existing['razorpayOrderId'] !== orderId || existing['userId'] !== order['userId']) {
      throw new Error('Payment ID has already been used.');
    }
    return { alreadyProcessed: true, paymentType: order['paymentType'] };
  }
  const payment = await getRazorpay().payments.fetch(paymentId);
  if (
    payment['order_id'] !== orderId ||
    payment['status'] !== 'captured' ||
    Number(payment['amount']) !== Number(order['amount']) ||
    payment['currency'] !== order['currency']
  ) {
    throw new Error('Webhook payment does not match a captured order.');
  }
  return fulfillCapturedPayment(orderId, paymentId);
}

export async function fulfillCapturedPayment(orderId: string, paymentId: string) {
  const db = getFirestoreDb();
  const orderRef = db.collection('paymentOrders').doc(orderId);
  const paymentRef = db.collection('payments').doc(paymentId);
  const now = Timestamp.now();
  const transactionRef = db.collection('transactions').doc();
  const subscriptionRef = db.collection('subscriptions').doc(paymentId);

  return db.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new Error('Payment order does not exist.');
    const order = orderSnapshot.data()!;
    const userRef = db.collection('users').doc(order['userId'] as string);
    const [paymentSnapshot, userSnapshot] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(userRef)
    ]);
    if (!userSnapshot.exists) throw new Error('Payment account does not exist.');
    if (paymentSnapshot.exists) {
      const existing = paymentSnapshot.data()!;
      if (existing['razorpayOrderId'] !== orderId || existing['userId'] !== order['userId']) {
        throw new Error('Payment ID has already been used.');
      }
      return { alreadyProcessed: true, paymentType: order['paymentType'] };
    }
    if (order['status'] === 'PAID') {
      throw new Error('This order was already paid with a different payment ID.');
    }
    const user = userSnapshot.data()!;
    transaction.create(paymentRef, {
      userId: order['userId'],
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      amount: order['amount'],
      currency: order['currency'],
      status: 'CAPTURED',
      paymentType: order['paymentType'],
      createdAt: now
    });
    transaction.update(orderRef, {
      status: 'PAID',
      razorpayPaymentId: paymentId,
      paidAt: now
    });

    if (order['paymentType'] === 'COINS') {
      const coins = Number(order['coins']);
      if (!Number.isSafeInteger(coins) || coins <= 0) {
        throw new Error('Payment order contains an invalid coin amount.');
      }
      transaction.update(userRef, {
        coins: FieldValue.increment(coins),
        updatedAt: now
      });
      transaction.create(transactionRef, {
        userId: order['userId'],
        type: 'CREDIT',
        amount: coins,
        reason: 'Purchased coins',
        paymentId,
        createdAt: now
      });
      return { alreadyProcessed: false, paymentType: 'COINS', coins };
    }

    if (order['paymentType'] !== 'PREMIUM') {
      throw new Error('Unsupported payment type.');
    }
    const currentExpiry = user['subscriptionExpiry'] as Timestamp | null;
    const renewalStart = currentExpiry && currentExpiry.toMillis() > now.toMillis()
      ? currentExpiry.toMillis()
      : now.toMillis();
    const expiry = Timestamp.fromMillis(
      renewalStart + PREMIUM_VALIDITY_DAYS * 24 * 60 * 60 * 1000
    );
    transaction.update(userRef, {
      isPremium: true,
      subscriptionExpiry: expiry,
      updatedAt: now
    });
    transaction.create(subscriptionRef, {
      userId: order['userId'],
      plan: 'PREMIUM_90_DAYS',
      amount: order['amount'],
      startDate: Timestamp.fromMillis(renewalStart),
      expiryDate: expiry,
      status: 'ACTIVE',
      paymentId,
      createdAt: now
    });
    transaction.create(transactionRef, {
      userId: order['userId'],
      type: 'SUBSCRIPTION',
      amount: PREMIUM_PRICE_RUPEES,
      currency: 'INR',
      reason: `Premium subscription · ${PREMIUM_VALIDITY_DAYS} days`,
      paymentId,
      createdAt: now
    });
    return { alreadyProcessed: false, paymentType: 'PREMIUM', expiryDate: expiry.toDate().toISOString() };
  });
}

export async function listAdminUsers(limit = 100) {
  const snapshot = await getFirestoreDb().collection('users').orderBy('createdAt', 'desc').limit(limit).get();
  return snapshot.docs.map(doc => {
    const data = doc.data();
    const expiry = data['subscriptionExpiry'] as Timestamp | null;
    return {
      id: doc.id,
      name: data['name'],
      phoneNumber: data['phoneNumber'],
      coins: data['coins'],
      totalClipsGenerated: data['totalClipsGenerated'],
      isPremium: Boolean(data['isPremium'] && expiry && expiry.toMillis() > Date.now()),
      subscriptionExpiry: expiry?.toDate().toISOString() || null,
      createdAt: (data['createdAt'] as Timestamp).toDate().toISOString()
    };
  });
}

export async function adminAdjustCoins(
  adminUid: string,
  userId: string,
  amount: number,
  reason: string
) {
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) {
    throw new Error('Coin adjustment must be a non-zero integer up to 100,000.');
  }
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 300) {
    throw new Error('Provide an audit reason between 5 and 300 characters.');
  }
  const db = getFirestoreDb();
  const userRef = db.collection('users').doc(userId);
  const transactionRef = db.collection('transactions').doc();
  const now = Timestamp.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) throw new Error('User was not found.');
    const coins = Number(snapshot.data()?.['coins'] || 0);
    if (coins + amount < 0) throw new Error('Coin adjustment cannot make the balance negative.');
    transaction.update(userRef, { coins: coins + amount, updatedAt: now });
    transaction.create(transactionRef, {
      userId,
      type: amount > 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(amount),
      reason: `Admin adjustment: ${reason.trim()}`,
      adminUid,
      createdAt: now
    });
  });
}
