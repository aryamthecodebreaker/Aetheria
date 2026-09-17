import { BLOCKS } from '../../shared/blocks';
import { CHUNK } from '../../shared/constants';

export const TILE = 16;
export const TILE_STRIDE = TILE + 2;
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = Math.ceil(BLOCKS.length * 3 / ATLAS_COLUMNS);
export const ATLAS_WIDTH = ATLAS_COLUMNS * TILE_STRIDE;
export const ATLAS_HEIGHT = ATLAS_ROWS * TILE_STRIDE;
export const PAD = CHUNK + 2;
export const paddedIndex = (x: number, y: number, z: number) => x + 1 + (z + 1) * PAD + y * PAD * PAD;
export const tileIndex = (id: number, face: number) => id * 3 + (face === 2 ? 0 : face === 3 ? 2 : 1);

export type GeometryData = {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  index: Uint32Array;
};
export type MeshJob = { key: string; revision: number; data: Uint16Array };
export type MeshResult = { key: string; revision: number; solid: GeometryData; water: GeometryData };
