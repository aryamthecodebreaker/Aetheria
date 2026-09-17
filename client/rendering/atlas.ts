import * as THREE from 'three';
import { BLOCKS } from '../../shared/blocks';
import { hash2 } from '../../shared/noise';
import { ATLAS_COLUMNS, ATLAS_HEIGHT, ATLAS_WIDTH, TILE, TILE_STRIDE } from './layout';

export function makeAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_WIDTH; canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for voxel textures');
  const image = context.createImageData(canvas.width, canvas.height);
  for (const block of BLOCKS) for (let face = 0; face < 3; face++) {
    const tile = block.id * 3 + face;
    const ox = tile % ATLAS_COLUMNS * TILE_STRIDE, oy = Math.floor(tile / ATLAS_COLUMNS) * TILE_STRIDE;
    for (let py = -1; py <= TILE; py++) for (let px = -1; px <= TILE; px++) {
      const x = Math.max(0, Math.min(TILE - 1, px)), y = Math.max(0, Math.min(TILE - 1, py));
      const n = hash2(x, y, block.id * 37 + face * 113);
      let color = block.color, shade = 0.84 + n * 0.27, alpha = block.id ? 255 : 0;
      const name = block.name;
      if (name === 'grass') {
        if (face === 2 || face === 1 && y > 3 + Math.floor(hash2(x, 0, 71) * 3)) color = BLOCKS[2].color;
        else if (face === 1 && y === 0) shade = 1.2;
      }
      if (name.includes('ore')) {
        const speck = hash2(Math.floor(x / 3), Math.floor(y / 3), block.id * 61);
        color = speck > 0.67 && x % 3 !== 0 && y % 3 !== 0 ? block.color : BLOCKS[3].color;
        if (color === block.color) shade += 0.12;
      }
      if (name === 'log') {
        if (face === 1) shade *= x % 5 === 0 || (x + Math.floor(y / 5)) % 9 === 0 ? 0.55 : 1;
        else {
          color = 0xb08a56;
          const ring = Math.floor(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)));
          shade *= ring % 3 === 0 ? 0.64 : 1.07;
        }
      }
      if (['planks', 'door', 'fence', 'chest', 'workbench'].includes(name)) {
        shade *= y % 5 === 0 || (x + Math.floor(y / 5) * 7) % 16 === 0 ? 0.57 : 1;
        if (hash2(x, Math.floor(y / 2), 633) > 0.89) shade *= 0.8;
      }
      if (name.includes('stone') || ['cobble', 'bricks', 'stone bricks', 'bedrock', 'slab', 'forge'].includes(name)) {
        const row = Math.floor(y / 6);
        if (y % 6 === 0 || (x + row * 5) % 9 === 0) shade *= 0.71;
        else if (y % 6 === 1) shade *= 1.08;
      }
      if (name === 'farmland') shade *= x % 4 < 2 ? 0.65 : 1.1;
      if (name === 'water') {
        shade = 0.85 + n * 0.1;
        if ((x + Math.floor(y / 3) * 3) % 13 < 5 && y % 5 === 0) shade = 1.2;
      }
      if (name === 'leaves') {
        shade *= hash2(Math.floor(x / 2), Math.floor(y / 2), 517) > 0.5 ? 1.1 : 0.76;
        if (n > 0.94) alpha = 0;
      }
      if (name === 'glass') {
        alpha = x === 0 || y === 0 || x === 15 || y === 15 || x === y || x === y + 1 && y < 6 ? 255 : 0;
        shade = 1.05;
      }
      if (name === 'cactus') shade *= x % 4 === 0 ? 0.55 : 1;
      if (block.cross && name !== 'torch') {
        alpha = 0;
        const stem = Math.abs(x - (7 + Math.round(Math.sin(y * 0.4)))) < 1.2 && y > 3;
        const blade = name === 'tallgrass' || block.crop;
        if (blade) {
          for (let stalk = 0; stalk < 4; stalk++) {
            const center = 2 + stalk * 4 + Math.floor((15 - y) / 5) * (stalk % 2 ? 1 : -1);
            if (Math.abs(x - center) <= 1 && y >= 2 + stalk % 3 * 2) alpha = 255;
          }
          if (block.crop && y < 7 && alpha) color = 0xe1c976;
        } else {
          if (stem || y > 8 && y < 12 && Math.abs(x - 7) < 5 - Math.abs(y - 10)) { color = 0x4a873f; alpha = 255; }
          if (Math.abs(x - 7) + Math.abs(y - 4) <= 5 && y < 9) { color = block.color; alpha = 255; }
          if (Math.abs(x - 7) <= 1 && Math.abs(y - 4) <= 1) color = 0xffdc85;
        }
      }
      if (name === 'torch') { color = face === 0 || face === 1 && y < 5 ? 0xffd784 : 0x785133; shade = y < 3 ? 1.15 : shade; }
      if (name.includes('lamp')) {
        const frame = x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
        color = frame ? 0x665044 : block.color;
        shade = frame ? 0.9 : 0.9 + (1 - Math.hypot(x - 7.5, y - 7.5) / 11) * 0.3;
      }
      if (name === 'chest') {
        if (x < 2 || x > 13 || y === 5 || y === 6 || y > 13) { color = 0x4d3b30; shade = 1; }
        if (face === 1 && x >= 6 && x <= 9 && y >= 5 && y <= 9) { color = 0xe3c478; shade = 1; }
      }
      if (name === 'workbench' && face === 0 && (x % 5 === 0 || y % 5 === 0)) color = 0x513d30;
      if (name === 'forge' && face === 1 && x > 2 && x < 13 && y > 5 && y < 14) {
        color = y > 10 ? (n > 0.5 ? 0xffb34c : 0xe96b33) : 0x28272d; shade = 1;
      }
      if (name === 'magma') { color = (x + Math.floor(y / 4) * 3) % 7 < 2 || y % 7 === 0 ? 0xffb152 : 0x603b36; }
      if (name.includes('portal')) { shade = 0.65 + (Math.sin((x + y) * 0.65) + 1) * 0.28; }
      const i = ((oy + py + 1) * ATLAS_WIDTH + ox + px + 1) * 4;
      image.data[i] = Math.min(255, (color >> 16 & 255) * shade);
      image.data[i + 1] = Math.min(255, (color >> 8 & 255) * shade);
      image.data[i + 2] = Math.min(255, (color & 255) * shade);
      image.data[i + 3] = alpha;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = 'Aetheria procedural voxel atlas';
  return texture;
}
