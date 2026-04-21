// Tile pyramid generator.
//
// Given a source image, produce a Leaflet-compatible pyramid of 256×256
// JPEG tiles at multiple zoom levels under data/maps/tiles/<mapId>/<z>/<x>/<y>.jpg
// plus a tiles.json manifest the client reads to build L.tileLayer.
//
// Zoom convention: 0 = whole image fits in 256px, each +1 doubles the
// tile grid in each axis. We cap at whatever zoom actually adds detail
// (no upsampling past the source resolution).
//
// Re-runs are cheap: if the manifest's "srcHash" matches the source
// file's mtime+size, we skip. Delete the folder to force rebuild.

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const MAPS_DIR  = path.join(__dirname, 'data', 'maps');
const TILES_DIR = path.join(MAPS_DIR, 'tiles');
const TILE_SIZE = 256;

function _srcFingerprint(srcPath) {
  const s = fs.statSync(srcPath);
  return `${s.size}-${Math.floor(s.mtimeMs)}`;
}

function _maxZoomFor(w, h) {
  // Largest zoom where the source still has ≥ 1 pixel per tile pixel.
  // At zoom z the pyramid renders the image into (2^z * TILE_SIZE) px per side.
  const long = Math.max(w, h);
  let z = 0;
  while (TILE_SIZE * (1 << (z + 1)) <= long) z++;
  return z;
}

async function buildFor(mapId, srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error(`Source missing: ${srcPath}`);
  const safeId = mapId.replace(/[^a-z0-9_\-\/]/gi, '_');
  const outDir = path.join(TILES_DIR, safeId);
  const manifestPath = path.join(outDir, 'tiles.json');

  const fp = _srcFingerprint(srcPath);
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (existing.srcHash === fp) return existing;   // already built
    } catch (_) { /* corrupt manifest → rebuild */ }
  }

  fs.mkdirSync(outDir, { recursive: true });

  const meta = await sharp(srcPath).metadata();
  const { width: w, height: h } = meta;
  if (!w || !h) throw new Error('Could not read image dimensions');

  const maxZ = _maxZoomFor(w, h);

  // Aspect: we place the image in a square canvas of side (2^maxZ * TILE_SIZE),
  // top-left aligned, leaving transparent background on the short side. At
  // render time Leaflet uses the manifest's imgW/imgH to compute pin fractions
  // relative to the original image — the transparent padding is hidden via
  // bounds math.
  const canvasLong = TILE_SIZE * (1 << maxZ);

  for (let z = 0; z <= maxZ; z++) {
    const tilesPerSide = 1 << z;                           // 2^z
    const scaledCanvas = TILE_SIZE * tilesPerSide;         // canvas side at this zoom
    const ratio        = scaledCanvas / canvasLong;         // < 1 for z < maxZ
    const scaledW      = Math.max(1, Math.round(w * ratio));
    const scaledH      = Math.max(1, Math.round(h * ratio));

    // Cols/rows actually covered by the image (rest of grid is empty padding)
    const cols = Math.ceil(scaledW / TILE_SIZE);
    const rows = Math.ceil(scaledH / TILE_SIZE);

    // Render the scaled image once, then slice into tiles.
    const scaled = await sharp(srcPath)
      .resize({ width: scaledW, height: scaledH, fit: 'fill' })
      .toBuffer();

    // Extend to a tile-aligned canvas so sharp.extract() works at edges.
    const aligned = await sharp(scaled)
      .extend({
        top:    0,
        left:   0,
        bottom: cols * TILE_SIZE - scaledH < 0 ? 0 : (rows * TILE_SIZE - scaledH),
        right:  (cols * TILE_SIZE) - scaledW,
        background: { r: 20, g: 20, b: 20, alpha: 1 },
      })
      .toBuffer();

    for (let x = 0; x < cols; x++) {
      const zxDir = path.join(outDir, String(z), String(x));
      fs.mkdirSync(zxDir, { recursive: true });
      for (let y = 0; y < rows; y++) {
        const tile = await sharp(aligned)
          .extract({ left: x * TILE_SIZE, top: y * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE })
          .jpeg({ quality: 78, mozjpeg: true })
          .toBuffer();
        fs.writeFileSync(path.join(zxDir, `${y}.jpg`), tile);
      }
    }
  }

  const manifest = {
    mapId,
    srcHash:   fp,
    imgW:      w,
    imgH:      h,
    tileSize:  TILE_SIZE,
    minZoom:   0,
    maxZoom:   maxZ,
    canvasLong,
    builtAt:   Date.now(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

module.exports = { buildFor };
