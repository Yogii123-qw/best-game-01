// Screenshot scenes for Emberfall Arena.
//
// Each scene plays the real rules forward from a fresh world for a fixed
// number of steps, steered by an autopilot, so the frame is what a short
// game really looks like and the same seed always gives the same frame.
// The strong pilot aims at the nearest ember, kites away from threats and
// chases pickups; the idle pilot never fires, so it is caught out and the
// game ends — as a hurried player is.

import { FIELD, STEP } from './config.js';
import { EVENT_OVER, EVENT_WON } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON } from './render.js';

const START_SECONDS = 5;
const PLAY_LIMIT_SECONDS = 150;
const COMBO_LIMIT_SECONDS = 300;
const WIN_LIMIT_SECONDS = 900;
const END_LIMIT_SECONDS = 600;

/** Aim at the nearest ember and move: flee what is close, close in otherwise. */
function strongPilot(state) {
  const player = state.player;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = enemy;
    }
  }
  let moveX = 0;
  let moveY = 0;
  let aim = player.angle;
  let firing = false;
  if (nearest) {
    aim = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    firing = true;
    // Flee anything about to touch the wisp, including enemy fire.
    let threatX = 0;
    let threatY = 0;
    let threats = 0;
    for (const enemy of state.enemies) {
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 170) {
        threatX += dx / distance;
        threatY += dy / distance;
        threats += 1;
      }
    }
    for (const bullet of state.enemyBullets) {
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 130) {
        threatX += dx / distance;
        threatY += dy / distance;
        threats += 1;
      }
    }
    if (threats > 0) {
      const length = Math.hypot(threatX, threatY) || 1;
      moveX = threatX / length;
      moveY = threatY / length;
    } else if (nearestDistance > 260) {
      moveX = (nearest.x - player.x) / nearestDistance;
      moveY = (nearest.y - player.y) / nearestDistance;
    } else {
      // Strafe sideways at mid range so shots keep landing.
      moveX = -Math.sin(aim);
      moveY = Math.cos(aim);
    }
    // A nearby pickup is worth a detour when nothing threatens.
    if (threats === 0 && state.pickups.length > 0) {
      const pickup = state.pickups[0];
      const distance = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      if (distance < 220) {
        moveX = (pickup.x - player.x) / distance;
        moveY = (pickup.y - player.y) / distance;
      }
    }
  } else {
    // Between waves, drift back to the middle of the arena.
    const dx = FIELD.width / 2 - player.x;
    const dy = FIELD.height / 2 - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 40) {
      moveX = dx / distance;
      moveY = dy / distance;
    }
  }
  const length = Math.hypot(moveX, moveY) || 1;
  return { move: { x: moveX / length, y: moveY / length }, aim, firing };
}

function idlePilot(state) {
  return { move: { x: Math.sin(state.time * 0.7) * 0.5, y: Math.cos(state.time * 0.5) * 0.5 }, aim: 0, firing: false };
}

/**
 * Set `world` to the named scene (start, play, combo, win or end) and return
 * the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'combo' && name !== 'win' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      world.step(STEP, { x: 0, y: 0 }, false, 0, true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'end') {
    for (let index = 0; index < END_LIMIT_SECONDS / STEP; index += 1) {
      const pilot = idlePilot(world.state);
      if (world.step(STEP, pilot.move, pilot.firing, pilot.aim) & EVENT_OVER) break;
    }
    return { screen: SCREEN_OVER, best: world.state.score };
  }
  const limit = name === 'win' ? WIN_LIMIT_SECONDS : name === 'combo' ? COMBO_LIMIT_SECONDS : PLAY_LIMIT_SECONDS;
  for (let index = 0; index < limit / STEP; index += 1) {
    const pilot = strongPilot(world.state);
    const events = world.step(STEP, pilot.move, pilot.firing, pilot.aim);
    if (events & EVENT_WON) return { screen: SCREEN_WON, best: world.state.score };
    if (events & EVENT_OVER) break;
    // Play: hold the frame mid-wave, with the arena still full of embers.
    if (name === 'play' && world.state.wave >= 2 && world.state.enemies.length >= 7) {
      return { screen: SCREEN_PLAY, best: world.state.score };
    }
    if (name === 'combo' && world.state.wave >= 5 && world.state.combo >= 8 && world.state.enemies.length >= 5) {
      // Hold the frame while the combo is still burning and the fight is on.
      return { screen: SCREEN_PLAY, best: world.state.score };
    }
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
