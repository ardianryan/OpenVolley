import { describe, expect, test } from 'bun:test';
import {
  computeScaledDimensions,
  isHeicHeaderOrFile,
  isQuickTimeMovHeaderOrFile,
} from './media-detect';

describe('iPhone HEIC & QuickTime MOV Detection & Smart Scaling', () => {
  test('detects HEIC via ISO-BMFF ftypheic / ftypmif1 magic bytes even when MIME is stripped', () => {
    // 00 00 00 18 "ftypheic"
    const heicBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ]);
    expect(isHeicHeaderOrFile(heicBytes, 'IMG_4021', 'application/octet-stream')).toBe(true);
    expect(isHeicHeaderOrFile(new Uint8Array(4), 'IMG_4022.HEIC', '')).toBe(true);
    expect(
      isHeicHeaderOrFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'logo.png', 'image/png')
    ).toBe(false);
  });

  test('detects QuickTime MOV via ftypqt magic bytes or .MOV extension', () => {
    // 00 00 00 14 "ftypqt  "
    const movBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    ]);
    expect(isQuickTimeMovHeaderOrFile(movBytes, 'clip.bin', '')).toBe(true);
    expect(isQuickTimeMovHeaderOrFile(new Uint8Array(4), 'IMG_8812.MOV', '')).toBe(true);
    expect(isQuickTimeMovHeaderOrFile(new Uint8Array(4), 'clip.mp4', 'video/mp4')).toBe(false);
  });

  test('scales 48MP iPhone Pro photos (8064x6048) down cleanly to 2160px while preserving small logos', () => {
    const pro48mp = computeScaledDimensions(8064, 6048, 2160);
    expect(pro48mp.resized).toBe(true);
    expect(pro48mp.width).toBe(2160);
    expect(pro48mp.height).toBe(1620);

    const smallLogo = computeScaledDimensions(512, 512, 1200);
    expect(smallLogo.resized).toBe(false);
    expect(smallLogo.width).toBe(512);
  });
});
