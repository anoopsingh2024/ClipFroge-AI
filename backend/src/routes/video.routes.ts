import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { getYouTubeCookieArgs } from '../utils/yt-dlp-cookies';
const archiver: any = require('archiver');
const router = Router();
const BASE_DIR = path.resolve(__dirname, '../..');
const uploadDirectory = path.join(BASE_DIR, 'uploads');
const outputDirectory = path.join(BASE_DIR, 'outputs');
const aiEngineDirectory = path.join(BASE_DIR, 'ai_engine');
const FFMPEG_PATH =
  process.env.CLIPFORGE_FFMPEG ||
  (process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : '/usr/bin/ffmpeg');
const FFPROBE_PATH =
  process.env.CLIPFORGE_FFPROBE ||
  (process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffprobe.exe' : '/usr/bin/ffprobe');
const configuredPythonPath = process.env.CLIPFORGE_PYTHON?.trim();
const localWindowsPythonPath = path.join(
  BASE_DIR,
  'ai-venv',
  'Scripts',
  'python.exe'
);
const localLinuxPythonPath = path.join(
  BASE_DIR,
  'ai-venv',
  'bin',
  'python'
);
let resolvedPythonPath: string | undefined;
const PUBLIC_BACKEND_URL = (
  process.env.PUBLIC_BACKEND_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.NODE_ENV === 'production'
    ? ''
    : `http://localhost:${process.env.PORT || 5000}`)
).replace(/\/+$/, '');
const PYTHON_SCRIPT = path.join(
  aiEngineDirectory,
  'process_video.py'
);
const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;
const PROCESS_TIMEOUT_MS = 60 * 60 * 1000;
const JOB_EXPIRY_MS = 30 * 60 * 1000;
fs.mkdirSync(uploadDirectory, { recursive: true });
fs.mkdirSync(outputDirectory, { recursive: true });
const allowedMimeTypes = [
  'video/mp4',
  'video/webm',
  'video/quicktime'
];
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (_req, file, cb) => {
    const extension =
      path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(
      null,
      `clipforge-${Date.now()}-${randomUUID()}${extension}`
    );
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4, MOV and WebM videos are allowed.'));
    }
  }
});
interface DownloadJob {
  filenames: string[];
  timer: NodeJS.Timeout;
}
const downloadJobs = new Map<string, DownloadJob>();
// Prevent duplicate URL submissions from starting parallel downloads/AI jobs.
const activeUrlJobs = new Set<string>();
function isSafeLocalFilename(filename: string): boolean {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    path.basename(filename) === filename
  );
}
function getRouteParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore missing files and cleanup errors.*
  }
}

