import { ChangeDetectorRef, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { environment } from '../../../environments/environment';

interface GeneratedClip {
  filename: string;
  duration: number;
  start: number;
  end: number;
  score?: number;
  interestScore?: number;
  path?: string;
  url?: string;
  previewUrl?: string;
  videoUrl?: string;
  absoluteUrl?: string;
  downloadUrl?: string;
  absoluteDownloadUrl?: string;
  mood?: string;
  music?: unknown;
  filter?: string;
  backgroundStyle?: string;
  backgroundColors?: string[];
  effects?: string[];
  captionCount?: number;
  backgroundBlur?: unknown;
}

interface ProcessingResult {
  success: boolean;
  message: string;
  totalClips: number;
  highlightCount?: number;
  duration: number;
  language: string;
  clips: GeneratedClip[];
  highlights?: GeneratedClip[];
  jobId: string;
  downloadUrl: string;
  downloadUrlAbsolute?: string;
  expiresInMinutes: number;
  timeline?: unknown[];
  analysis?: unknown;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  private readonly API_URL = `${environment.apiUrl}/videos`;

  isProcessing = false;
  isDownloading = false;
  result: ProcessingResult | null = null;
  processingError = '';

  constructor(
    private http: HttpClient,
    private changeDetector: ChangeDetectorRef
  ) {}

  processVideoUrl(url: string): void {
    const videoUrl = url.trim();

    if (!videoUrl) {
      alert('Please paste a YouTube or Facebook video URL.');
      return;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      alert('Please enter a valid video URL.');
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    const isYouTube =
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be';

    const isFacebook =
      hostname === 'facebook.com' ||
      hostname.endsWith('.facebook.com') ||
      hostname === 'fb.watch';

    if (!isYouTube && !isFacebook) {
      alert('Only YouTube and Facebook URLs are supported.');
      return;
    }

    if (this.isProcessing) return;

    this.isProcessing = true;
    this.result = null;
    this.processingError = '';

    this.http.post<ProcessingResult>(
      `${this.API_URL}/process-url`,
      { url: videoUrl }
    ).pipe(
      finalize(() => {
        this.isProcessing = false;
        this.changeDetector.detectChanges();
      })
    ).subscribe({
      next: (response) => {
        const payload = (response as ProcessingResult & {
          body?: ProcessingResult;
        })?.body ?? response;
        const clips = Array.isArray(payload?.clips) && payload.clips.length
          ? payload.clips
          : Array.isArray(payload?.highlights)
            ? payload.highlights
            : [];

        if (!payload?.success || !payload.jobId || clips.length === 0) {
          this.processingError =
            payload?.message || 'No highlight clips were generated.';
          alert(this.processingError);
          this.changeDetector.detectChanges();
          return;
        }

        this.result = {
          ...payload,
          clips,
          highlights: clips,
          totalClips:
            payload.totalClips ??
            payload.highlightCount ??
            clips.length
        };
        this.changeDetector.detectChanges();
      },

      error: (error) => {
        console.error('Video URL processing error:', error);
        this.processingError =
          error?.error?.error ||
          error?.error?.message ||
          'Unable to process this video.';

        alert(this.processingError);
        this.changeDetector.detectChanges();
      }
    });
  }

  resolveClipUrl(clip: GeneratedClip): string {
    const url =
      clip.previewUrl ||
      clip.url ||
      clip.path ||
      clip.videoUrl ||
      clip.absoluteUrl ||
      '';

    if (!url) return '';

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return `${environment.apiUrl.replace(/\/api$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  resolveClipDownloadUrl(clip: GeneratedClip): string {
    const url = clip.absoluteDownloadUrl || clip.downloadUrl || '';

    if (!url) return '';

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return `${environment.apiUrl.replace(/\/api$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  downloadAllClips(): void {
    if (!this.result?.jobId || this.isDownloading) return;

    this.isDownloading = true;

    const downloadUrl =
      this.result.downloadUrlAbsolute ||
      `${this.API_URL}/download/${encodeURIComponent(this.result.jobId)}`;

    this.http.get(downloadUrl, {
      responseType: 'blob'
    }).subscribe({
      next: (blob: Blob) => {
        this.isDownloading = false;

        if (!blob || blob.size === 0) {
          alert('Downloaded ZIP is empty. Please process your video again.');
          return;
        }

        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = objectUrl;
        link.download = 'ClipForge-AI-Clips.zip';

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
          window.URL.revokeObjectURL(objectUrl);
        }, 60000);

        alert('Your clips ZIP download has started!');
        this.result = null;
      },

      error: (error) => {
        this.isDownloading = false;

        console.error('Download error:', error);

        alert(
          error?.error?.message ||
          'Download failed or expired. Please generate your clips again.'
        );
      }
    });
  }
}