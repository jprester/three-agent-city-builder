// Grid district: rectangular blocks separated by streets, each block split into
// lots, each lot filled with a building (or left empty).
//
// Output coordinates are three.js space: Y up, ground at y = 0, meters.
// rotationY is radians; buildings' front faces +Z at rotationY = 0.
import { mulberry32, weightedChoice } from './lib/rng.mjs';

export function generate({ params, seed }) {
  const rng = mulberry32(seed);
  const {
    blocksX = 4,
    blocksZ = 4,
    lotsPerBlockX = 2,
    lotsPerBlockZ = 2,
    lotSize = 16,
    streetWidth = 12,
    emptyLotChance = 0.08,
    buildings = {},
  } = params;

  const blockW = lotsPerBlockX * lotSize;
  const blockD = lotsPerBlockZ * lotSize;
  const totalW = blocksX * blockW + (blocksX + 1) * streetWidth;
  const totalD = blocksZ * blockD + (blocksZ + 1) * streetWidth;

  const blocks = [];
  const instances = [];
  for (let bx = 0; bx < blocksX; bx++) {
    for (let bz = 0; bz < blocksZ; bz++) {
      const x0 = -totalW / 2 + streetWidth + bx * (blockW + streetWidth);
      const z0 = -totalD / 2 + streetWidth + bz * (blockD + streetWidth);
      blocks.push({ min: [x0, z0], max: [x0 + blockW, z0 + blockD] });

      for (let lx = 0; lx < lotsPerBlockX; lx++) {
        for (let lz = 0; lz < lotsPerBlockZ; lz++) {
          if (rng() < emptyLotChance) continue;
          const cx = x0 + (lx + 0.5) * lotSize;
          const cz = z0 + (lz + 0.5) * lotSize;
          // Face the street on the lot's outer edge: toward +Z/-Z or +X/-X.
          const facesZ = rng() < 0.5;
          const rotationY = facesZ
            ? (lz === lotsPerBlockZ - 1 ? 0 : Math.PI)
            : (lx === lotsPerBlockX - 1 ? Math.PI / 2 : -Math.PI / 2);
          instances.push({
            asset: weightedChoice(rng, buildings),
            position: [round(cx), 0, round(cz)],
            rotationY: round(rotationY),
            scale: 1,
          });
        }
      }
    }
  }

  return {
    version: 1,
    generator: 'grid_district',
    seed,
    size: [totalW, totalD],
    blocks,
    instances,
  };
}

const round = (v) => Math.round(v * 1000) / 1000;
