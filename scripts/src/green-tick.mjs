/**
 * Recolours only the tick/checkmark to dark green.
 * Diagnostic showed:
 *   green (document body) = x 144–302
 *   orange (tick + Site text) = x 303–615
 * The tick is the orange region LEFT of the Site text.
 * We find the gap between tick and text by scanning for an orange-free column.
 */
import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../artifacts/sitesort/public/images/logo.png");

const image = await Jimp.read(logoPath);
const { width, height } = image.bitmap;

// Build a per-column count of orange pixels to find the gap between tick and text
const orangeByCol = new Array(width).fill(0);
image.scan(0, 0, width, height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  const a = this.bitmap.data[idx + 3];
  if (a < 10) return;
  if (r > 100 && g > 40 && b < 80 && r > g + 40 && r > b + 80) {
    orangeByCol[x]++;
  }
});

// Find the first empty (gap) column after orange starts at ~303
let tickEnd = 303;
for (let x = 303; x < width; x++) {
  if (orangeByCol[x] === 0) {
    tickEnd = x;
    break;
  }
}
console.log(`Tick orange region: x 303 – ${tickEnd}`);

// Dark green: Tailwind green-800 = #166534
const GREEN_R = 0x16;
const GREEN_G = 0x65;
const GREEN_B = 0x34;

image.scan(0, 0, width, height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  const a = this.bitmap.data[idx + 3];
  if (a < 10) return;

  const isOrange = r > 100 && g > 40 && b < 80 && r > g + 40 && r > b + 80;
  if (isOrange && x >= 303 && x <= tickEnd) {
    this.bitmap.data[idx + 0] = GREEN_R;
    this.bitmap.data[idx + 1] = GREEN_G;
    this.bitmap.data[idx + 2] = GREEN_B;
  }
});

await image.write(logoPath);
console.log("Done — tick recoloured to dark green");
