import { createHmac } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from './firebase-admin';

export const COINS_PER_GENERATION = 10;

export interface GenerationReservation {
  generationId: string;
  userId: string;
  premium: boolean;
}

export function normalizeIndianPhone(input: unknown): string {
  if (typeof input !== 'string') throw new Error('Enter a valid Indian mobile number.');
  const digits = input.replace(/\D/g, '');
  const normalized = digits.length === 10
    ? `+91${digits}`
    : digits.length === 12 && digits.startsWith('91')
      ? `+${digits}`
      : input.startsWith('+') && /^\+91[6-9]\d{9}$/.test(input)
        ? input
        : '';
  if (!/^\+91[6-9]\d{9}$/.test(normalized)) {
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  }
  return normalized;
}

function phoneIndex(phoneNumber: string): string {
  const secret = process.env.PHONE_INDEX_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('PHONE_INDEX_SECRET must be set to a random secret of at least 32 characters.');
  }
  return createHmac('sha256', secret).update(phoneNumber).digest('hex');
}

export async function createRegisteredUser(
  uid: string,
  verifiedPhone: string,
  requestedPhone: unknown,
  nameInput: unknown
) {
  const phoneNumber = normalizeIndianPhone(requestedPhone);
  if (phoneNumber !== normalizeIndianPhone(verifiedPhone)) {
    throw new Error('The verified phone number does not match.');
  }
  if (typeof nameInput !== 'string' || nameInput.trim().length < 2 || nameInput.trim().length > 80) {
    throw new Error('Full name must be between 2 and 80 characters.');
  }

  const db = getFirestoreDb();
  const userRef = db.collection('users').doc(uid);
  const indexRef = db.collection('phoneIndex').doc(phoneIndex(phoneNumber));
  const welcomeTransaction = db.collection('transactions').doc();
  const now = Timestamp.now();

  await db.runTransaction(async transaction => {
    const [userSnapshot, indexSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(indexRef)
    ]);
    if (userSnapshot.exists || indexSnapshot.exists) {
      throw new Error('An account already exists for this phone number. Please log in.');
    }

    transaction.create(userRef, {
      name: nameInput.trim(),
      phoneNumber,
      firebaseUid: uid,
      coins: 100,
      totalClipsGenerated: 0,
      coinsUsed: 0,
      isPremium: false,
      subscriptionExpiry: null,
      createdAt: now,
      updatedAt: now
    });
    transaction.create(indexRef, { uid, createdAt: now });
    transaction.create(welcomeTransaction, {
      userId: uid,
      type: 'CREDIT',
      amount: 100,
      reason: 'Welcome bonus',
      createdAt: now
    });
  });

  return getAccount(uid);
}

export async function getAccount(uid: string) {
  const snapshot = await getFirestoreDb().collection('users').doc(uid).get();
  if (!snapshot.exists) return null;
  const user = snapshot.data()!;
  const expiry = user['subscriptionExpiry'] as Timestamp | null;
  const premiumActive = Boolean(
    user['isPremium'] && expiry && expiry.toMillis() > Date.now()
  );
  return {
    id: uid,
    name: user['name'],
    phoneNumber: user['phoneNumber'],
    coins: Number(user['coins'] || 0),
    totalClipsGenerated: Number(user['totalClipsGenerated'] || 0),
    coinsUsed: Number(user['coinsUsed'] || 0),
    isPremium: premiumActive,
    subscriptionExpiry: expiry?.toDate().toISOString() || null,
    premiumExpired: Boolean(user['isPremium'] && expiry && !premiumActive),
    createdAt: (user['createdAt'] as Timestamp).toDate().toISOString()
  };
}

export async function reserveGeneration(
  uid: string,
  generationId: string
): Promise<GenerationReservation> {
  if (!/^[\w-]{8,100}$/.test(generationId)) {
    throw new Error('A valid generation request ID is required.');
  }
  const db = getFirestoreDb();
  const userRef = db.collection('users').doc(uid);
  const generationRef = db.collection('generations').doc(generationId);
  const now = Timestamp.now();

  return db.runTransaction(async transaction => {
    const [userSnapshot, generationSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(generationRef)
    ]);
    if (!userSnapshot.exists) throw new Error('Register an account before generating clips.');
    if (generationSnapshot.exists) {
      throw new Error('This generation request was already submitted.');
    }

    const user = userSnapshot.data()!;
    const expiry = user['subscriptionExpiry'] as Timestamp | null;
    const premium = Boolean(user['isPremium'] && expiry && expiry.toMillis() > now.toMillis());
    const coins = Number(user['coins'] || 0);
    if (!premium && coins < COINS_PER_GENERATION) {
      throw new Error('INSUFFICIENT_COINS');
    }

    const debitTransaction = premium
      ? null
      : db.collection('transactions').doc();
    const generationData = {
      userId: uid,
      status: 'PROCESSING',
      premium,
      charge: premium ? 0 : COINS_PER_GENERATION,
      debitTransactionId: debitTransaction?.id || null,
      createdAt: now,
      updatedAt: now
    };
    transaction.create(generationRef, generationData);

    if (!premium) {
      transaction.update(userRef, {
        coins: coins - COINS_PER_GENERATION,
        coinsUsed: FieldValue.increment(COINS_PER_GENERATION),
        updatedAt: now
      });
      transaction.create(debitTransaction!, {
        userId: uid,
        type: 'DEBIT',
        amount: COINS_PER_GENERATION,
        reason: 'Clip generation reserved',
        generationId,
        status: 'RESERVED',
        createdAt: now
      });
    }
    return { generationId, userId: uid, premium };
  });
}