function runExternal(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let errorText = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} operation timed out.`));
    }, timeoutMs);
    child.stderr.on('data', data => {
      errorText += data.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(errorText.slice(-4000) || `${path.basename(command)} failed.`));
    });
  });
}

async function resolvePythonWithYtDlp(): Promise<string> {
  if (resolvedPythonPath) return resolvedPythonPath;
  const pythonCandidates = [
    configuredPythonPath,
    '/opt/clipforge-venv/bin/python',
    localWindowsPythonPath,
    localLinuxPythonPath,
    'python3',
    'python'
  ].filter((value, index, candidates): value is string =>
    Boolean(value) && candidates.indexOf(value) === index
  );
  const pythonErrors: string[] = [];

  for (const candidate of pythonCandidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      await runExternal(
        candidate,
        ['-c', 'import yt_dlp; print(yt_dlp.version.__version__)'],
        10_000
      );
      resolvedPythonPath = candidate;
      return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pythonErrors.push(`${candidate}: ${message}`);
    }
  }

  const checks = pythonErrors.length
    ? `Python checks: ${pythonErrors.join(' | ')}`
    : 'No configured or fallback Python executable was found.';
  throw new Error(
    `yt-dlp could not be imported by any available Python environment. Install it in the ` +
    `backend environment with "${configuredPythonPath || 'python'} -m pip install -U yt-dlp", ` +
    `or configure CLIPFORGE_PYTHON. ${checks}`
  );
}

async function runYtDlp(args: string[], timeoutMs: number): Promise<void> {
  const configuredYtDlp = process.env.CLIPFORGE_YTDLP?.trim();
  if (configuredYtDlp) {
    try {
      await runExternal(configuredYtDlp, args, timeoutMs);
      return;
    } catch (error) {
      console.warn(
        '[URL IMPORT] Configured CLIPFORGE_YTDLP executable failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const pythonPath = await resolvePythonWithYtDlp();
  await runExternal(pythonPath, ['-m', 'yt_dlp', ...args], timeoutMs);
}

async function normalizeDownloadedVideo(
  downloadedPath: string
): Promise<string> {
  await runExternal(
    FFPROBE_PATH,
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      downloadedPath
    ],
    30_000
  );

  const mp4Path = downloadedPath.replace(/\.[^.]+$/, '.mp4');
  if (path.extname(downloadedPath).toLowerCase() === '.mp4' &&
      fs.existsSync(mp4Path)) {
    return downloadedPath;
  }

  try {
    await runExternal(
      FFMPEG_PATH,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', downloadedPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c', 'copy',
        '-movflags', '+faststart',
        mp4Path
      ],
      20 * 60 * 1000
    );
  } catch (remuxError) {
    await removeFile(mp4Path);
    console.warn(
      '[URL IMPORT] Lossless MP4 remux unavailable; transcoding for compatibility.'
    );
    try {
      await runExternal(
        FFMPEG_PATH,
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', downloadedPath,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '21',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          mp4Path
        ],
        20 * 60 * 1000
      );
    } catch (transcodeError) {
      const remuxMessage = remuxError instanceof Error
        ? remuxError.message
        : String(remuxError);
      const transcodeMessage = transcodeError instanceof Error
        ? transcodeError.message
        : String(transcodeError);
      throw new Error(
        `MP4 remux failed: ${remuxMessage}; compatibility transcode failed: ${transcodeMessage}`
      );
    }
  }

  const stat = await fs.promises.stat(mp4Path);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`FFmpeg could not normalize downloaded video: ${downloadedPath}`);
  }
  await removeFile(downloadedPath);
  return mp4Path;
}
async function removeGeneratedFiles(
  filenames: string[]
): Promise<void> {
  await Promise.all(
    filenames
      .filter(isSafeLocalFilename)
      .map(filename =>
        removeFile(path.join(outputDirectory, filename))
      )
  );
}
async function cleanupJob(jobId: string): Promise<void> {
  const job = downloadJobs.get(jobId);
  if (!job) return;
  clearTimeout(job.timer);
  downloadJobs.delete(jobId);
  await removeGeneratedFiles(job.filenames);
  console.log(`[CLEANUP] Temporary clips deleted: ${jobId}`);
}
function createDownloadJob(filenames: string[]): string {
  const jobId = randomUUID();
  const timer = setTimeout(() => {
    void cleanupJob(jobId);
  }, JOB_EXPIRY_MS);
  downloadJobs.set(jobId, {
    filenames,
    timer
  });
  return jobId;
}
function checkProcessingDependencies(): string | null {
  if (!fs.existsSync(PYTHON_SCRIPT)) {
    return `AI processing script not found: ${PYTHON_SCRIPT}`;
  }
  if (!fs.existsSync(FFMPEG_PATH)) {
    return `FFmpeg executable not found: ${FFMPEG_PATH}`;
  }
  if (!fs.existsSync(FFPROBE_PATH)) {
    return `FFprobe executable not found: ${FFPROBE_PATH}`;
  }
  return null;
}
function validateVideoUrl(
  rawUrl: unknown
): {
  valid: boolean;
  platform?: string;
  url?: string;
  message?: string;
} {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      valid: false,
      message: 'Please provide a video URL.'
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      message: 'Invalid video URL.'
    };
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    return {
      valid: false,
      message: 'Only HTTP and HTTPS URLs are supported.'
    };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const youtubeHosts = [
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'youtube-nocookie.com'
  ];
  const facebookHosts = [
    'facebook.com',
    'm.facebook.com',
    'web.facebook.com',
    'fb.watch'
  ];
  if (
    youtubeHosts.includes(host) ||
    host.endsWith('.youtube.com')
  ) {
    return {
      valid: true,
      platform: 'YouTube',
      url: parsed.toString()
    };
  }
  if (
    facebookHosts.includes(host) ||
    host.endsWith('.facebook.com')
  ) {
    return {
      valid: true,
      platform: 'Facebook',
      url: parsed.toString()
    };
  }
  return {
    valid: false,
    message: 'Only YouTube and Facebook URLs are accepted.'
  };
}
async function downloadPublicVideo(
  url: string,
  destinationPath: string,
  platform: 'YouTube' | 'Facebook'
): Promise<string> {
  const cookieArgs =
    platform === 'YouTube' ? await getYouTubeCookieArgs() : [];

  if (platform === 'YouTube') {
    const cookieMode =
      cookieArgs[0] === '--cookies'
        ? 'cookies file'
        : cookieArgs[0] === '--cookies-from-browser'
          ? cookieArgs[1]
          : 'none';
    console.log(
      '[URL IMPORT] YouTube cookie mode:',
      cookieMode
    );
  }

  // Some YouTube videos do not expose the same format set to every player
  // client/account. Try progressively broader format selectors.
  const formatCandidates = [
    'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]',
    'bv*+ba/b',
    'bestvideo*+bestaudio/best',
    'best'
  ];

  if (process.env.CLIPFORGE_YTDLP_AUTO_UPDATE === 'true') {
    try {
      await runYtDlp(['--update'], 60_000);
      console.log('[URL IMPORT] yt-dlp update check completed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[URL IMPORT] yt-dlp update check skipped:', message);
    }
  }

  let lastError: unknown;

  for (let index = 0; index < formatCandidates.length; index += 1) {
    const format = formatCandidates[index];
    if (!format) continue;

    const destinationDir = path.dirname(destinationPath);
    const destinationStem = path.basename(destinationPath, path.extname(destinationPath));
    // Clear remnants from a previous format attempt for this unique job name.
    const oldEntries = await fs.promises.readdir(destinationDir, { withFileTypes: true });
    await Promise.all(oldEntries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${destinationStem}.`))
      .map((entry) => removeFile(path.join(destinationDir, entry.name))));
    await removeFile(destinationPath);
    // Give yt-dlp an extension placeholder. yt-dlp chooses the actual source
    // extension and may change it again after merge/remux; a fixed .mp4 output
    // path is not guaranteed to be the filename it writes on every version.
    const outputTemplate = path.join(destinationDir, `${destinationStem}.%(ext)s`);

    const downloadArgs = [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--restrict-filenames',
      '--format', format,
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
      '--no-check-certificates',
      '--geo-bypass',
      '--extractor-retries', '3',
      '--force-ipv4',
      '--extractor-args', 'youtube:player_client=android,web',
      '--max-filesize', '1G',
      '--socket-timeout', '60',
      '--retries', '5',
      '--fragment-retries', '5',
      '--concurrent-fragments', '4',
      '--output', outputTemplate,
      ...cookieArgs,
      url
    ];

    try {
      console.log(
        `[URL IMPORT] Trying format ${index + 1}/${formatCandidates.length}: ${format}`
      );

      await runYtDlp(downloadArgs, DOWNLOAD_TIMEOUT_MS);

      // Resolve the real file yt-dlp created rather than assuming the exact
      // destination extension. Ignore partial/temp files and empty files.
      const entries = await fs.promises.readdir(destinationDir, { withFileTypes: true });
      const candidates: Array<{ fullPath: string; size: number; ext: string }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith(`${destinationStem}.`)) continue;
        if (/\.(part|ytdl|json|description|jpg|jpeg|png|webp|vtt|srt|ass)$/i.test(entry.name)) continue;
        const fullPath = path.join(destinationDir, entry.name);
        const stat = await fs.promises.stat(fullPath);
        if (stat.size > 0) {
          candidates.push({ fullPath, size: stat.size, ext: path.extname(entry.name).toLowerCase() });
        }
      }

      candidates.sort((a, b) => {
        const aMp4 = a.ext === '.mp4' ? 1 : 0;
        const bMp4 = b.ext === '.mp4' ? 1 : 0;
        return bMp4 - aMp4 || b.size - a.size;
      });

      const downloaded = candidates[0];
      if (!downloaded) {
        throw new Error(
          `yt-dlp exited without creating a video file matching ${destinationStem}.* in ${destinationDir}`
        );
      }
      if (downloaded.size > MAX_FILE_SIZE) {
        await removeFile(downloaded.fullPath);
        throw new Error('Video is larger than the 1 GB limit.');
      }

      // Do not rename to a guessed .mp4 path. Keep the exact path yt-dlp
      // reported via the directory scan; this avoids ENOENT when the final
      // container/extension differs from the requested filename.
      const finalStat = await fs.promises.stat(downloaded.fullPath);
      if (!finalStat.isFile() || finalStat.size <= 0) {
        throw new Error(`Downloaded video is missing or empty: ${downloaded.fullPath}`);
      }
      const normalizedPath = await normalizeDownloadedVideo(downloaded.fullPath);
      console.log('[URL IMPORT] Download completed:', normalizedPath);
      return normalizedPath;
    } catch (error) {
      lastError = error;
      await removeFile(destinationPath);
      const message = error instanceof Error ? error.message : String(error);
      const formatUnavailable =
        /requested format is not available|no video formats found|requested format not available/i.test(message);

      // Only retry with another selector for a format-selection failure.
      // Authentication, network, and permission errors should remain visible.
      if (!formatUnavailable || index === formatCandidates.length - 1) {
        break;
      }
      console.warn(
        `[URL IMPORT] Format '${format}' unavailable; trying fallback format.`
      );
    }
  }

  const message = lastError instanceof Error
    ? lastError.message
    : String(lastError ?? 'Unknown downloader error.');
  console.error('[URL IMPORT] Download failed:', message);

  if (
    platform === 'YouTube' &&
    /sign in to confirm|confirm you.re not a bot|account verification|cookies|decrypt|dpapi/i.test(message)
  ) {
    const hasCookieSource = cookieArgs.length > 0;
    throw new Error(
      hasCookieSource
        ? 'YouTube requires account verification. Check that the configured cookie file or browser profile belongs to a signed-in YouTube account and has not expired.'
        : 'YouTube may require account verification for this video. Public videos should work without cookies; if this video requires sign-in, configure CLIPFORGE_YTDLP_COOKIES with a readable cookies.txt file or select a signed-in browser profile.'
    );
  }

  if (/requested format is not available|no video formats found|requested format not available/i.test(message)) {
    throw new Error(
      `No compatible video format was available after trying fallback selectors. Update yt-dlp and retry. Details: ${message}`
    );
  }

  throw new Error(`YouTube/Facebook download failed: ${message}`);
}

