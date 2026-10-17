// One fixed palette for the whole game.
export const P = {
  ink: '#1a1c2c',
  black: '#15161f',
  white: '#f6f6f2',

  // sky, bottom of the tower (sunset) to the top (night)
  sky: ['#0d0b20', '#141130', '#1b1838', '#2a2152', '#43306c', '#6b3a78', '#a24f7c', '#d9677a', '#f28a68', '#f7a96f'],
  star: '#ffeedd',
  starDim: '#9a8fc0',
  moon: '#fff1c9',
  moonShade: '#e8cf96',
  city: '#36285a',
  cityFar: '#4a3570',
  cityWin: '#ffcd78',
  crane: '#271f45',
  cloud: '#c98bb0',
  cloudNight: '#4c4378',
  sun0: '#ffcf7a',
  sun1: '#ffa86b',

  // girders
  g0: '#5e1a10',
  g1: '#7e2414',
  g2: '#a8321f',
  g3: '#c9402b',
  g4: '#e8664c',
  g5: '#f39a80',

  // goop
  p0: '#2e1259',
  p1: '#4e2290',
  p2: '#7b3fc4',
  p3: '#a774f0',
  p4: '#d6b4ff',

  // steel
  s0: '#23263a',
  s1: '#3d4257',
  s2: '#6b7190',
  s3: '#9aa0b8',
  s4: '#d5d9e8',

  r0: '#a3262b',
  r1: '#e5484d',
  r2: '#ff8a8d',
  y0: '#c48a10',
  y1: '#ffc23a',
  y2: '#ffe28a',
  c0: '#14808f',
  c1: '#2ec4d6',
  c2: '#9ff3ff',
  green: '#5fd068',

  skin: '#c68a62',
  skinS: '#a86e4a',
  hair: '#4a2e22',
  b0: '#2250c9',
  b1: '#2f6bff',
  b2: '#6a96ff',
  o0: '#d9581a',
  o1: '#ff7a2f',
  n0: '#1e2238',
  n1: '#2e3456',
  wood: '#c98b4a',
  woodD: '#8a5a2a',
  rope: '#dcbc80',
  ropeD: '#9c7a42',
  sweat: '#9fe3ff',

  dirt0: '#1a1426',
  dirt1: '#2a1f35',
  concrete0: '#4a4558',
  concrete1: '#5f5a6e',
  concrete2: '#77718a',
} as const;

const hexCache = new Map<string, [number, number, number]>();
export function rgb(hex: string): [number, number, number] {
  let v = hexCache.get(hex);
  if (!v) {
    v = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    hexCache.set(hex, v);
  }
  return v;
}

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
