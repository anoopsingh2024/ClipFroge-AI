import { Injectable } from '@angular/core';
import {
  Auth,
  ConfirmationResult,
  RecaptchaVerifier,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut
} from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  private firebaseAuth: Auth | null = null;
  private recaptchaVerifier: RecaptchaVerifier | null = null;

  get isConfigured(): boolean {
    const config = environment.firebase;
    return Boolean(
      config.apiKey &&
      config.projectId &&
      config.appId &&
      !config.apiKey.startsWith('YOUR_')
    );
  }

  get auth(): Auth {
    if (!this.isConfigured) {
      throw new Error(
        'Firebase is not configured. Add your Firebase web app values to src/environments/environment.ts.'
      );
    }
    if (!this.firebaseAuth) {
      const app = getApps()[0] || initializeApp(environment.firebase);
      this.firebaseAuth = getAuth(app);
    }
    return this.firebaseAuth;
  }

  get userState(): Observable<User | null> {
    return new Observable(subscriber =>
      onAuthStateChanged(
        this.auth,
        user => subscriber.next(user),
        error => subscriber.error(error)
      )
    );
  }

  async sendOtp(phoneNumber: string): Promise<ConfirmationResult> {
    this.clearRecaptcha();
    const verifier = new RecaptchaVerifier(this.auth, 'recaptcha-container', {
      size: 'invisible'
    });
    this.recaptchaVerifier = verifier;
    await verifier.render();
    return signInWithPhoneNumber(this.auth, phoneNumber, verifier);
  }

  async getIdToken(): Promise<string | null> {
    return this.auth.currentUser?.getIdToken() || null;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.clearRecaptcha();
  }

  clearRecaptcha(): void {
    this.recaptchaVerifier?.clear();
    this.recaptchaVerifier = null;
    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';
  }

  normalizePhone(value: string): string {
    const input = value.trim();
    const digits = input.replace(/\D/g, '');
    const normalized = digits.length === 10
      ? `+91${digits}`
      : digits.length === 12 && digits.startsWith('91')
        ? `+${digits}`
        : input;
    if (!/^\+91[6-9]\d{9}$/.test(normalized)) {
      throw new Error('Enter a valid 10-digit Indian mobile number.');
    }
    return normalized;
  }
}
