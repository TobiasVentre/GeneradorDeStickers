import { readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { CatalogPort, PngAssetInfo } from "../../application/ports";

export class FsPngCatalog implements CatalogPort {
  async listPngAssets(folderPath: string): Promise<PngAssetInfo[]> {
    const entries = await readdir(folderPath, { withFileTypes: true });

    const pngFiles = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    const assets: PngAssetInfo[] = [];

    for (const filename of pngFiles) {
      const filePath = join(folderPath, filename);
      const meta = await sharp(filePath).metadata();

      if (!meta.width || !meta.height) throw new Error(`No pude leer width/height de: ${filename}`);

      assets.push({ assetId: filename, filePath, widthPx: meta.width, heightPx: meta.height });
    }

    return assets;
  }
}