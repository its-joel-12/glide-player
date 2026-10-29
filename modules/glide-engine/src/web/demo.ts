/**
 * A synthetic 24 fps clip (a city at dusk panning sideways, a bouncing ball, fence posts rushing
 * past) drawn on a canvas, so the web version can show what MEMC does without a video file.
 */
export const DEMO_URI = 'glide:demo';
export const DEMO_FPS = 24;
export const DEMO_LENGTH = 40;
export const DEMO_W = 1280;
export const DEMO_H = 720;

const hsh = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function drawDemo(c: CanvasRenderingContext2D, t: number, index: number) {
  const W = DEMO_W;
  const H = DEMO_H;
  const ground = H * 0.78;
  const g = c.createLinearGradient(0, 0, 0, ground);
  g.addColorStop(0, '#16223f');
  g.addColorStop(0.55, '#8d4f5c');
  g.addColorStop(1, '#efa865');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#ffe0a8';
  c.beginPath();
  c.arc(W * 0.7, H * 0.44, 64, 0, 7);
  c.fill();

  let off = t * 40;
  c.fillStyle = '#5b3a5c';
  c.beginPath();
  c.moveTo(0, ground);
  for (let x = 0; x <= W; x += 8) {
    const X = x + off;
    c.lineTo(x, H * 0.52 - 52 * Math.sin(X * 0.0045) - 24 * Math.sin(X * 0.013 + 1.3));
  }
  c.lineTo(W, ground);
  c.closePath();
  c.fill();

  off = t * 220;
  const bw = 96;
  for (let k = Math.floor(off / bw) - 1; k < Math.floor(off / bw) + W / bw + 2; k++) {
    const x = k * bw - off;
    const hh = 150 + hsh(k) * 250;
    const w = bw - 8 - hsh(k + 9) * 22;
    const y = ground - hh;
    c.fillStyle = hsh(k + 3) > 0.5 ? '#2b2242' : '#352a4d';
    c.fillRect(x, y, w, hh);
    c.fillStyle = '#ffcf7a';
    for (let iy = 0; y + 14 + iy * 18 < ground - 12; iy++)
      for (let ix = 0; 10 + ix * 14 < w - 10; ix++) if (hsh(k * 131 + iy * 17.3 + ix * 3.7) > 0.52) c.fillRect(x + 10 + ix * 14, y + 14 + iy * 18, 6, 9);
  }

  c.fillStyle = '#1b1722';
  c.fillRect(0, ground, W, H - ground);
  off = t * 640;
  c.fillStyle = '#e9e2d4';
  for (let k = Math.floor(off / 150) - 1; k < Math.floor(off / 150) + W / 150 + 2; k++) c.fillRect(k * 150 - off, ground + 14, 14, 74);
  c.fillStyle = '#f2c14e';
  for (let k = Math.floor(off / 220) - 1; k < Math.floor(off / 220) + W / 220 + 2; k++) c.fillRect(k * 220 - off, H - 34, 110, 8);

  const bx = ((t * 380) % (W + 200)) - 100;
  const by = H * 0.6 - Math.abs(Math.sin(t * 2.4)) * 250;
  c.save();
  c.translate(bx, by);
  c.rotate(t * 3);
  c.fillStyle = '#3fa7d6';
  c.beginPath();
  c.arc(0, 0, 38, 0, 7);
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillRect(-38, -7, 76, 14);
  c.restore();

  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(W / 2 - 150, 18, 300, 40);
  c.fillStyle = '#ffffff';
  c.font = '500 20px monospace';
  c.textBaseline = 'middle';
  c.fillText(`24 FPS  FRAME ${String(index).padStart(4, '0')}`, W / 2 - 136, 39);
}
