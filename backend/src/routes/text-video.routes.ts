import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const router = Router();
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(ROOT, 'outputs');
const SCRIPT_PATH = path.join(ROOT, 'ai_engine', 'generate_text_video.py');
const PYTHON = process.env.CLIPFORGE_PYTHON ||
  path.join(
    ROOT,
    'ai-venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python'
  );
const MAX_TEXT_LENGTH = 20_000;
const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function isSafeFilename(filename: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(filename) &&
    path.basename(filename) === filename;
}

function generateVideo(
  input: { text: string; style: string; language: string },
  outputPath: string
): Promise<{ scenes: string[]; voice: string; music: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT_PATH, '--output', outputPath], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        CLIPFORGE_FFMPEG: process.env.CLIPFORGE_FFMPEG ||
          (process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : '/usr/bin/ffmpeg'),
        CLIPFORGE_FFPROBE: process.env.CLIPFORGE_FFPROBE ||
          (process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffprobe.exe' : '/usr/bin/ffprobe')
      }
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('Text video generation timed out.'));
    }, GENERATION_TIMEOUT_MS);

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      stderr += line;
      console.log('[TEXT VIDEO]', line.trim());
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Unable to start the text-video renderer: ${error.message}`));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let result: any;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        reject(new Error(`Invalid text-video renderer response. ${stderr.slice(-2500)}`));
        return;
      }
      if (code !== 0 || !result?.success) {
        reject(new Error(result?.error || stderr.slice(-4000) || 'Text video generation failed.'));
        return;
      }
      resolve(result);
    });

    child.stdin.end(JSON.stringify(input));
  });
}

router.post('/generate', async (req: Request, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const style = req.body?.style;
  const language = req.body?.language;

  if (!text) {
    return res.status(400).json({ success: false, message: 'Enter text or upload a TXT/MD file.' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(413).json({
      success: false,
      message: `Text is too long. Maximum size is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`
    });
  }
  if (!['cartoon', 'documentary'].includes(style)) {
    return res.status(400).json({ success: false, message: 'Choose cartoon or documentary style.' });
  }
  if (!['en', 'hi'].includes(language)) {
    return res.status(400).json({ success: false, message: 'Choose English or Hindi narration.' });
  }

  const filename = `text-story-${Date.now()}-${randomUUID()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  try {
    const result = await generateVideo({ text, style, language }, outputPath);
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('Renderer did not create a video file.');
    }

    return res.json({
      success: true,
      message: 'Your 60-second illustrated video is ready.',
      filename,
      duration: 60,
      style,
      language,
      scenes: result.scenes,
      voice: result.voice,
      music: result.music,
      url: `/api/text-video/output/${encodeURIComponent(filename)}`
    });
  } catch (error) {
    try {
      await fs.promises.unlink(outputPath);
    } catch {
      // The output may not have been created.
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TEXT VIDEO] Generation failed:', message);
    const status = /voice|speech|pyttsx|espeak|narrat/i.test(message) ? 503 :
      /timed out/i.test(message) ? 504 : 500;
    return res.status(status).json({
      success: false,
      message: 'Could not create the video.',
      error: message
    });
  }
});

router.get('/output/:filename', (req: Request, res: Response) => {
  const filename = String(req.params.filename || '');
  if (!isSafeFilename(filename)) {
    return res.status(400).end();
  }
  const filePath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Video not found.' });
  }
  return res.sendFile(filePath);
});

export default router;
