const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  getCoinPackages,
  verifyCheckoutSignature,
  verifyWebhookSignature
} = require('../dist/services/payments');
const { normalizeIndianPhone } = require('../dist/services/wallet');

test('normalizes valid Indian phone numbers and rejects invalid numbers', () => {
  assert.equal(normalizeIndianPhone('9876543210'), '+919876543210');
  assert.equal(normalizeIndianPhone('919876543210'), '+919876543210');
  assert.equal(normalizeIndianPhone('+919876543210'), '+919876543210');
  assert.throws(() => normalizeIndianPhone('12345'));
  assert.throws(() => normalizeIndianPhone('+12025550123'));
});

test('loads the configured default coin packages', () => {
  delete process.env.COIN_PACKAGES_JSON;
  assert.deepEqual(
    getCoinPackages().map(item => [item.coins, item.priceRupees]),
    [[100, 49], [250, 99], [500, 179], [1000, 299]]
  );
});

test('rejects duplicate or invalid configurable coin packages', () => {
  process.env.COIN_PACKAGES_JSON = JSON.stringify([
    { id: 'same', coins: 100, priceRupees: 49, label: '100 Coins' },
    { id: 'same', coins: 250, priceRupees: 99, label: '250 Coins' }
  ]);
  assert.throws(() => getCoinPackages(), /IDs must be unique/);
  process.env.COIN_PACKAGES_JSON = JSON.stringify([
    { id: 'bad', coins: -1, priceRupees: 49, label: 'Bad' }
  ]);
  assert.throws(() => getCoinPackages(), /Invalid coin package/);
  delete process.env.COIN_PACKAGES_JSON;
});

test('verifies Razorpay checkout signatures and rejects forged signatures', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';
  const orderId = 'order_test123';
  const paymentId = 'pay_test123';
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  assert.equal(verifyCheckoutSignature(orderId, paymentId, signature), true);
  assert.equal(verifyCheckoutSignature(orderId, paymentId, '0'.repeat(64)), false);
  delete process.env.RAZORPAY_KEY_SECRET;
});

test('verifies Razorpay webhook signatures against the raw body', () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-test-secret';
  const body = Buffer.from('{"event":"payment.captured"}');
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  assert.equal(verifyWebhookSignature(body, signature), true);
  assert.equal(verifyWebhookSignature(body, 'f'.repeat(64)), false);
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});
