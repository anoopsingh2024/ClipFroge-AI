# ClipFroge-AI

## Video rendering configuration

The AI renderer keeps the original 9:16 composition and applies the selected
grade and effects only to the final foreground/background composition. The
foreground remains a separate sharp layer while the fitted background receives
the stronger blur.

Optional environment variables:

```env
CLIPFORGE_BACKGROUND_BLUR=35
CLIPFORGE_BACKGROUND_BLUR_PASSES=2
CLIPFORGE_EFFECT_INTENSITY=medium
```

`CLIPFORGE_EFFECT_INTENSITY` accepts `low`, `medium` (default), or `high`.
Each rendered clip now reports its selected `filter`, `effects`, and
`backgroundBlur` metadata while preserving the existing `selectedEffects`
field for API compatibility.

Automatic highlights are 30–60 seconds long. Each clip also gets a distinct
color-gradient background palette (including black/orange, green, blue/cyan,
purple/pink, and other combinations), blended with the blurred source layer.
The selected palette is returned as `backgroundStyle` and `backgroundColors`
in each clip's metadata.

The timeline interest graph also contributes directly to clip ranking. Local
graph peaks are detected by prominence, added as a scoring signal, and exposed
as `interestPeak`/`peakProminence` on timeline points. The upload timeline
highlights selected clip regions and graph peaks with a legend.

## Hindi and English captions

Speech recognition uses Faster-Whisper's multilingual transcription mode with
language auto-detection, word timestamps, VAD, deterministic decoding, and a
beam size of 5. The default model is `small` instead of `tiny` to improve Hindi,
English, and mixed-language recognition. Set `CLIPFORGE_WHISPER_MODEL=medium`
in `backend/.env` for more accurate transcription when the machine has enough
memory and processing time; the model is downloaded the first time it runs.
Speech recognition cannot guarantee a completely error-free transcript, so
review captions before publishing when exact wording is important.

Available automatic grades include cinematic teal/orange, Hollywood warm,
dark cinematic, moody blue, film look, vintage cinema, dramatic contrast,
vibrant, natural, clean creator, travel, professional portrait, gaming
punchy, retro, dreamy glow, neon, black and white, sepia, soft glow, and
HDR-style.

## Automatic music library

The backend includes 60 original synthesized, royalty-safe MP3 tracks. Tracks
are selected automatically by the detected video mood:

- Motivational
- Cinematic
- Funny
- Calm

The Python renderer rotates through mood-matching catalog entries instead of
repeating the same track for every clip. Catalog tracks are validated with
FFprobe before use. The library is licensed as `CC0`/ClipForge original
synthesized material in `backend/music/catalog.json`.

## Phone authentication, wallet, and Premium

The app uses Firebase Phone Authentication in Angular and verifies Firebase ID
tokens in Express with Firebase Admin. User profiles, unique phone indexes,
wallet transactions, generation reservations, orders, payments, and
subscriptions are stored in Firestore. `firestore.rules` denies direct client
database access; all wallet and payment writes go through the trusted backend.

### Firebase setup

1. Create a Firebase project and enable **Authentication → Phone**.
2. Add `localhost` under Firebase Authentication authorized domains.
3. Add development test phone numbers and their test codes under the Phone
   provider's test-number settings. Test numbers do not receive SMS; enter the
   code configured in Firebase. Use a real phone number to test SMS delivery.
4. Create a Firestore database and deploy `firestore.rules` and
   `firestore.indexes.json` with `firebase deploy --only firestore --project YOUR_PROJECT_ID`.
5. Copy `frontend/src/environments/environment.example.ts` to
   `frontend/src/environments/environment.ts` (or update the existing file)
   and enter the Firebase **Web app** config. These browser configuration
   values are public identifiers, not Admin credentials.
6. Copy `backend/.env.example` to `backend/.env`. Set `FIREBASE_PROJECT_ID`
   and either `FIREBASE_SERVICE_ACCOUNT_JSON` to a protected, single-line
   service-account JSON value or `GOOGLE_APPLICATION_CREDENTIALS` to a
   service-account file kept outside version control. Generate a separate
   random `PHONE_INDEX_SECRET` of at least 32 characters; phone-number lookup
   indexes use this HMAC secret rather than a reversible plain hash.
7. Add comma-separated Firebase Auth UIDs to `ADMIN_UIDS` for backend admin
   access. Admin routes verify both the Firebase token and this allowlist.

### Razorpay setup

1. Use Razorpay **Test Mode** and set `RAZORPAY_KEY_ID` and
   `RAZORPAY_KEY_SECRET` in `backend/.env`.
2. Create a Razorpay webhook pointing to
   `https://YOUR_PUBLIC_BACKEND/api/payments/webhook`, configure a separate
   webhook signing secret, and subscribe to `payment.captured`.
   For local development, expose the backend with a trusted HTTPS tunnel and
   use that URL for the webhook.
3. Set `RAZORPAY_WEBHOOK_SECRET` to the webhook signing secret. Checkout
   benefits are granted only after signature verification and the Razorpay
   API confirms the payment is captured. Enable automatic payment capture in
   the Razorpay test account so verified checkout payments reach `captured`.
4. Default coin packages are 100/₹49, 250/₹99, 500/₹179, and 1000/₹299.
   Override them with `COIN_PACKAGES_JSON`, or update them through the
   authenticated admin `PUT /api/admin/coin-packages` endpoint. Premium costs
   ₹100 for 90 days.

### Run locally

```bash
# Terminal 1
cd backend
copy .env.example .env
npm install
npm run dev

# Terminal 2
cd frontend
npm install
npm start
```

In PowerShell use `Copy-Item .env.example .env` if `copy` is not available.
Configure the Python virtual environment and FFmpeg as described above before
processing a video. Test registration/login with Firebase's configured test
phone number and code; then check the 100-coin welcome credit, create a clip
(10 coins reserved, refunded on processing failure), and purchase coins or the
90-day Premium plan using Razorpay test cards. Premium expiry is evaluated
against backend time; unused coins remain in the wallet.

The dashboard is available at `/dashboard`, phone registration/login at
`/auth`, and clip creation at `/upload`. Protected admin endpoints are
`GET /api/admin/users`, `GET /api/admin/stats`,
`GET /api/admin/payments`, `POST /api/admin/users/:userId/coins`, and
`PUT /api/admin/coin-packages`.