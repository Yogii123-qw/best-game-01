// All rendering for Emberfall Arena.
//
// One renderer owns the canvas transform (the 1280x720 logical field is
// scaled to fit the window), the arena floor, every entity, the HUD and
// the title, pause, victory and game-over screens. Nothing here touches
// game rules; it only paints the state the world hands it.
//
// Component vocabulary (one name each, reused on every screen): Wordmark,
// HudBar, IconButton, Banner, Panel, Reticle, Floater, Telegraph, Wisp,
// Ember, PickupGlyph, Thumbstick, Ghost, Arc, Lance, GoalsRow. One screen
// carries one idea; one panel carries one primary action.

import {
  BUTTONS, COMBO_WINDOW, FIELD, MAX_LIVES, PALETTE, PICKUPS, PLAYER,
  SPAWN_TELEGRAPH, TOTAL_WAVES, comboMultiplier,
} from './config.js';
import { BADGES } from './challenges.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WON = 'won';

// Easing for every UI transition (exported so the harness can prove the
// curves are smooth rather than stepped): easeOutCubic is the default
// settle, easeOutBack is the panel pop.
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function easeOutCubic(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp01(t) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function heartPath(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.9);
  ctx.bezierCurveTo(x - size * 1.2, y, x - size * 0.6, y - size, x, y - size * 0.3);
  ctx.bezierCurveTo(x + size * 0.6, y - size, x + size * 1.2, y, x, y + size * 0.9);
  ctx.closePath();
}

