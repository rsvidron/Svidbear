/**
 * Turn the full-resolution bear photos into web-sized WebP.
 *
 * Sources go in public/bears/<id>.png (git-ignored, ~4 MB each); this writes the
 * two sizes the app actually uses, which are what gets committed:
 *
 *   <id>.webp     900px wide  — the photograph, shown in the dossier modal
 *   <id>-sm.webp  192x192     — a square crop of it, as the avatar in each bracket row
 *
 * Every source is the same explore.org layout: a June trading card, an arrow, and
 * a September card. We want the photographs, not the card art, so this lifts the
 * photo out of the right-hand (September) card — the bear at its heaviest.
 *
 * Run with: npm run images
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'bears');
const sources = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));

if (!sources.length) {
  console.log('No .png sources in public/bears — nothing to do.');
  process.exit(0);
}

/**
 * Where the September card's photograph sits, as a fraction of the whole source.
 * Pulled in slightly at the top and right so no pixel-art card border survives.
 */
const PHOTO = { left: 0.5848, top: 0.2060, width: 0.3712, height: 0.5535 };

/**
 * The bracket avatar has to show the biggest bear in the shot, face included.
 * Saliency gets that right for most of the field, but not for these — so the
 * horizontal centre of their square is set by hand, as a fraction of the photo.
 * (The photos are ~1.64:1, so the square is always full height; only x matters.)
 *
 *   901 — the mother walks out of the left edge, her cub trails behind
 *   428 — head far right, the long body filling everything to its left
 *   620 — same shape: head right, bulk left
 *   610 — two bears; the larger one leads on the right
 *    89 — dark bear in white water, head to the right
 */
const FOCUS = { 901: 0.16, 428: 0.68, 620: 0.68, 610: 0.72, 89: 0.69 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

let before = 0;
let after = 0;

for (const file of sources) {
  const id = path.basename(file, '.png');
  const src = path.join(dir, file);
  before += fs.statSync(src).size;

  const { width, height } = await sharp(src).metadata();
  const region = {
    left: Math.round(width * PHOTO.left),
    top: Math.round(height * PHOTO.top),
    width: Math.round(width * PHOTO.width),
    height: Math.round(height * PHOTO.height),
  };

  const photo = await sharp(src).extract(region).toBuffer();
  const wide = path.join(dir, `${id}.webp`);
  const small = path.join(dir, `${id}-sm.webp`);

  await sharp(photo).resize({ width: 900, withoutEnlargement: true }).webp({ quality: 80 }).toFile(wide);

  const focus = FOCUS[id];
  const avatar = sharp(photo);
  if (focus === undefined) {
    avatar.resize({ width: 192, height: 192, fit: 'cover', position: sharp.strategy.attention });
  } else {
    // Square window centred on the focal point, clamped inside the photo.
    const size = Math.min(region.width, region.height);
    const left = clamp(Math.round(region.width * focus - size / 2), 0, region.width - size);
    const top = clamp(Math.round((region.height - size) / 2), 0, region.height - size);
    avatar.extract({ left, top, width: size, height: size }).resize(192, 192);
  }
  await avatar.webp({ quality: 82 }).toFile(small);

  after += fs.statSync(wide).size + fs.statSync(small).size;
  console.log(
    `${id}: ${region.width}x${region.height} -> ${(fs.statSync(wide).size / 1024).toFixed(0)}kb + ${(fs.statSync(small).size / 1024).toFixed(0)}kb`
  );
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`\n${sources.length} bears: ${mb(before)}MB of PNG -> ${mb(after)}MB of WebP`);
