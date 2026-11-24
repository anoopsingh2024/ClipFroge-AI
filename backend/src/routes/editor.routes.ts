
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const router = Router();

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'outputs');
const MUSIC_DIR = path.join(ROOT, 'music');

const FFMPEG = process.env.CLIPFORGE_FFMPEG || 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env.CLIPFORGE_FFPROBE || 'C:\\ffmpeg\\bin\\ffprobe.exe';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(MUSIC_DIR, { recursive: true });

const FILTERS: Record<string, string> = {
  none: 'null',
  cinematic: 'eq=contrast=1.15:saturation=0.85:brightness=-0.02',
  vivid: 'eq=saturation=1.5:contrast=1.1',
  warm: 'colortemperature=temperature=6500',
  cool: 'colortemperature=temperature=9000',
  vintage: 'curves=vintage',
  black_white: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  faded: 'eq=contrast=0.8:brightness=0.08:saturation=0.7',
  dramatic: 'eq=contrast=1.4:saturation=1.2',
  bright: 'eq=brightness=0.08',
  dark: 'eq=brightness=-0.12',
  pastel: 'eq=saturation=0.65:contrast=0.9',
  golden: 'colorbalance=rs=.12:gs=.04:bs=-.08',
  teal_orange: 'colorbalance=rs=.12:bs=-.12:gs=.04',
  soft: 'gblur=sigma=0.5',
  sharp: 'unsharp=5:5:0.8:3:3:0',
  hdr: 'eq=contrast=1.25:saturation=1.25',
  matte: 'eq=contrast=0.85:brightness=0.03',
  urban: 'eq=contrast=1.3:saturation=0.75',
  tropical: 'eq=saturation=1.45:gamma=1.05',
  rose: 'colorbalance=rs=.1:gs=-.03:bs=.04',
  blue_mood: 'colorbalance=bs=.18:rs=-.08',
  green_mood: 'colorbalance=gs=.12',
  orange_glow: 'colorbalance=rs=.15:gs=.04',
  moody: 'eq=brightness=-0.06:contrast=1.25:saturation=0.8',
  clean: 'eq=contrast=1.05:saturation=1.05',
  crisp: 'unsharp=7:7:0.6:5:5:0',
  low_contrast: 'eq=contrast=0.75',
  high_contrast: 'eq=contrast=1.5',
  desaturated: 'eq=saturation=0.35',
  neon: 'eq=saturation=1.8:contrast=1.2',
  film: 'curves=film',
  sunset: 'colorbalance=rs=.16:gs=.03:bs=-.12',
  winter: 'colorbalance=bs=.15:rs=-.05',
  summer: 'eq=saturation=1.25:brightness=0.04',
  autumn: 'colorbalance=rs=.12:gs=.05:bs=-.1',
  midnight: 'eq=brightness=-0.15:saturation=0.8',
  dreamy: 'gblur=sigma=0.7',
  natural: 'eq=contrast=1.02:saturation=1.03',
  portrait: 'eq=brightness=0.03:saturation=1.08',
  food: 'eq=saturation=1.35:contrast=1.08',
  travel: 'eq=saturation=1.2:contrast=1.1',
  sport: 'eq=contrast=1.3:saturation=1.25',
  wedding: 'eq=brightness=0.05:saturation=0.85',
  retro: 'curves=vintage,eq=saturation=0.8',
  polaroid: 'eq=contrast=0.85:brightness=0.06:saturation=0.8',
  aqua: 'colorbalance=bs=.12:gs=.05',
  lavender: 'colorbalance=bs=.1:rs=.04',
  sunset_glow: 'eq=brightness=0.04:saturation=1.2'
};