export async function registerUploadedVideo(uid: string, filename: string, size: number) {
  const now = Timestamp.now();
  await getFirestoreDb().collection('videoUploads').doc(filename).create({
    userId: uid,
    status: 'UPLOADED',
    size,
    createdAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000)
  });
}

export async function claimUploadedVideo(uid: string, filename: string, generationId: string) {
  const db = getFirestoreDb();
  const uploadRef = db.collection('videoUploads').doc(filename);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(uploadRef);
    if (!snapshot.exists || snapshot.data()?.['userId'] !== uid) return false;
    if (snapshot.data()?.['status'] !== 'UPLOADED') return false;
    transaction.update(uploadRef, {
      status: 'PROCESSING',
      generationId,
      updatedAt: Timestamp.now()
    });
    return true;
  });
}

export async function updateUploadedVideo(
  filename: string,
  status: 'FAILED' | 'COMPLETED',
  jobId?: string
) {
  await getFirestoreDb().collection('videoUploads').doc(filename).update({
    status,
    ...(jobId ? { jobId } : {}),
    updatedAt: Timestamp.now()
  });
}

export async function completeGeneration(
  reservation: GenerationReservation,
  clipCount: number,
  jobId: string,
  clipDetails: Array<{
    filename: string;
    duration: number;
    start: number;
    end: number;
    interestScore: number;
  }>
) {
  const db = getFirestoreDb();
  const userRef = db.collection('users').doc(reservation.userId);
  const generationRef = db.collection('generations').doc(reservation.generationId);
  const now = Timestamp.now();
  await db.runTransaction(async transaction => {
    const [userSnapshot, generationSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(generationRef)
    ]);
    if (!userSnapshot.exists || !generationSnapshot.exists) {
      throw new Error('Generation wallet reservation was not found.');
    }

    const generation = generationSnapshot.data()!;
    if (generation['status'] === 'COMPLETED') return;
    if (generation['status'] !== 'PROCESSING') {
      throw new Error('Generation wallet reservation is no longer active.');
    }
    if (generation['debitTransactionId']) {
      transaction.update(
        db.collection('transactions').doc(generation['debitTransactionId'] as string),
        { status: 'COMPLETED', updatedAt: now }
      );
    }
    transaction.update(userRef, {
      totalClipsGenerated: FieldValue.increment(clipCount),
      updatedAt: now
    });
    transaction.update(generationRef, {
      status: 'COMPLETED',
      clipCount,
      jobId,
      clipDetails,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000),
      completedAt: now,
      updatedAt: now
    });
  });
}

export async function refundStaleGenerations() {
  const db = getFirestoreDb();
  const cutoff = Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
  const snapshot = await db.collection('generations')
    .where('status', '==', 'PROCESSING')
    .where('createdAt', '<', cutoff)
    .limit(50)
    .get();
  for (const doc of snapshot.docs) {
    const generation = doc.data();
    await refundGeneration({
      generationId: doc.id,
      userId: generation['userId'] as string,
      premium: Boolean(generation['premium'])
    }, 'Processing did not finish; automatic stale-job refund.');
  }
  return snapshot.size;
}

export async function refundGeneration(
  reservation: GenerationReservation,
  reason: string
) {
  const db = getFirestoreDb();
  const userRef = db.collection('users').doc(reservation.userId);
  const generationRef = db.collection('generations').doc(reservation.generationId);
  const now = Timestamp.now();
  await db.runTransaction(async transaction => {
    const [userSnapshot, generationSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(generationRef)
    ]);
    if (!userSnapshot.exists || !generationSnapshot.exists) return;
    const generation = generationSnapshot.data()!;
    if (generation['status'] !== 'PROCESSING') return;

    if (Number(generation['charge']) > 0) {
      const refundRef = db.collection('transactions').doc();
      transaction.update(userRef, {
        coins: FieldValue.increment(Number(generation['charge'])),
        coinsUsed: FieldValue.increment(-Number(generation['charge'])),
        updatedAt: now
      });
      transaction.create(refundRef, {
        userId: reservation.userId,
        type: 'REFUND',
        amount: Number(generation['charge']),
        reason,
        generationId: reservation.generationId,
        createdAt: now
      });
      if (generation['debitTransactionId']) {
        transaction.update(
          db.collection('transactions').doc(generation['debitTransactionId'] as string),
          { status: 'REFUNDED', updatedAt: now }
        );
      }
    }
    transaction.update(generationRef, {
      status: 'FAILED',
      failureReason: reason.slice(0, 500),
      updatedAt: now
    });
  });
}

export async function listTransactions(uid: string) {
  const snapshot = await getFirestoreDb().collection('transactions')
    .where('userId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  return snapshot.docs.map(doc => {
    const value = doc.data();
    return {
      id: doc.id,
      ...value,
      createdAt: (value['createdAt'] as Timestamp).toDate().toISOString()
    };
  });
}

export async function listGenerationHistory(uid: string) {
  const snapshot = await getFirestoreDb().collection('generations')
    .where('userId', '==', uid)
    .where('status', '==', 'COMPLETED')
    .orderBy('completedAt', 'desc')
    .limit(30)
    .get();
  return snapshot.docs.map(doc => {
    const value = doc.data();
    return {
      id: doc.id,
      ...value,
      createdAt: (value['createdAt'] as Timestamp).toDate().toISOString(),
      completedAt: (value['completedAt'] as Timestamp).toDate().toISOString(),
      expiresAt: (value['expiresAt'] as Timestamp | undefined)?.toDate().toISOString() || null
    };
  });
}
