import { Jimp } from "jimp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../artifacts/sitesort/public/images/logo.png");

const image = await Jimp.read(logoPath);

image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
  const r = this.bitmap.data[idx + 0];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  if (r > 230 && g > 230 && b > 230) {
    this.bitmap.data[idx + 3] = 0;
  }
});

await image.write(logoPath);
console.log("Done — white background removed from logo.png");
