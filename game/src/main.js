// Boot and the one loop of Emberfall Arena.
//
// Input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints
// what is there. The game moves between five screens: title, play, paused,
// victory and game over. End screens keep their ambient layer moving
// (particles, embers, banners) while the rules stay frozen.
//
// Kills freeze the simulation for a few frames (hit-stop): the weight of
// a kill is felt, not just seen. The freeze is render-loop only — the
// staged screenshot path never sees it.
//
// ?seed=N fixes the arena's random pattern. ?shot=start|play|combo|win|end
// (with &seed=N) stages that scene instead of running the loop, paints it
// twice and sets window.__shotReady for a screenshot.

import { BEST_KEY, BUTTONS, HIT_STOP_KILL, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  EVENT_HIT, EVENT_KILL, EVENT_OVER, EVENT_PICKUP, EVENT_SHIELD_BLOCK,
  EVENT_SHOOT, EVENT_WAVE_CLEAR, EVENT_WAVE_START, EVENT_WON, createWorld,
} from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createSound } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WON } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const sound = createSound();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

// A handle for automated play-testing: the live state and screen, read-only.
window.__emberfall = { state: world.state, get screen() { return currentScreen; } };
let currentScreen = SCREEN_TITLE;

function runShot(name) {
  const scene = stageShot(name, world);
  // A staged frame must be exactly reproducible: no shake offset.
  world.state.shake = 0;
  currentScreen = scene.screen;
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, sound.isMuted(), null, false);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  function pointInButton(clientX, clientY, button) {
    const point = renderer.toLogical(clientX, clientY);
    return point.x >= button.x && point.x <= button.x + button.size
      && point.y >= button.y && point.y <= button.y + button.size;
  }

  function isUiPoint(clientX, clientY) {
    return pointInButton(clientX, clientY, BUTTONS.mute) || pointInButton(clientX, clientY, BUTTONS.pause);
  }

  const input = createInput(canvas, isUiPoint);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let newBest = false;
  let accumulator = 0;
  let last = performance.now();
  let hitStopUntil = 0;
  let lastShootSound = 0;

  // Screen readers (and anyone watching the page's text) hear the changes.
  function announce(message) {
    status.textContent = message;
  }

  function syncScreen(next) {
    screen = next;
    currentScreen = next;
  }

  function toggleMute() {
    const muted = sound.toggleMute();
    announce(muted ? 'Sound off.' : 'Sound on.');
  }

  function togglePause() {
    if (screen === SCREEN_PLAY) {
      syncScreen(SCREEN_PAUSED);
      announce('Paused.');
    } else if (screen === SCREEN_PAUSED) {
      syncScreen(SCREEN_PLAY);
      announce('Playing.');
    }
  }

  function startGame() {
    sound.unlock();
    world.reset();
    newBest = false;
    accumulator = 0;
    hitStopUntil = 0;
    syncScreen(SCREEN_PLAY);
    announce('Playing. Three hearts. Survive ten waves.');
  }

  function endGame(won) {
    syncScreen(won ? SCREEN_WON : SCREEN_OVER);
    newBest = world.state.score > best && world.state.score > 0;
    if (newBest) {
      best = world.state.score;
      saveBest(best);
    }
    if (won) sound.win();
    else sound.lose();
    announce(won
      ? `Victory! Score ${world.state.score}. Best ${best}.`
      : `Game over. Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) toggleMute();
    if (actions & ACTION_RESTART && screen !== SCREEN_TITLE) {
      startGame();
      return;
    }
    if (actions & ACTION_CONFIRM) {
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_WON) startGame();
      else if (screen === SCREEN_PAUSED) syncScreen(SCREEN_PLAY);
      return;
    }
    if (actions & ACTION_PAUSE) togglePause();
    // HUD buttons first: a click on one must never start the game or fire.
    const clickPoint = input.takeClickPoint();
    if (clickPoint) {
      if (pointInButton(clickPoint.x, clickPoint.y, BUTTONS.mute)) {
        toggleMute();
        return;
      }
      if ((screen === SCREEN_PLAY || screen === SCREEN_PAUSED)
        && pointInButton(clickPoint.x, clickPoint.y, BUTTONS.pause)) {
        togglePause();
        return;
      }
    }
    if (input.takeClick()) {
      sound.unlock();
      if (screen === SCREEN_TITLE || screen === SCREEN_OVER || screen === SCREEN_WON) startGame();
      else if (screen === SCREEN_PAUSED) syncScreen(SCREEN_PLAY);
    }
  }

  function playEvents(events, now) {
    if (events & EVENT_KILL) {
      sound.kill();
      hitStopUntil = now + HIT_STOP_KILL * 1000;
    }
    if (events & EVENT_SHOOT && now - lastShootSound > 90) {
      lastShootSound = now;
      sound.shoot();
    }
    if (events & EVENT_HIT) sound.hurt();
    if (events & EVENT_SHIELD_BLOCK) sound.hit();
    if (events & EVENT_PICKUP) sound.pickup();
    if (events & EVENT_WAVE_CLEAR) sound.waveClear();
    if (events & EVENT_WAVE_START) sound.waveStart();
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { x: 0, y: 0 }, false, 0, true);
      return;
    }
    const mouse = input.mouse();
    const aimPoint = renderer.toLogical(mouse.x, mouse.y);
    const aim = Math.atan2(aimPoint.y - world.state.player.y, aimPoint.x - world.state.player.x);
    const events = world.step(STEP, input.direction(), mouse.firing, aim);
    playEvents(events, performance.now());
    if (events & EVENT_WON) endGame(true);
    else if (events & EVENT_OVER) endGame(false);
    else if (events & EVENT_HIT) {
      announce(world.state.lives === 1 ? 'Hit. One heart left.' : `Hit. ${world.state.lives} hearts left.`);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      if (now < hitStopUntil) {
        accumulator = 0;
      } else {
        accumulator += elapsed;
        while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
          step();
          accumulator -= STEP;
        }
      }
    } else if (screen === SCREEN_OVER || screen === SCREEN_WON) {
      // End screens stay alive: particles drift, the banner fades, the
      // prompt pulses. The rules themselves do not advance.
      accumulator = 0;
      world.tick(elapsed);
    } else {
      accumulator = 0;
    }
    const mouse = input.mouse();
    const mouseLogical = renderer.toLogical(mouse.x, mouse.y);
    renderer.draw(world.state, screen, best, sound.isMuted(), mouseLogical, newBest);
  }

  // Leaving the tab pauses a running game rather than letting embers fall unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      syncScreen(SCREEN_PAUSED);
      announce('Paused.');
    }
  });

  announce('Emberfall Arena. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
