import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../artifacts/sitesort/public/images/logo.png");
const image = await Jimp.read(logoPath);
const { width, height } = image.bitmap;

// Collect x ranges of orange and green pixels
const orangeXRanges = [];
const greenXRanges = [];

image.scan(0, 0, width, height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  const a = this.bitmap.data[idx + 3];
  if (a < 10) return;
  const isOrange = r > 100 && g > 40 && b < 80 && r > g + 40 && r > b + 80;
  const isGreen = g > r && g > b && g > 80 && r < 100;
  if (isOrange) orangeXRanges.push(x);
  if (isGreen) greenXRanges.push(x);
});

const minOrange = Math.min(...orangeXRanges);
const maxOrange = Math.max(...orangeXRanges);
const minGreen = Math.min(...greenXRanges);
const maxGreen = Math.max(...greenXRanges);

console.log(`Image: ${width}x${height}`);
console.log(`Orange pixels x range: ${minOrange} – ${maxOrange}  (${Math.round(minOrange/width*100)}% – ${Math.round(maxOrange/width*100)}%)`);
console.log(`Green pixels x range:  ${minGreen} – ${maxGreen}  (${Math.round(minGreen/width*100)}% – ${Math.round(maxGreen/width*100)}%)`);
