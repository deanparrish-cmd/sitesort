/**
 * Creates a version of the logo with the checkmark/tick recoloured to dark green,
 * while leaving the "Site" text orange.
 * Identifies the icon vs text region by x-position.
 */
import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../../artifacts/sitesort/public/images/logo.png");
const dst = src; // overwrite in place

const image = await Jimp.read(src);
const { width, height } = image.bitmap;
console.log(`Image size: ${width}x${height}`);

// The icon occupies roughly the left ~30% of the image.
// Scan to find the rightmost orange pixel that is part of the icon
// (before the text gap) vs the "Site" text which starts later.
// We'll use x < iconBoundary for the tick recolour.
const iconBoundary = Math.round(width * 0.30);
console.log(`Icon boundary at x=${iconBoundary}`);

// Dark green: Tailwind green-800 = #166534
const GREEN_R = 0x16;
const GREEN_G = 0x65;
const GREEN_B = 0x34;

image.scan(0, 0, width, height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  const a = this.bitmap.data[idx + 3];

  if (a < 10) return; // transparent, skip

  const isOrange = r > 100 && g > 40 && b < 80 && r > g + 40 && r > b + 80;
  if (isOrange && x < iconBoundary) {
    this.bitmap.data[idx + 0] = GREEN_R;
    this.bitmap.data[idx + 1] = GREEN_G;
    this.bitmap.data[idx + 2] = GREEN_B;
  }
});

await image.write(dst);
console.log(`Done — tick recoloured to dark green (#166534)`);
