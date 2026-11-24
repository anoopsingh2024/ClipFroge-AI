
import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { VideoService } from '../../services/video';

interface ProcessedClip {
  filename: string;
  path: string;
  url: string;
  downloadUrl: string;

  duration: number;
  start: number;
  end: number;

  score?: number;
  interestScore: number;
  captionCount: number;

  mood?: string;

  music?: {
    filename: string;
    licenseType: string;
    licenseUrl?: string;
    attribution?: string;
    mood?: string;
  } | null;

  selectedEffects?: string[];
  framing?: string;

  keyframeAnimation?: string;

  keyframes?: Array<{
    time: number;
    zoom: number;
  }>;
}

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './upload.html',
  styleUrl: './upload.scss'
})
export class Upload {

  selectedFile: File | null = null;

  isDragging = false;

  uploading = false;
  processing = false;
  downloading = false;

  uploadProgress = 0;

  errorMessage = '';
  authenticationRequired = false;
  successMessage = '';

  clips: ProcessedClip[] = [];

  timeline: any[] = [];

  totalClips = 0;

  jobId = '';

  expiresInMinutes = 30;

  processedVideoUrl = '';
  processedVideoFilename = '';

  readonly MAX_FILE_SIZE = 1024 * 1024 * 1024;

  constructor(
    private videoService: VideoService,
    private cdr: ChangeDetectorRef
  ) {}

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();

    this.isDragging = false;

