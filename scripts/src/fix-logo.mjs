/**
 * Fix logo.png:
 * 1. Remove white/near-white background → transparent
 * 2. Recolor all orange/yellow pixels to Tailwind orange-700 (#c2410c)
 *    to match the "site information." gradient on the landing page
 */
import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../artifacts/sitesort/public/images/logo.png");

const image = await Jimp.read(logoPath);

// Target orange: Tailwind orange-700 (#c2410c)
const TARGET_R = 0xc2;
const TARGET_G = 0x41;
const TARGET_B = 0x0c;

image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];

  // Near-white background → transparent
  if (r > 210 && g > 210 && b > 210) {
    this.bitmap.data[idx + 3] = 0;
    return;
  }

  // Orange/yellow pixels: red dominant, green moderate, blue low
  const isOrange = r > 150 && g > 80 && g < 220 && b < 100 && r > g + 30 && r > b + 100;
  if (isOrange) {
    // Blend toward target orange preserving relative luminance
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    const scale = Math.max(0.6, Math.min(1.2, lum / 0.6));
    this.bitmap.data[idx + 0] = Math.min(255, Math.round(TARGET_R * scale));
    this.bitmap.data[idx + 1] = Math.min(255, Math.round(TARGET_G * scale));
    this.bitmap.data[idx + 2] = Math.min(255, Math.round(TARGET_B * scale));
    return;
  }
});

await image.write(logoPath);
console.log("Done — logo background transparent, orange recolored to #c2410c");
