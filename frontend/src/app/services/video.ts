
import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpRequest
} from '@angular/common/http';

import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class VideoService {

  readonly API_URL = 'http://localhost:5000/api/videos';

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
      {}
    );
  }

  processVideoUrl(url: string): Observable<any> {
    return this.http.post(
      `${this.API_URL}/process-url`,
      { url }
    );
  }

  getClipUrl(url: string): string {
    if (!url) return '';

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const cleanPath = url.replace(/^\/+/, '');

    if (cleanPath.startsWith('api/videos/')) {
      return `http://localhost:5000/${cleanPath}`;
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