    const files = event.dataTransfer?.files;

    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
      input.value = '';
    }
  }

  handleFile(file: File): void {
    if (this.uploading || this.processing) return;

    this.errorMessage = '';
    this.authenticationRequired = false;
    this.successMessage = '';

    this.clearResults();

    this.uploadProgress = 0;

    const allowedTypes = [
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ];

    if (!allowedTypes.includes(file.type)) {
      this.errorMessage =
        'Only MP4, MOV and WebM videos are allowed.';
      return;
    }

    if (file.size > this.MAX_FILE_SIZE) {
      this.errorMessage =
        'Video size cannot exceed 1 GB.';
      return;
    }

    this.selectedFile = file;

    console.log('Selected Video:', file.name);
    console.log('Video Size:', this.formatFileSize(file.size));

    this.cdr.detectChanges();
  }

  removeFile(): void {
    if (this.uploading || this.processing) return;

    this.selectedFile = null;

    this.uploadProgress = 0;

    this.errorMessage = '';
    this.authenticationRequired = false;
    this.successMessage = '';

    this.clearResults();

    this.cdr.detectChanges();
  }

  uploadVideo(): void {
    if (
      !this.selectedFile ||
      this.uploading ||
      this.processing
    ) {
      return;
    }

    this.uploading = true;
    this.processing = false;

    this.uploadProgress = 0;

    this.errorMessage = '';
    this.authenticationRequired = false;
    this.successMessage = '';

    this.clearResults();

    this.cdr.detectChanges();

    const fileToUpload = this.selectedFile;

    console.log('Starting video upload...');

    this.videoService.uploadVideo(fileToUpload).subscribe({

      next: (event: any) => {

        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total || fileToUpload.size;

          if (total > 0) {
            this.uploadProgress = Math.min(
              100,
              Math.round((event.loaded / total) * 100)
            );
          }

          this.cdr.detectChanges();
        }

        if (event.type === HttpEventType.Response) {
          const response = event.body;

          console.log('UPLOAD COMPLETED:', response);

          this.uploading = false;
          this.uploadProgress = 100;

          if (
            !response?.success ||
            !response.video?.filename
          ) {
            this.errorMessage =
              'Invalid video upload response.';

            this.cdr.detectChanges();
            return;
          }

          this.startProcessing(response.video.filename);
        }
      },

      error: (error: any) => {
        console.error('UPLOAD ERROR:', error);

        this.uploading = false;
        this.processing = false;

        this.authenticationRequired = error?.status === 401;
        this.errorMessage = this.authenticationRequired
          ? 'Please log in or register before uploading a video.'
          : error?.error?.message || 'Video upload failed. Please try again.';

        this.cdr.detectChanges();
      }

    });
  }

  startProcessing(filename: string): void {
    if (this.processing) return;

    this.uploading = false;
    this.uploadProgress = 100;

    this.processing = true;

    this.successMessage =
      'Upload complete! AI is finding the best moments and editing your clips...';

    this.errorMessage = '';

    this.cdr.detectChanges();

    console.log('PROCESSING FUNCTION CALLED:', filename);

    this.videoService.processVideo(filename).subscribe({

      next: (response: any) => {
        console.log('AI PROCESSING RESPONSE:', response);

        this.processing = false;

        if (
          !response?.success ||
          !Array.isArray(response.clips) ||
          response.clips.length === 0
        ) {
          this.errorMessage =
            response?.message ||
            'No interesting clips were generated.';

          this.successMessage = '';

          this.cdr.detectChanges();
          return;
        }

        this.jobId = response.jobId || '';

        this.expiresInMinutes =
          response.expiresInMinutes || 30;

        this.clips = response.clips.map((clip: any) => ({
          ...clip,

          url: this.videoService.getClipUrl(
            clip.url || clip.path
          ),

          path: clip.path || clip.url || '',

          downloadUrl: this.videoService.getClipUrl(
            clip.downloadUrl ||
            clip.url ||
            clip.path
          ),

          interestScore:
            clip.interestScore ?? clip.score ?? 0,

          captionCount:
            clip.captionCount ?? 0,

          selectedEffects:
            clip.selectedEffects ?? []
        }));

        this.timeline = Array.isArray(response.timeline)
          ? response.timeline
          : [];

        this.totalClips = this.clips.length;

        this.processedVideoUrl =
          this.clips[0].url;

        this.processedVideoFilename =
          this.clips[0].filename;

        this.successMessage =
          `${this.totalClips} highlight clip(s) are ready! 🎉`;

        this.cdr.detectChanges();
      },

      error: (error: any) => {
        console.error('AI PROCESSING ERROR:', error);

        this.processing = false;

        this.authenticationRequired = error?.status === 401;
        this.errorMessage = this.authenticationRequired
          ? 'Your login session has expired. Log in or register to continue.'
          : error?.error?.message ||
            error?.error?.error ||
            'Video processing failed. Please try again.';

        this.successMessage = '';

        this.cdr.detectChanges();
      }

    });
  }

  async downloadClip(clip: ProcessedClip): Promise<void> {
    if (!clip?.downloadUrl || this.downloading) return;

    this.downloading = true;

    this.errorMessage = '';

    this.cdr.detectChanges();

    try {
      const response = await fetch(clip.downloadUrl);

      if (!response.ok) {
        throw new Error(
          `Download failed (${response.status}).`
        );
      }

      const blob = await response.blob();

      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = objectUrl;

      link.download =
        clip.filename || 'clipforge-highlight.mp4';

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1500);

    } catch (error) {
      console.error('CLIP DOWNLOAD ERROR:', error);

      this.errorMessage =
        'Unable to download this clip. Please try again.';

    } finally {
      this.downloading = false;
      this.cdr.detectChanges();
    }
  }

  async downloadShort(): Promise<void> {
    const firstClip = this.clips[0];

    if (firstClip) {
      await this.downloadClip(firstClip);
      return;
    }

    if (!this.processedVideoUrl || this.downloading) {
      return;
    }

    this.downloading = true;
    this.errorMessage = '';

    this.cdr.detectChanges();

    try {
      const response = await fetch(this.processedVideoUrl);

      if (!response.ok) {
        throw new Error('Video download failed.');
      }

      const blob = await response.blob();

      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');

      link.href = objectUrl;

      link.download =
        this.processedVideoFilename || 'clipforge-short.mp4';

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1500);

    } catch (error) {
      console.error('DOWNLOAD ERROR:', error);

      this.errorMessage =
        'Unable to download video. Please try again.';

    } finally {
      this.downloading = false;
      this.cdr.detectChanges();
    }
  }

  downloadAllClips(): void {
    if (!this.jobId || this.downloading) return;

    this.downloading = true;
    this.errorMessage = '';

    this.cdr.detectChanges();

    this.videoService.downloadAllClips(this.jobId).subscribe({

      next: (blob: Blob) => {
        const objectUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');

        link.href = objectUrl;

        link.download = 'ClipForge-AI-Clips.zip';

        document.body.appendChild(link);

        link.click();

        link.remove();

        window.setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
        }, 1500);

        // Do not clear clips here.
        // They remain available until the 30-minute expiry.
      },

      error: (error: any) => {
        console.error('ZIP DOWNLOAD ERROR:', error);

        this.errorMessage =
          'Unable to download ZIP. Please try again.';
      },

      complete: () => {
        this.downloading = false;
        this.cdr.detectChanges();
      }

    });
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const units = ['Bytes', 'KB', 'MB', 'GB'];

    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    );

    return (
      parseFloat(
        (bytes / Math.pow(1024, index)).toFixed(2)
      ) +
      ' ' +
      units[index]
    );
  }

  private clearResults(): void {
    this.clips = [];
    this.timeline = [];
    this.totalClips = 0;

    this.jobId = '';

    this.processedVideoUrl = '';
    this.processedVideoFilename = '';
  }

  goBack(): void {
    window.history.back();
  }
}