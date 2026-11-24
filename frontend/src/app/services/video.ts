
import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpRequest
} from '@angular/common/http';

import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class VideoService {

  readonly API_URL = `${environment.apiUrl}/videos`;

  constructor(private http: HttpClient) {}

  uploadVideo(file: File): Observable<HttpEvent<any>> {
    const formData = new FormData();

    formData.append('video', file);

    const request = new HttpRequest(
      'POST',
      `${this.API_URL}/upload`,
      formData,
      {
        reportProgress: true
      }
    );

    return this.http.request(request);
  }

  processVideo(filename: string): Observable<any> {
    return this.http.post(
      `${this.API_URL}/process/${encodeURIComponent(filename)}`,
      {},
      { headers: { 'Idempotency-Key': crypto.randomUUID() } }
    );
  }

  processVideoUrl(url: string): Observable<any> {
    return this.http.post(
      `${this.API_URL}/process-url`,
      { url },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } }
    );
  }

  getClipUrl(url: string): string {
    if (!url) return '';

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const cleanPath = url.replace(/^\/+/, '');

    if (cleanPath.startsWith('api/videos/')) {
      return `${environment.apiUrl.replace(/\/api$/, '')}/${cleanPath}`;
    }

    return `${this.API_URL}/${cleanPath}`;
  }

  getDownloadUrl(url: string): string {
    return this.getClipUrl(url);
  }

  downloadAllClips(jobId: string): Observable<Blob> {
    return this.http.get(
      `${this.API_URL}/download/${encodeURIComponent(jobId)}`,
      {
        responseType: 'blob'
      }
    );
  }
}