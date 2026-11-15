// Challenges for Emberfall Arena: three badges, earned only when the run
// really did it.
//
// The catalog is deliberately tight — one badge per kind of mastery — so
// the title can show all three in one short line and the player always
// knows what the next mountain is. A badge is a personal milestone kept
// in the player's own browser: there is no leaderboard and no server, so
// nothing here is a verified credential, and the game never claims it is.
//
// Evaluation is a pure function of the finished run's measured state, so
// it can be tested without a browser: a badge is earned when its test
// passes on the run that just ended, and never otherwise. Pausing,
// restarting or replaying a seed cannot fabricate a run's stats.

import { BADGE_KEY } from './config.js';

export const BADGES = [
  {
    id: 'flawless',
    label: 'FLAWLESS',
    test: (state, won) => won && state.hitsTaken === 0 && state.blocksTaken === 0,
  },
  {
    id: 'wave10',
    label: 'WAVE 10',
    test: (state) => state.maxWave >= 10,
  },
  {
    id: 'combo12',
    label: 'COMBO ×12',
    test: (state) => state.maxCombo >= 12,
  },
];

const KNOWN_IDS = new Set(BADGES.map((badge) => badge.id));

export function loadBadges() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BADGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id) => KNOWN_IDS.has(id)))];
  } catch {
    return [];
  }
}

export function saveBadges(ids) {
  try {
    window.localStorage.setItem(BADGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be off: badges then last this visit only, like the best score.
  }
}

// The badges this run newly earned: tested, not yet owned, in catalog order.
export function evaluateBadges(state, won, earned) {
  const owned = new Set(earned);
  return BADGES.filter((badge) => !owned.has(badge.id) && badge.test(state, won))
    .map((badge) => badge.id);
}
