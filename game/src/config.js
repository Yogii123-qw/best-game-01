// Emberfall Arena — configuration and palette.
//
// One place owns every tunable number and every colour, so balancing the
// game means editing this file and nowhere else. The arena is a fixed
// logical field (1280 by 720) that the renderer scales to the window, so
// positions, speeds and hit radii never depend on the screen size.

export const FIELD = { width: 1280, height: 720 };
export const STEP = 1 / 60;
export const TOTAL_WAVES = 10;
export const START_LIVES = 3;
export const BEST_KEY = 'emberfall-arena-best';
export const COMBO_WINDOW = 3.0;
export const WAVE_BREAK = 2.5;

// Neon embers on a starlit night: orange fire, cyan frost and magenta sparks.
export const PALETTE = {
  background: '#070a18',
  backgroundGlow: '#0d1230',
  star: '#cdd8ff',
  ember: '#ff9a2a',
  emberCore: '#ffd166',
  flame: '#ff5d3a',
  frost: '#37e6ff',
  spark: '#ff4fd8',
  danger: '#ff3b5c',
  leaf: '#7dff8a',
  gold: '#ffe066',
  text: '#f4f7ff',
  dimText: '#9aa8d8',
  panel: 'rgba(10, 14, 34, 0.82)',
  panelEdge: 'rgba(120, 150, 255, 0.35)',
};

export const PLAYER = {
  radius: 16,
  speed: 330,
  fireInterval: 0.16,
  bulletSpeed: 720,
  bulletRadius: 5,
  bulletDamage: 1,
  invulnerableSeconds: 1.6,
};

// kind -> shape, colour, movement and reward. Shooters only join late waves.
export const ENEMY_KINDS = {
  drifter: { radius: 20, speed: 62, hp: 2, score: 100, colour: PALETTE.ember, ring: PALETTE.flame },
  rusher: { radius: 15, speed: 150, hp: 1, score: 150, colour: PALETTE.spark, ring: PALETTE.danger },
  shooter: { radius: 18, speed: 95, hp: 3, score: 250, colour: PALETTE.frost, ring: '#b8f6ff' },
};

export const PICKUPS = {
  heart: { radius: 14, colour: PALETTE.danger, life: 9 },
  shard: { radius: 12, colour: PALETTE.gold, life: 9 },
  shield: { radius: 14, colour: PALETTE.frost, life: 9 },
};

// Drop chances on an enemy kill: a heart is rare, a shard is common.
export const DROP_CHANCE = { heart: 0.04, shard: 0.16, shield: 0.07 };

export function waveSize(wave) {
  return 4 + wave * 2;
}

export function waveSpeedScale(wave) {
  return 1 + (wave - 1) * 0.07;
}

export function enemyKindsForWave(wave) {
  const kinds = ['drifter', 'rusher'];
  if (wave >= 3) kinds.push('shooter');
  return kinds;
}

export function comboMultiplier(combo) {
  return 1 + Math.min(combo, 20) * 0.1;
}
