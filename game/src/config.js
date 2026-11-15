// Emberfall Arena — configuration and palette.
//
// One place owns every tunable number and every colour, so balancing the
// game means editing this file and nowhere else. The arena is a fixed
// logical field (1280 by 720) that the renderer scales to the window, so
// positions, speeds and hit radii never depend on the screen size.
//
// Balance targets (measured with bot pilots over 20 seeds, see NOTES):
// a skilled player should win most runs in about three minutes, a casual
// player should reach the middle waves and sometimes win, and a player
// who never acts should always lose quickly.

export const FIELD = { width: 1280, height: 720 };
export const STEP = 1 / 60;
export const TOTAL_WAVES = 10;
export const START_LIVES = 3;
export const MAX_LIVES = 5;
export const BEST_KEY = 'emberfall-arena-best';
export const COMBO_WINDOW = 2.2;
export const WAVE_BREAK = 2.5;

// A spawning enemy shows a warning ring for this long before it can move
// or be hit: every arrival is telegraphed, never a surprise.
export const SPAWN_TELEGRAPH = 0.6;
// Kills scored close to the wisp pay extra: risk is rewarded, and the
// bonus is discovered through play, never explained up front.
export const CLOSE_RANGE = 200;
export const CLOSE_MULT = 1.5;
// Clearing one of these waves while hurt restores one heart; at full
// starting health it pays score instead, so recovery never dulls tension.
export const RECOVERY_WAVES = [3, 6, 9];
export const RECOVERY_SCORE = 500;
// Hit-stop on a kill only, kept short: weight without sluggishness.
export const HIT_STOP_KILL = 0.045;

// Surge waves: one wave per run, picked from the run's own seed, arrives
// heavier and faster, announced by its banner. Never wave 1, 2 or the
// finale, so the lesson waves and the last stand stay as designed.
export const SURGE_MIN_WAVE = 3;
export const SURGE_MAX_WAVE = 8;
export const SURGE_EXTRA_FRACTION = 0.5;
export const SURGE_PACE_FACTOR = 0.75;

// Lightning arcs: the payoff for a close kill or a combo milestone. An
// arc leaps to the nearest live ember in range and stings it for a small
// amount; arcs never chain, so one kill can never cascade.
// Lightning arcs are visual-only: the balance simulation showed 1 damage
// per arc doubling the casual pilot's win rate (35% -> 70% over 20
// seeds), while 0 damage held every pilot's rate at the baseline.
// The world still accepts an arcDamage option for future tuning; the
// shipped default stays 0 unless a later sim says otherwise.
export const ARC_DAMAGE = 0;
export const ARC_RANGE = 260;
export const ARC_LIFE = 0.18;

// Local records: the best score and the earned badges live in the
// player's own browser, nowhere else.
export const BADGE_KEY = 'emberfall-arena-badges';

// Ember night: warm fire on a deep blue field, with frost and spark as
// the two accent voices. Text pairs are checked against WCAG AA.
export const PALETTE = {
  background: '#070a18',
  backgroundGlow: '#101737',
  floorRing: 'rgba(120, 150, 255, 0.07)',
  floorDot: 'rgba(160, 180, 255, 0.10)',
  arenaEdge: 'rgba(120, 150, 255, 0.28)',
  star: '#cdd8ff',
  mote: '#ff9a2a',
  ember: '#ff9a2a',
  emberCore: '#ffd166',
  flame: '#ff5d3a',
  frost: '#37e6ff',
  spark: '#ff4fd8',
  danger: '#ff3b5c',
  leaf: '#7dff8a',
  gold: '#ffe066',
  text: '#f4f7ff',
  dimText: '#aab6e2',
  panel: 'rgba(10, 14, 34, 0.88)',
  panelEdge: 'rgba(120, 150, 255, 0.40)',
  scrim: 'rgba(4, 6, 16, 0.55)',
  buttonFace: '#ffd166',
  buttonText: '#231303',
};

export const PLAYER = {
  radius: 16,
  speed: 330,
  fireInterval: 0.16,
  bulletSpeed: 720,
  bulletRadius: 5,
  bulletDamage: 1,
  invulnerableSeconds: 2.3,
};

// kind -> shape, colour, movement and reward. Rushers join from wave 2,
// shooters from wave 3, so wave 1 teaches aim and fire with drifters only.
export const ENEMY_KINDS = {
  drifter: { radius: 20, speed: 62, hp: 2, score: 100, colour: PALETTE.ember, ring: PALETTE.flame },
  rusher: { radius: 15, speed: 160, hp: 1, score: 150, colour: PALETTE.spark, ring: PALETTE.danger },
  shooter: { radius: 18, speed: 95, hp: 3, score: 250, colour: PALETTE.frost, ring: '#b8f6ff' },
};

// Enemy bullets are faster than the player: running away in a straight
// line is not a free answer to shooters.
export const ENEMY_BULLET_SPEED = 340;
export const ENEMY_BULLET_RADIUS = 6;

export const PICKUPS = {
  heart: { radius: 14, colour: PALETTE.danger, life: 9 },
  shard: { radius: 12, colour: PALETTE.gold, life: 9 },
  shield: { radius: 14, colour: PALETTE.frost, life: 9 },
};

// Drop chances on an enemy kill: a heart is uncommon, a shard is common.
export const DROP_CHANCE = { heart: 0.06, shard: 0.16, shield: 0.07 };

// Clickable HUD buttons, in logical coordinates, bottom right.
export const BUTTONS = {
  mute: { x: 1136, y: 644, size: 52 },
  pause: { x: 1196, y: 644, size: 52 },
};

export function waveSize(wave) {
  return 4 + wave * 2;
}

// Early waves spawn slowly so a first-time player can breathe; the pace
// tightens as the run goes on.
export function spawnInterval(wave) {
  if (wave === 1) return 0.85;
  if (wave === 2) return 0.7;
  if (wave >= TOTAL_WAVES) return 0.42;
  return 0.55;
}

export function waveSpeedScale(wave) {
  return 1 + (wave - 1) * 0.04;
}

export function enemyKindsForWave(wave) {
  if (wave < 2) return ['drifter'];
  const kinds = ['drifter', 'rusher'];
  if (wave >= 3) kinds.push('shooter');
  return kinds;
}

// Every third wave arrives as a ring closing in, so the middle of a run
// never feels like the same trickle twice.
export function wavePattern(wave) {
  return wave % 3 === 0 ? 'ring' : 'edge';
}

export function comboMultiplier(combo) {
  return 1 + Math.min(combo, 20) * 0.1;
}
