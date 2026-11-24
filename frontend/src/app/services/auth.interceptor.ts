import { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { inject } from '@angular/core';
import { FirebaseAuthService } from './firebase-auth';

export const firebaseTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const firebase = inject(FirebaseAuthService);
  if (!request.url.includes('/api/') || !firebase.isConfigured) {
    return next(request);
  }

  return from(firebase.getIdToken()).pipe(
    switchMap(token => token
      ? next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
      : next(request))
  );
};