const EFFECTS: Record<string, string> = {
  none: 'null',
  blur: 'gblur=sigma=2',
  soft_blur: 'gblur=sigma=0.8',
  sharpen: 'unsharp=7:7:1.0:5:5:0',
  grain: 'noise=alls=12:allf=t',
  light_glow: 'eq=brightness=0.08',
  vignette: 'vignette=PI/5',
  mirror: 'hflip',
  flip: 'vflip',
  rotate: 'transpose=1',
  rotate_left: 'transpose=2',
  emboss: 'convolution=-2 -1 0 -1 1 1 0 1 2',
  edge: 'edgedetect',
  negative: 'negate',
  posterize: 'posterize=levels=6',
  pixelate: 'scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor',
  old_film: 'noise=alls=18:allf=t,eq=saturation=0.5',
  warm_glow: 'eq=brightness=0.05:saturation=1.2',
  cold_glow: 'colorbalance=bs=.15',
  flash: 'eq=brightness=0.18',
  fade_dark: 'eq=brightness=-0.12',
  contrast_boost: 'eq=contrast=1.4',
  color_pop: 'eq=saturation=1.7',
  desaturate: 'hue=s=0',
  fisheye: 'lenscorrection=k1=-0.25:k2=0.1',
  wave: 'wave=amplitude=2:period=20',
  chromatic: 'rgbashift=rh=5:bh=-5',
  glitch: 'rgbashift=rh=8:bh=-8',
  scanlines: 'drawgrid=w=iw:h=4:t=1:c=black@0.15',
  shake: 'crop=iw-8:ih-8',
  zoom: 'scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08',
  cinematic_bars: 'drawbox=x=0:y=0:w=iw:h=ih*0.08:color=black:t=fill,drawbox=x=0:y=ih*0.92:w=iw:h=ih*0.08:color=black:t=fill',
  soft_focus: 'gblur=sigma=1.2',
  glow: 'eq=brightness=0.1',
  dark_edges: 'vignette=PI/3',
  color_shift: 'colorbalance=rs=.08:bs=-.08',
  vintage_noise: 'noise=alls=20:allf=t,curves=vintage',
  sharpen_edges: 'unsharp=9:9:1.2',
  mirror_blur: 'hflip,gblur=sigma=0.5',
  high_key: 'eq=brightness=0.12:contrast=0.9',
  low_key: 'eq=brightness=-0.12:contrast=1.2',
  rgb_split: 'rgbashift=rh=4:bh=-4',
  vignette_soft: 'vignette=PI/7',
  monochrome: 'hue=s=0,eq=contrast=1.15',
  film_dust: 'noise=alls=10:allf=t',
  dreamy_glow: 'gblur=sigma=0.6,eq=brightness=0.04',
  punch: 'eq=contrast=1.25:saturation=1.3',
  subtle_fade: 'eq=contrast=0.92:brightness=0.02'
};

const ANIMATIONS: Record<string, string> = {
  none: 'null',
  zoom_in: 'scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08',
  zoom_out: 'scale=iw*1.08:ih*1.08,crop=iw/1.08:ih/1.08',
  gentle_pan: 'scale=iw*1.04:ih*1.04,crop=iw/1.04:ih/1.04',
  cinematic: 'fade=t=in:st=0:d=0.6,fade=t=out:st=8:d=0.6'
};

function safeFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value || path.basename(value) !== value) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return null;
  return value;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let errorText = '';

    child.stderr.on('data', (data: Buffer) => {
      errorText += data.toString();
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(errorText.slice(-3000) || `${command} failed`));
    });
  });
}

async function hasAudio(input: string): Promise<boolean> {
  try {
    await run(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      input
    ]);
    return true;
  } catch {
    return false;
  }
}