async function runPython(inputPath: string): Promise<any> {
  const pythonPath = resolvedPythonPath || await resolvePythonWithYtDlp();
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonPath,
      [PYTHON_SCRIPT, '--input', inputPath],
      {
        cwd: BASE_DIR,
        windowsHide: true,
        env: {
          ...process.env,
          CLIPFORGE_FFMPEG: FFMPEG_PATH,
          CLIPFORGE_FFPROBE: FFPROBE_PATH
        }
      }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error('AI processing timed out. Try a shorter video.')
      );
    }, PROCESS_TIMEOUT_MS);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      stderr += line;
      console.log('[AI ENGINE]', line.trim());
    });
    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Unable to start Python AI engine: ${error.message}`
        )
      );
    });
    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let result: any;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        reject(
          new Error(
            `Invalid AI response. ${stderr.slice(-2500)} ${stdout.slice(-2500)}`
          )
        );
        return;
      }
      if (code !== 0 || !result?.success) {
        reject(
          new Error(
            result?.error ||
            stderr.slice(-4000) ||
            'AI video processing failed.'
          )
        );
        return;
      }
      resolve(result);
    });
  });
}
async function processInputVideo(
  inputPath: string,
  res: Response,
  source: 'upload' | 'url',
  platform?: string
): Promise<void> {
  const dependencyError = checkProcessingDependencies();
  if (dependencyError) {
    await removeFile(inputPath);
    res.status(500).json({
      success: false,
      message: dependencyError
    });
    return;
  }
  let generatedFilenames: string[] = [];
  try {
    console.log(
      '[CLIPFORGE] Processing started:',
      path.basename(inputPath)
    );
    const aiResult = await runPython(inputPath);
    if (!Array.isArray(aiResult.clips) || !aiResult.clips.length) {
      throw new Error('AI did not generate any highlight clips.');
    }
    generatedFilenames = aiResult.clips.map((clip: any) => {
      const filename = String(clip.filename || '');
      if (!isSafeLocalFilename(filename)) {
        throw new Error(`Invalid generated filename: ${filename}`);
      }
      const actualPath = path.join(outputDirectory, filename);
      if (!fs.existsSync(actualPath)) {
        throw new Error(`Generated clip is missing: ${filename}`);
      }
      return filename;
    });
    const jobId = createDownloadJob(generatedFilenames);
    const clips = aiResult.clips.map((clip: any) => {
      const filename = String(clip.filename);
      const clipPath =
        `/api/videos/clip/${jobId}/${encodeURIComponent(filename)}`;
      const clipDownloadPath =
        `/api/videos/clip-download/${jobId}/${encodeURIComponent(filename)}`;
      const absoluteClipPath =
        `${PUBLIC_BACKEND_URL}${clipPath}`;
      const absoluteDownloadPath =
        `${PUBLIC_BACKEND_URL}${clipDownloadPath}`;
      return {
        filename,
        // These paths are used by Angular for preview and download.*
        path: clipPath,
        url: clipPath,
        previewUrl: clipPath,
        videoUrl: absoluteClipPath,
        absoluteUrl: absoluteClipPath,
        downloadUrl: clipDownloadPath,
        absoluteDownloadUrl: absoluteDownloadPath,
        duration: clip.duration ?? 0,
        start: clip.start ?? 0,
        end: clip.end ?? 0,
        score: clip.score ?? clip.interestScore ?? 0,
        interestScore:
          clip.interestScore ?? clip.score ?? 0,
        captionCount: clip.captionCount ?? 0,
        mood: clip.mood ?? null,
        music: clip.music ?? null,
        filter: clip.filter ?? null,
        backgroundStyle: clip.backgroundStyle ?? null,
        backgroundColors: clip.backgroundColors ?? [],
        selectedEffects: clip.selectedEffects ?? [],
        effects: clip.effects ?? clip.selectedEffects ?? [],
        backgroundBlur: clip.backgroundBlur ?? null,
        framing: clip.framing ?? null,
        keyframeAnimation: clip.keyframeAnimation ?? null,
        keyframes: clip.keyframes ?? [],
        features: clip.features ?? null
      };
    });
    console.log(
      `[CLIPFORGE] ${clips.length} clips ready. Job: ${jobId}`
    );
    res.status(200).json({
      success: true,
      message: 'Your clips are ready to preview and download.',
      source,
      platform: platform || null,
      duration: aiResult.duration,
      language: aiResult.language,
      hasAudio: aiResult.hasAudio,
      totalClips: clips.length,
      totalRenderedFiles: clips.length,
      maxClips: aiResult.maxClips,
      sceneChangesDetected: aiResult.sceneChangesDetected,
      clips,
      jobId,
      downloadUrl: `/api/videos/download/${jobId}`,
      downloadUrlAbsolute: `${PUBLIC_BACKEND_URL}/api/videos/download/${jobId}`,
      highlightCount: aiResult.totalClips ?? clips.length,
      highlights: clips,
      expiresInMinutes: 30,
      timeline: aiResult.timeline || [],
      analysis: aiResult.analysis || {}
    });
  } catch (error) {
    if (generatedFilenames.length) {
      await removeGeneratedFiles(generatedFilenames);
    }
    const message =
      error instanceof Error ? error.message : String(error);
    console.error('[CLIPFORGE] Processing failed:', message);
    if (!res.headersSent) {
      const status =
        /timed out|time limit|deadline/i.test(message) ? 504 :
        /no highlight|duration|input video|unsupported|invalid/i.test(message) ? 422 :
        500;
      res.status(status).json({
        success: false,
        message: 'Video processing failed.',
        error: message
      });
    }
  } finally {
    await removeFile(inputPath);
  }
}
// Upload local video.*
router.post(
  '/upload',
  upload.single('video'),
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file was uploaded.'
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Video uploaded successfully.',
      video: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });
  }
);
// Process uploaded video.*
router.post(
  '/process/:filename',
  async (req: Request, res: Response) => {
    const filename = getRouteParam(req.params.filename);
    if (!isSafeLocalFilename(filename)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename.'
      });
    }
    const inputPath = path.join(uploadDirectory, filename);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({
        success: false,
        message: 'Uploaded video not found.'
      });
    }
    await processInputVideo(inputPath, res, 'upload');
  }
);
// Process public YouTube or Facebook URL.
router.post(
  '/process-url',
  async (req: Request, res: Response) => {
    const validation = validateVideoUrl(req.body?.url);
    if (
      !validation.valid ||
      !validation.url ||
      !validation.platform
    ) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    const dependencyError = checkProcessingDependencies();
    if (dependencyError) {
      return res.status(500).json({
        success: false,
        message: dependencyError
      });
    }

    // Normalize common YouTube URL variants to the same video key.
    let urlJobKey = validation.url.trim();
    try {
      const parsed = new URL(urlJobKey);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'youtu.be') {
        urlJobKey = `youtube:${parsed.pathname.replace(/^\//, '').split('/')[0]}`;
      } else if (host.endsWith('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) urlJobKey = `youtube:${videoId}`;
      } else {
        parsed.hash = '';
        parsed.search = '';
        urlJobKey = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
      }
    } catch {
      // URL validation above already checked the URL; retain its normalized value.
    }

    if (activeUrlJobs.has(urlJobKey)) {
      console.warn('[URL IMPORT] Duplicate request ignored:', urlJobKey);
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: 'This video is already being downloaded or processed. Please wait for the current job to finish.'
      });
    }

    activeUrlJobs.add(urlJobKey);

    const filename =
      `clipforge-url-${Date.now()}-${randomUUID()}.mp4`;
    const inputPath = path.join(uploadDirectory, filename);
    let downloadedInputPath = inputPath;

    try {
      console.log(
        `[URL IMPORT] Platform: ${validation.platform}`
      );
      console.log('[URL IMPORT] Job accepted:', urlJobKey);

      downloadedInputPath = await downloadPublicVideo(
        validation.url,
        inputPath,
        validation.platform as 'YouTube' | 'Facebook'
      );

      await processInputVideo(
        downloadedInputPath,
        res,
        'url',
        validation.platform
      );
    } catch (error) {
      await removeFile(downloadedInputPath);
      if (downloadedInputPath !== inputPath) await removeFile(inputPath);
      const message =
        error instanceof Error ? error.message : String(error);
      console.error('[URL IMPORT] Failed:', message);
      if (!res.headersSent) {
        res.status(422).json({
          success: false,
          message: 'This video URL could not be accessed or processed.',
          error: message,
          hint:
            'Use a public video accessible without login, cookies or DRM, or upload a video you have permission to use.'
        });
      }
    } finally {
      activeUrlJobs.delete(urlJobKey);
    }
  }
);
// Preview an individual generated clip.*
router.get(
  '/clip/:jobId/:filename',
  (req: Request, res: Response) => {
    const jobId = getRouteParam(req.params.jobId);
    const filename = getRouteParam(req.params.filename);
    const job = downloadJobs.get(jobId);
    if (!job || !isSafeLocalFilename(filename)) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found or expired.'
      });
    }
    if (!job.filenames.includes(filename)) {
      return res.status(404).json({
        success: false,
        message: 'Clip does not belong to this job.'
      });
    }
    const filePath = path.join(outputDirectory, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Clip file is no longer available.'
      });
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(filePath);
  }
);
// Download one individual generated clip.*
router.get(
  '/clip-download/:jobId/:filename',
  (req: Request, res: Response) => {
    const jobId = getRouteParam(req.params.jobId);
    const filename = getRouteParam(req.params.filename);
    const job = downloadJobs.get(jobId);
    if (!job || !isSafeLocalFilename(filename)) {
      return res.status(404).json({
        success: false,
        message: 'Clip not found or expired.'
      });
    }
    if (!job.filenames.includes(filename)) {
      return res.status(404).json({
        success: false,
        message: 'Clip does not belong to this job.'
      });
    }
    const filePath = path.join(outputDirectory, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Clip file is no longer available.'
      });
    }
    return res.download(filePath, filename);
  }
);
// Download all generated clips as ZIP.*
// Clips remain available for the full 30-minute expiry period.*
router.get(
  '/download/:jobId',
  async (req: Request, res: Response) => {
    const jobId = getRouteParam(req.params.jobId);
    const job = downloadJobs.get(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Download expired. Please process your video again.'
      });
    }
    const existingFiles = job.filenames.filter(filename =>
      isSafeLocalFilename(filename) &&
      fs.existsSync(path.join(outputDirectory, filename))
    );
    if (!existingFiles.length) {
      await cleanupJob(jobId);
      return res.status(404).json({
        success: false,
        message: 'Generated clips are no longer available.'
      });
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="ClipForge-AI-Clips.zip"'
    );
    const archive = archiver('zip', {
      zlib: { level: 1 }
    });
    archive.on('error', (error: Error) => {
      console.error('[ZIP] Archive error:', error.message);
      if (!res.headersSent) {
        res.status(500).end('Unable to create ZIP download.');
      } else {
        res.destroy(error);
      }
    });
    archive.pipe(res);
    for (const filename of existingFiles) {
      archive.file(
        path.join(outputDirectory, filename),
        { name: filename }
      );
    }
    try {
      await archive.finalize();
    } catch (error) {
      console.error('[ZIP] Finalize error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Unable to prepare ZIP download.'
        });
      }
    }
  }
);
// API health check.
router.get('/test', (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: 'ClipForge AI Video API is working!'
  });
});
export default router;