function starPath(ctx, x, y, points, outer, inner, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2 + rotation;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function formatTime(seconds) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    scale = Math.min(canvas.width / FIELD.width, canvas.height / FIELD.height);
    offsetX = (canvas.width - FIELD.width * scale) / 2;
    offsetY = (canvas.height - FIELD.height * scale) / 2;
  }

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const x = (clientX - rect.left) * ratio;
    const y = (clientY - rect.top) * ratio;
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
  }

  // Staggered entrances, driven by seconds since the screen appeared.
  // Staged frames and callers without a clock render the rested state,
  // so a screenshot is always the finished layout, never mid-slide.
  function entrance(ui, delay, duration) {
    if (ui.instant || ui.uiTime === undefined) return { alpha: 1, dy: 0 };
    const eased = easeOutCubic((ui.uiTime - delay) / duration);
    return { alpha: eased, dy: (1 - eased) * 16 };
  }

  function panelPop(ui, duration = 0.28) {
    if (ui.instant || ui.uiTime === undefined) return { scale: 1, alpha: 1 };
    const p = clamp01(ui.uiTime / duration);
    return { scale: 0.92 + 0.08 * easeOutBack(p), alpha: easeOutCubic(p) };
  }

  function drawBackground(state) {
    const gradient = ctx.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, 80,
      FIELD.width / 2, FIELD.height / 2, 780,
    );
    gradient.addColorStop(0, PALETTE.backgroundGlow);
    gradient.addColorStop(1, PALETTE.background);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    // Faint floor grid: dots, not lines, so the field reads as a place
    // without shouting over the fight.
    ctx.fillStyle = PALETTE.floorDot;
    for (let x = 80; x < FIELD.width; x += 80) {
      for (let y = 80; y < FIELD.height; y += 80) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    ctx.strokeStyle = PALETTE.floorRing;
    ctx.lineWidth = 1.5;
    for (const radius of [130, 250, 370]) {
      ctx.beginPath();
      ctx.arc(FIELD.width / 2, FIELD.height / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const star of state.stars) {
      const alpha = 0.35 + 0.55 * Math.abs(Math.sin(star.twinkle));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.star;
      ctx.beginPath();
      // Parallax: far stars barely move with the wisp, near stars drift
      // more, so the field has depth. Positions wrap, so no star is lost.
      const depth = star.depth ?? 1;
      const px = (state.player.x - FIELD.width / 2) * 0.03 * depth;
      const py = (state.player.y - FIELD.height / 2) * 0.03 * depth;
      const x = ((star.x - px) % FIELD.width + FIELD.width) % FIELD.width;
      const y = ((star.y - py) % FIELD.height + FIELD.height) % FIELD.height;
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Rising ember motes: the arena breathes even when nothing fights.
    for (const mote of state.motes) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = PALETTE.mote;
      ctx.beginPath();
      const depth = mote.depth ?? 1;
      const px = (state.player.x - FIELD.width / 2) * 0.05 * depth;
      const py = (state.player.y - FIELD.height / 2) * 0.05 * depth;
      ctx.arc(mote.x - px, mote.y - py, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The arena boundary: a quiet glowing wall, so the play space has an
    // edge the eye can find.
    ctx.strokeStyle = PALETTE.arenaEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(10, 10, FIELD.width - 20, FIELD.height - 20, 16);
    ctx.stroke();
  }

  function drawWisp(x, y, radius, time, angle) {
    const flicker = (1 + Math.sin(time * 14) * 0.08) * (1 + Math.sin(time * 3) * 0.05);
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowBlur = 26;
    ctx.shadowColor = PALETTE.ember;
    const flame = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 1.7 * flicker);
    flame.addColorStop(0, PALETTE.emberCore);
    flame.addColorStop(0.55, PALETTE.ember);
    flame.addColorStop(1, 'rgba(255, 93, 58, 0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.7 * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.emberCore;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);
    ctx.fillStyle = '#1b0d02';
    ctx.beginPath();
    ctx.arc(6, -5, 2.6, 0, Math.PI * 2);
    ctx.arc(6, 5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer(state) {
    const player = state.player;
    if (player.invulnerable > 0 && Math.floor(state.time * 12) % 2 === 0 && state.phase !== 'over') return;
    // Comet tail, opposite the direction of travel.
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 30) {
      const nx = -player.vx / speed;
      const ny = -player.vy / speed;
      ctx.save();
      ctx.translate(player.x, player.y);
      for (const [length, width, alpha] of [[34, 12, 0.35], [22, 8, 0.5], [12, 5, 0.7]]) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = PALETTE.flame;
        ctx.beginPath();
        ctx.moveTo(nx * 4 - ny * width / 2, ny * 4 + nx * width / 2);
        ctx.lineTo(nx * length, ny * length);
        ctx.lineTo(nx * 4 + ny * width / 2, ny * 4 - nx * width / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    drawWisp(player.x, player.y, PLAYER.radius * (player.muzzle > 0 ? 1.12 : 1), state.time, player.angle);
    // Muzzle flash: a brief star at the gun tip when a shot leaves.
    if (player.muzzle > 0) {
      const tipX = player.x + Math.cos(player.angle) * (PLAYER.radius + 8);
      const tipY = player.y + Math.sin(player.angle) * (PLAYER.radius + 8);
      ctx.save();
      ctx.globalAlpha = Math.max(0, player.muzzle / 0.05);
      ctx.fillStyle = PALETTE.emberCore;
      ctx.shadowBlur = 16;
      ctx.shadowColor = PALETTE.emberCore;
      starPath(ctx, tipX, tipY, 4, 13, 4, player.angle);
      ctx.fill();
      ctx.restore();
    }
    if (player.shield) {
      ctx.save();
      ctx.strokeStyle = PALETTE.frost;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(state.time * 6);
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER.radius + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemy(enemy, time) {
    // Telegraph: a closing warning ring and a fading-in body. Nothing
    // appears without announcing itself first.
    if (enemy.spawning > 0) {
      const progress = 1 - enemy.spawning / SPAWN_TELEGRAPH;
      ctx.save();
      ctx.strokeStyle = PALETTE.danger;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius * (1.7 - 0.7 * progress), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.25 + 0.75 * progress;
      ctx.translate(enemy.x, enemy.y);
      ctx.scale(0.6 + 0.4 * progress, 0.6 + 0.4 * progress);
      ctx.fillStyle = ENEMY_FILL[enemy.kind];
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    // Squash: a fresh hit compresses the body for a few frames, so the
    // impact reads as weight, not just a colour blink.
    const hit = enemy.flash > 0 ? enemy.flash / 0.07 : 0;
    if (hit > 0) ctx.scale(1 + hit * 0.18, 1 - hit * 0.12);
    if (enemy.kind === 'drifter') {
      ctx.shadowBlur = 18;
      ctx.shadowColor = PALETTE.ember;
      ctx.fillStyle = PALETTE.ember;
      starPath(ctx, 0, 0, 6, enemy.radius * 1.15, enemy.radius * 0.68, time * 0.5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.flame;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.emberCore;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.kind === 'rusher') {
      ctx.rotate(enemy.angle);
      ctx.shadowBlur = 16;
      ctx.shadowColor = PALETTE.spark;
      ctx.fillStyle = PALETTE.spark;
      ctx.beginPath();
      ctx.moveTo(enemy.radius + 8, 0);
      ctx.lineTo(-enemy.radius, -enemy.radius * 0.85);
      ctx.lineTo(-enemy.radius * 0.4, 0);
      ctx.lineTo(-enemy.radius, enemy.radius * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(enemy.radius * 0.25, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowBlur = 18;
      ctx.shadowColor = PALETTE.frost;
      ctx.fillStyle = PALETTE.frost;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#e8fdff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 6 + Math.sin(time * 5) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#062a33';
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Hit flash: the struck body blinks white for a few frames.
    if (enemy.flash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, enemy.flash / 0.07) * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (enemy.hp < enemy.maxHp) {
      const width = enemy.radius * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 12, width, 5);
      ctx.fillStyle = PALETTE.danger;
      ctx.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 12, width * (enemy.hp / enemy.maxHp), 5);
    }
  }

  function drawPickups(state) {
    for (const pickup of state.pickups) {
      const bob = Math.sin(pickup.bob) * 3;
      const pulse = 1 + Math.sin(pickup.bob * 1.7) * 0.1;
      const y = pickup.y + bob;
      ctx.save();
      ctx.translate(pickup.x, y);
      ctx.scale(pulse, pulse);
      ctx.shadowBlur = 14;
      // A breathing halo behind the glyph: pickups glow before they are read.
      ctx.globalAlpha = 0.16 + 0.05 * Math.sin(pickup.bob * 1.7);
      ctx.fillStyle = PICKUPS[pickup.kind].colour;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (pickup.kind === 'heart') {
        ctx.shadowColor = PALETTE.danger;
        ctx.fillStyle = PALETTE.danger;
        heartPath(ctx, 0, 0, 12);
        ctx.fill();
      } else if (pickup.kind === 'shard') {
        ctx.shadowColor = PALETTE.gold;
        ctx.fillStyle = PALETTE.gold;
        starPath(ctx, 0, 0, 5, 14, 6);
        ctx.fill();
        ctx.fillStyle = '#fff7cc';
        starPath(ctx, 0, 0, 5, 7, 3);
        ctx.fill();
      } else {
        ctx.shadowColor = PALETTE.frost;
        ctx.strokeStyle = PALETTE.frost;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = PALETTE.frost;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawFloaters(state) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 20px ${FONT}`;
    for (const floater of state.floaters) {
      ctx.globalAlpha = Math.max(0, floater.life / floater.maxLife);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4, 6, 16, 0.85)';
      // Keep the text inside the arena: a kill at the edge must not
      // push its score callout half off the screen.
      const half = ctx.measureText(floater.text).width / 2 + 6;
      const x = Math.max(half, Math.min(FIELD.width - half, floater.x));
      // Pop: the callout overshoots its size for a blink at birth.
      const age = floater.age ?? floater.maxLife;
      const pop = age < 0.18 ? 1 + 0.3 * (1 - age / 0.18) : 1;
      ctx.save();
      ctx.translate(x, floater.y);
      ctx.scale(pop, pop);
      ctx.strokeText(floater.text, 0, 0);
      ctx.fillStyle = floater.colour;
      ctx.fillText(floater.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawGhosts(state) {
    for (const ghost of state.ghosts) {
      const progress = 1 - ghost.life / ghost.maxLife;
      const alpha = (ghost.life / ghost.maxLife) * 0.7;
      const colour = ENEMY_FILL[ghost.kind];
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, ghost.radius * (1 + progress * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, ghost.radius * (1.2 + progress * 0.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawArcs(state) {
    for (const arc of state.arcs) {
      const flicker = 0.7 + 0.3 * Math.sin(state.time * 80 + arc.phase);
      const alpha = Math.max(0, arc.life / arc.maxLife) * flicker;
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(arc.points[0].x, arc.points[0].y);
        for (let i = 1; i < arc.points.length; i += 1) ctx.lineTo(arc.points[i].x, arc.points[i].y);
        ctx.stroke();
      };
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = arc.colour;
      ctx.lineWidth = 6;
      trace();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 12;
      ctx.shadowColor = arc.colour;
      trace();
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
      trace();
      ctx.restore();
    }
  }

  function drawHudScrim() {
    const scrim = ctx.createLinearGradient(0, 0, 0, 132);
    scrim.addColorStop(0, PALETTE.scrim);
    scrim.addColorStop(1, 'rgba(4, 6, 16, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, FIELD.width, 132);
  }

  function drawHud(state, best) {
    ctx.save();
    ctx.textBaseline = 'top';
    // Score, top left.
    ctx.fillStyle = PALETTE.text;
    ctx.font = `800 30px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${state.score.toLocaleString('en-US')}`, 24, 18);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(`BEST ${Math.max(best, state.score).toLocaleString('en-US')}`, 24, 54);
    // Combo, under the score, only while it burns.
    if (state.combo >= 2) {
      const mult = comboMultiplier(state.combo);
      ctx.fillStyle = state.combo >= 8 ? PALETTE.spark : PALETTE.gold;
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(`COMBO x${state.combo}  (${mult.toFixed(1)}x)`, 24, 82);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(24, 116, 160, 6);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(24, 116, 160 * Math.max(0, state.comboTimer / COMBO_WINDOW), 6);
    }
    // Wave, top centre, with honest progress through this wave.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(`WAVE ${Math.min(state.wave, TOTAL_WAVES)} / ${TOTAL_WAVES}`, FIELD.width / 2, 18);
    const remaining = state.enemies.length + state.spawnQueue.length;
    const progress = state.waveTotal > 0 ? state.waveKills / state.waveTotal : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(FIELD.width / 2 - 110, 52, 220, 7);
    ctx.fillStyle = PALETTE.frost;
    ctx.fillRect(FIELD.width / 2 - 110, 52, 220 * Math.min(1, progress), 7);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText(remaining > 0 ? `${remaining} ember${remaining === 1 ? '' : 's'} left` : 'Wave clear!', FIELD.width / 2, 66);
    // Hearts, top right: filled for lives, dim outlines for empty slots.
    ctx.textAlign = 'right';
    for (let i = 0; i < MAX_LIVES; i += 1) {
      ctx.save();
      ctx.translate(FIELD.width - 30 - i * 34, 34);
      if (i < state.lives) {
        ctx.fillStyle = PALETTE.danger;
        ctx.shadowBlur = 10;
        ctx.shadowColor = PALETTE.danger;
        heartPath(ctx, 0, 0, 11);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(154, 168, 216, 0.45)';
        ctx.lineWidth = 2;
        heartPath(ctx, 0, 0, 11);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (state.player.shield) {
      ctx.fillStyle = PALETTE.frost;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText('SHIELD', FIELD.width - 24, 58);
    }
    ctx.restore();
  }

  function drawIconButton(rect, drawGlyph) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 34, 0.72)';
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.size, rect.size, 14);
    ctx.fill();
    ctx.stroke();
    ctx.translate(rect.x + rect.size / 2, rect.y + rect.size / 2);
    drawGlyph();
    ctx.restore();
  }

  function drawButtons(screen, muted) {
    // Mute is always reachable; pause only while a run is live.
    drawIconButton(BUTTONS.mute, () => {
      ctx.fillStyle = muted ? PALETTE.dimText : PALETTE.text;
      ctx.beginPath();
      ctx.moveTo(-11, -5);
      ctx.lineTo(-5, -5);
      ctx.lineTo(2, -11);
      ctx.lineTo(2, 11);
      ctx.lineTo(-5, 5);
      ctx.lineTo(-11, 5);
      ctx.closePath();
      ctx.fill();
      if (muted) {
        ctx.strokeStyle = PALETTE.danger;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(6, -7);
        ctx.lineTo(14, 7);
        ctx.moveTo(14, -7);
        ctx.lineTo(6, 7);
        ctx.stroke();
      } else {
        ctx.strokeStyle = PALETTE.text;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(4, 0, 7, -0.9, 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(4, 0, 12, -0.9, 0.9);
        ctx.stroke();
      }
    });
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) {
      drawIconButton(BUTTONS.pause, () => {
        ctx.fillStyle = PALETTE.text;
        if (screen === SCREEN_PAUSED) {
          ctx.beginPath();
          ctx.moveTo(-5, -10);
          ctx.lineTo(10, 0);
          ctx.lineTo(-5, 10);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-9, -10, 6, 20);
          ctx.fillRect(3, -10, 6, 20);
        }
      });
    }
  }

  function drawReticle(mouse, state) {
    if (!mouse) return;
    const player = state.player;
    // A short aim guide from the wisp toward the reticle: the first shot
    // is understandable before it is fired.
    const dx = mouse.x - player.x;
    const dy = mouse.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 4) {
      const guide = ctx.createLinearGradient(player.x, player.y, mouse.x, mouse.y);
      guide.addColorStop(0, 'rgba(255, 209, 102, 0.28)');
      guide.addColorStop(1, 'rgba(255, 209, 102, 0)');
      ctx.strokeStyle = guide;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x + (dx / distance) * (PLAYER.radius + 4), player.y + (dy / distance) * (PLAYER.radius + 4));
      ctx.lineTo(player.x + (dx / distance) * Math.min(distance, 70), player.y + (dy / distance) * Math.min(distance, 70));
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(mouse.x, mouse.y);
    ctx.strokeStyle = PALETTE.emberCore;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(-7, 0);
    ctx.moveTo(7, 0);
    ctx.lineTo(15, 0);
    ctx.moveTo(0, -15);
    ctx.lineTo(0, -7);
    ctx.moveTo(0, 7);
    ctx.lineTo(0, 15);
    ctx.stroke();
    ctx.fillStyle = PALETTE.emberCore;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawThumbstick(stick) {
    if (!stick) return;
    // The floating stick: a quiet ring where the thumb landed, and a
    // bright knob where it is pushing. It only ever exists while a thumb
    // is down, so the desktop frame never sees it.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(10, 14, 34, 0.45)';
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.baseX, stick.baseY, stick.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = PALETTE.emberCore;
    ctx.shadowBlur = 10;
    ctx.shadowColor = PALETTE.ember;
    ctx.beginPath();
    ctx.arc(stick.thumbX, stick.thumbY, stick.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBanner(state) {
    if (!state.banner || state.banner.timer <= 0) return;
    const age = state.banner.duration - state.banner.timer;
    const punch = age < 0.25 ? 1.18 - 0.18 * (age / 0.25) : 1;
    // Entrance: the banner slides down and fades in over its first
    // third of a second instead of appearing all at once.
    const enter = easeOutCubic(age / 0.3);
    const alpha = enter * Math.min(1, state.banner.timer * 1.5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(FIELD.width / 2, 118 - (1 - enter) * 18);
    ctx.scale(punch, punch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `800 36px ${FONT}`;
    ctx.shadowBlur = 20;
    ctx.shadowColor = PALETTE.ember;
    ctx.fillText(state.banner.text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText(state.banner.sub, 0, 38);
    ctx.restore();
  }

  function panel(x, y, width, height, radius = 18) {
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();
  }

  function drawChip(cx, y, label) {
    ctx.save();
    ctx.font = `700 15px ${FONT}`;
    const width = ctx.measureText(label).width + 30;
    ctx.fillStyle = 'rgba(10, 14, 34, 0.72)';
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - width / 2, y - 17, width, 34, 17);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y + 1);
    ctx.restore();
    return width;
  }

  function drawPrimaryButton(cx, y, label) {
    const width = 248;
    const height = 58;
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = 'rgba(255, 154, 42, 0.55)';
    ctx.fillStyle = PALETTE.buttonFace;
    ctx.beginPath();
    ctx.roundRect(cx - width / 2, y - height / 2, width, height, 16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.buttonText;
    ctx.font = `800 24px ${FONT}`;
    const textWidth = ctx.measureText(label).width;
    const groupLeft = cx - (textWidth + 30) / 2;
    ctx.beginPath();
    ctx.moveTo(groupLeft, y - 10);
    ctx.lineTo(groupLeft + 18, y);
    ctx.lineTo(groupLeft, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + 15, y + 1);
    ctx.restore();
  }

  function drawGoalsRow(cx, y, earned, numbers) {
    // One short line: the three goals, a gold star for each one earned.
    // On the end screen, numbers from the run just played ride along.
    ctx.save();
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const parts = [{ text: 'GOALS', colour: PALETTE.dimText }];
    BADGES.forEach((badge, index) => {
      if (index > 0) parts.push({ text: '·', colour: PALETTE.dimText });
      const owned = earned.includes(badge.id);
      let text = `${owned ? '★' : '☆'} ${badge.label}`;
      if (numbers) {
        if (badge.id === 'combo12') text += ` (BEST ×${numbers.maxCombo})`;
        else if (badge.id === 'wave10') text += ` (WAVE ${numbers.maxWave})`;
        else if (badge.id === 'flawless') {
          const hits = (numbers.hitsTaken ?? 0) + (numbers.blocksTaken ?? 0);
          text += hits === 0 ? ' (NO HITS)' : ` (${hits} HIT${hits === 1 ? '' : 'S'})`;
        }
      }
      parts.push({ text, colour: owned ? PALETTE.gold : PALETTE.dimText });
    });
    const gap = 10;
    const widths = parts.map((part) => ctx.measureText(part.text).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (parts.length - 1);
    let x = cx - total / 2;
    parts.forEach((part, index) => {
      ctx.fillStyle = part.colour;
      ctx.fillText(part.text, x, y);
      x += widths[index] + gap;
    });
    ctx.restore();
  }

  function drawTitle(state, best, touchMode, ui) {
    // A scrim keeps the wandering attract-mode embers from colliding
    // with the wordmark: the title owns the centre of the screen.
    ctx.fillStyle = 'rgba(4, 6, 16, 0.42)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    // A second, deeper panel behind the title block itself: the wisp and
    // the wordmark sit on it, and no wandering ember shows through the text.
    ctx.fillStyle = 'rgba(4, 6, 16, 0.45)';
    ctx.beginPath();
    ctx.roundRect(290, 64, 700, 556, 28);
    ctx.fill();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Staggered entrance: wordmark, premise, chips, button, then the
    // goals row — each slides up and fades in a beat after the last.
    const place = (delay, fn) => {
      const e = entrance(ui, delay, 0.4);
      ctx.save();
      ctx.globalAlpha = e.alpha;
      ctx.translate(0, e.dy);
      fn(e);
      ctx.restore();
    };
    place(0, (e) => {
      drawWisp(FIELD.width / 2, 108, 26, state.time, -Math.PI / 2);
      const glow = 0.7 + 0.3 * Math.sin(state.time * 2.2);
      ctx.globalAlpha = e.alpha * glow;
      ctx.fillStyle = PALETTE.ember;
      ctx.font = `900 76px ${FONT}`;
      ctx.shadowBlur = 34;
      ctx.shadowColor = PALETTE.ember;
      try { ctx.letterSpacing = '4px'; } catch { /* older canvas: no tracking */ }
      ctx.fillText('EMBERFALL', FIELD.width / 2, 210);
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.frost;
      ctx.fillText('ARENA', FIELD.width / 2, 286);
      try { ctx.letterSpacing = '0px'; } catch { /* older canvas */ }
    });
    place(0.12, () => {
      ctx.fillStyle = PALETTE.text;
      ctx.font = `600 20px ${FONT}`;
      ctx.fillText('Survive 10 waves. Chain kills. Beat your best.', FIELD.width / 2, 340);
    });
    place(0.22, () => {
      const labels = touchMode
        ? ['LEFT THUMB · MOVE', 'RIGHT THUMB · AIM + FIRE']
        : ['WASD · MOVE', 'MOUSE · AIM', 'HOLD CLICK · FIRE'];
      const gap = 16;
      const widths = labels.map((label) => {
        ctx.font = `700 15px ${FONT}`;
        return ctx.measureText(label).width + 30;
      });
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * (labels.length - 1);
      let cx = FIELD.width / 2 - total / 2;
      labels.forEach((label, index) => {
        drawChip(cx + widths[index] / 2, 386, label);
        cx += widths[index] + gap;
      });
    });
    place(0.32, () => {
      drawPrimaryButton(FIELD.width / 2, 462, 'PLAY');
    });
    place(0.4, () => {
      ctx.fillStyle = PALETTE.dimText;
      ctx.font = `600 15px ${FONT}`;
      ctx.fillText(touchMode ? 'or tap PLAY' : 'or press Space', FIELD.width / 2, 516);
      if (best > 0) {
        ctx.fillStyle = PALETTE.gold;
        ctx.font = `700 17px ${FONT}`;
        ctx.fillText(`BEST ${best.toLocaleString('en-US')}`, FIELD.width / 2, 550);
      }
    });
    place(0.48, () => {
      drawGoalsRow(FIELD.width / 2, 592, ui.badges ?? [], null);
    });
    ctx.restore();
  }

  function drawPaused(state, touchMode, ui) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 16, 0.62)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    const pop = panelPop(ui);
    ctx.globalAlpha = pop.alpha;
    ctx.translate(FIELD.width / 2, FIELD.height / 2);
    ctx.scale(pop.scale, pop.scale);
    ctx.translate(-FIELD.width / 2, -FIELD.height / 2);
    panel(FIELD.width / 2 - 260, FIELD.height / 2 - 120, 520, 240);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText('PAUSED', FIELD.width / 2, FIELD.height / 2 - 58);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText(`Score ${state.score.toLocaleString('en-US')}  ·  Wave ${state.wave} of ${TOTAL_WAVES}`, FIELD.width / 2, FIELD.height / 2 - 6);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(touchMode ? 'Tap to keep playing' : 'P or click to keep playing', FIELD.width / 2, FIELD.height / 2 + 38);
    if (!touchMode) {
      ctx.fillStyle = PALETTE.dimText;
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText('R restarts the run  ·  M mutes', FIELD.width / 2, FIELD.height / 2 + 70);
    }
    ctx.restore();
  }

  function drawEnd(state, best, won, newBest, ui) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 16, 0.6)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    const pop = panelPop(ui);
    ctx.globalAlpha = pop.alpha;
    ctx.translate(FIELD.width / 2, FIELD.height / 2);
    ctx.scale(pop.scale, pop.scale);
    ctx.translate(-FIELD.width / 2, -FIELD.height / 2);
    panel(FIELD.width / 2 - 330, FIELD.height / 2 - 200, 660, 400);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = won ? PALETTE.gold : PALETTE.danger;
    ctx.font = `900 54px ${FONT}`;
    ctx.shadowBlur = 26;
    ctx.shadowColor = won ? PALETTE.gold : PALETTE.danger;
    ctx.fillText(won ? 'VICTORY!' : 'GAME OVER', FIELD.width / 2, FIELD.height / 2 - 122);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(
      won ? 'Ten waves survived — the arena is yours, little ember.' : 'The dark caught the little ember this time.',
      FIELD.width / 2, FIELD.height / 2 - 68,
    );
    if (newBest && state.score > 0) {
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.roundRect(FIELD.width / 2 - 78, FIELD.height / 2 - 48, 156, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#231303';
      ctx.font = `800 15px ${FONT}`;
      ctx.fillText('NEW BEST', FIELD.width / 2, FIELD.height / 2 - 32);
    }
    ctx.fillStyle = PALETTE.emberCore;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(`SCORE ${state.score.toLocaleString('en-US')}`, FIELD.width / 2, FIELD.height / 2 - 2);
    // Run stats: every number is measured from this run, nothing estimated.
    const accuracy = state.shotsFired > 0 ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
    const stats = [
      ['BEST', Math.max(best, state.score).toLocaleString('en-US')],
      ['WAVE', `${state.wave} / ${TOTAL_WAVES}`],
      ['KILLS', String(state.kills)],
      ['ACCURACY', `${accuracy}%`],
      ['MAX COMBO', `x${state.maxCombo}`],
      ['TIME', formatTime(state.time)],
    ];
    ctx.font = `600 15px ${FONT}`;
    const cellWidth = 190;
    const startX = FIELD.width / 2 - (cellWidth * 3) / 2;
    stats.forEach(([label, value], index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = startX + col * cellWidth + cellWidth / 2;
      const y = FIELD.height / 2 + 36 + row * 26;
      const e = entrance(ui, 0.15 + row * 0.07, 0.3);
      ctx.save();
      ctx.globalAlpha *= e.alpha;
      ctx.fillStyle = PALETTE.dimText;
      ctx.textAlign = 'right';
      ctx.fillText(label, x - 8, y);
      ctx.fillStyle = PALETTE.text;
      ctx.textAlign = 'left';
      ctx.fillText(value, x + 8, y);
      ctx.restore();
    });
    ctx.textAlign = 'center';
    const newBadges = ui.newBadges ?? [];
    const goalsY = FIELD.height / 2 + (newBadges.length > 0 ? 86 : 100);
    drawGoalsRow(FIELD.width / 2, goalsY, ui.badges ?? [], state);
    if (newBadges.length > 0) {
      const names = newBadges.map((id) => BADGES.find((badge) => badge.id === id)?.label ?? id);
      ctx.fillStyle = PALETTE.gold;
      ctx.font = `800 16px ${FONT}`;
      ctx.fillText(`★ NEW BADGE: ${names.join(' · ')}`, FIELD.width / 2, FIELD.height / 2 + 110);
    }
    drawPrimaryButton(FIELD.width / 2, FIELD.height / 2 + 154, 'PLAY AGAIN');
    ctx.restore();
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    resize,
    toLogical,
    draw(state, screen, best, muted, mouse = null, newBest = false, ui = {}) {
      const touchMode = Boolean(ui.touchDetected);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PALETTE.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      if (state.shake > 0) {
        const magnitude = state.shake;
        ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
      }
      drawBackground(state);
      // Player lances: an energy lance, not a dot — a bright head, a
      // white-hot core and a comet tail along its flight. The hitbox is
      // unchanged; only the light got better.
      for (const bullet of state.bullets) {
        const angle = Math.atan2(bullet.vy, bullet.vx);
        ctx.save();
        ctx.translate(bullet.x, bullet.y);
        ctx.rotate(angle);
        ctx.shadowBlur = 14;
        ctx.shadowColor = PALETTE.emberCore;
        const tail = ctx.createLinearGradient(-24, 0, 8, 0);
        tail.addColorStop(0, 'rgba(255, 209, 102, 0)');
        tail.addColorStop(0.7, 'rgba(255, 209, 102, 0.55)');
        tail.addColorStop(1, PALETTE.emberCore);
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.roundRect(-24, -3.5, 32, 7, 3.5);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff7cc';
        ctx.beginPath();
        ctx.roundRect(-8, -1.5, 16, 3, 1.5);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(4, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (const bullet of state.enemyBullets) {
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = PALETTE.frost;
        ctx.fillStyle = PALETTE.frost;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(232, 253, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius + 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      drawPickups(state);
      for (const enemy of state.enemies) drawEnemy(enemy, state.time);
      drawGhosts(state);
      drawArcs(state);
      if (screen !== SCREEN_OVER) drawPlayer(state);
      for (const particle of state.particles) {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        ctx.fillStyle = particle.colour;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawFloaters(state);
      if (screen === SCREEN_TITLE) {
        drawTitle(state, best, touchMode, ui);
        drawButtons(screen, muted);
      } else {
        drawHudScrim();
        drawHud(state, best);
        drawBanner(state);
        drawButtons(screen, muted);
        if (screen === SCREEN_PLAY) {
          drawReticle(mouse, state);
          drawThumbstick(ui.touch ? ui.touch.stick : null);
        } else if (screen === SCREEN_PAUSED) drawPaused(state, touchMode, ui);
        else if (screen === SCREEN_OVER) drawEnd(state, best, false, newBest, ui);
        else if (screen === SCREEN_WON) drawEnd(state, best, true, newBest, ui);
      }
    },
  };
}

// Telegraph placeholder colour per kind, used while the body fades in.
const ENEMY_FILL = {
  drifter: PALETTE.ember,
  rusher: PALETTE.spark,
  shooter: PALETTE.frost,
};