function readMusicCatalog(): any[] {
  const catalogPath = path.join(MUSIC_DIR, 'catalog.json');
  if (!fs.existsSync(catalogPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

router.get('/catalog', (_req: Request, res: Response) => {
  const music = readMusicCatalog()
    .filter(track => {
      const name = safeFilename(track.filename);
      const licensed = track.commercial_use === true &&
        ['CC0', 'PUBLIC_DOMAIN', 'ROYALTY_FREE_COMMERCIAL']
          .includes(String(track.licenseType || '').toUpperCase());

      return name && licensed &&
        fs.existsSync(path.join(MUSIC_DIR, name));
    })
    .map(track => ({
      filename: track.filename,
      title: track.title || path.parse(track.filename).name,
      mood: track.mood || 'general',
      licenseType: track.licenseType,
      attribution: track.attribution || ''
    }));

  res.json({
    success: true,
    filters: Object.keys(FILTERS).map(id => ({ id, name: id.replaceAll('_', ' ') })),
    effects: Object.keys(EFFECTS).map(id => ({ id, name: id.replaceAll('_', ' ') })),
    animations: Object.keys(ANIMATIONS).map(id => ({ id, name: id.replaceAll('_', ' ') })),
    music
  });
});

router.get('/music/:filename', (req: Request, res: Response) => {
  const filename = safeFilename(req.params.filename);
  if (!filename) return res.status(400).json({ success: false, message: 'Invalid filename.' });

  const track = readMusicCatalog().find(item => item.filename === filename);
  if (!track || track.commercial_use !== true) {
    return res.status(403).json({ success: false, message: 'Music is not approved for use.' });
  }

  const filePath = path.join(MUSIC_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Music file not found.' });

  return res.sendFile(filePath);
});

router.get('/output/:filename', (req: Request, res: Response) => {
  const filename = safeFilename(req.params.filename);
  if (!filename) return res.status(400).end();

  const filePath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  return res.download(filePath);
});

router.post('/render/:filename', async (req: Request, res: Response) => {
  const filename = safeFilename(req.params.filename);
  if (!filename) return res.status(400).json({ success: false, message: 'Invalid clip filename.' });

  const inputPath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(inputPath)) return res.status(404).json({ success: false, message: 'Clip not found. It may have expired.' });

  const filterId = String(req.body?.filter || 'none');
  const effectId = String(req.body?.effect || 'none');
  const animationId = String(req.body?.animation || 'none');
  const musicName = req.body?.music ? safeFilename(req.body.music) : null;
  const volume = Math.max(0, Math.min(1, Number(req.body?.volume ?? 0.25)));

  if (!FILTERS[filterId] || !EFFECTS[effectId] || !ANIMATIONS[animationId]) {
    return res.status(400).json({ success: false, message: 'Unknown filter, effect or animation.' });
  }

  let musicPath: string | null = null;
  if (musicName) {
    const track = readMusicCatalog().find(item => item.filename === musicName);
    const approved = track?.commercial_use === true &&
      ['CC0', 'PUBLIC_DOMAIN', 'ROYALTY_FREE_COMMERCIAL']
        .includes(String(track?.licenseType || '').toUpperCase());

    if (!approved) return res.status(403).json({ success: false, message: 'This music is not approved for commercial use.' });

    musicPath = path.join(MUSIC_DIR, musicName);
    if (!fs.existsSync(musicPath)) return res.status(404).json({ success: false, message: 'Music file not found.' });
  }

  const outputName = `edited-${Date.now()}-${randomUUID()}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, outputName);

  try {
    const filters = [
      'scale=1080:1920:force_original_aspect_ratio=increase',
      'crop=1080:1920',
      FILTERS[filterId],
      EFFECTS[effectId],
      ANIMATIONS[animationId],
      'setsar=1',
      'format=yuv420p'
    ].filter(value => value !== 'null');

    const videoFilter = filters.join(',');
    const inputHasAudio = await hasAudio(inputPath);
    const args = ['-y', '-i', inputPath];

    if (musicPath) {
      args.push('-stream_loop', '-1', '-i', musicPath);
      args.push(
        '-filter_complex',
        inputHasAudio
          ? `[0:a]volume=0.85[original];[1:a]volume=${volume}[music];[original][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`
          : `[1:a]volume=${volume}[aout]`
      );
      args.push('-map', '0:v:0', '-map', '[aout]');
    } else {
      args.push('-map', '0:v:0');
      if (inputHasAudio) args.push('-map', '0:a:0?');
    }

    args.push(
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-shortest',
      outputPath
    );

    await run(FFMPEG, args);

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('FFmpeg did not create the edited video.');
    }

    return res.json({
      success: true,
      message: 'Your edited clip is ready.',
      filename: outputName,
      url: `/api/editor/output/${encodeURIComponent(outputName)}`
    });
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    const message = error instanceof Error ? error.message : String(error);
    console.error('[EDITOR RENDER]', message);
    return res.status(500).json({ success: false, message: 'Video editing failed.', error: message });
  }
});

export default router;
