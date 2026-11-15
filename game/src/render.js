// All rendering for Emberfall Arena.
//
// One renderer owns the canvas transform (the 1280x720 logical field is
// scaled to fit the window), the starfield, every entity, the HUD and the
// title, pause, victory and game-over screens. Nothing here touches game
// rules; it only paints the state the world hands it.

import { FIELD, PALETTE, PLAYER, TOTAL_WAVES, comboMultiplier } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_WON = 'won';

function heartPath(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.9);
  ctx.bezierCurveTo(x - size * 1.2, y, x - size * 0.6, y - size, x, y - size * 0.3);
  ctx.bezierCurveTo(x + size * 0.6, y - size, x + size * 1.2, y, x, y + size * 0.9);
  ctx.closePath();
}

function starPath(ctx, x, y, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
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

  function drawBackground(state) {
    const gradient = ctx.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, 80,
      FIELD.width / 2, FIELD.height / 2, 780,
    );
    gradient.addColorStop(0, PALETTE.backgroundGlow);
    gradient.addColorStop(1, PALETTE.background);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    for (const star of state.stars) {
      const alpha = 0.35 + 0.55 * Math.abs(Math.sin(star.twinkle));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE.star;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(state) {
    const player = state.player;
    if (player.invulnerable > 0 && Math.floor(state.time * 12) % 2 === 0 && state.phase !== 'over') return;
    const flicker = 1 + Math.sin(state.time * 14) * 0.08;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowBlur = 26;
    ctx.shadowColor = PALETTE.ember;
    const flame = ctx.createRadialGradient(0, 0, 2, 0, 0, PLAYER.radius * 1.7 * flicker);
    flame.addColorStop(0, PALETTE.emberCore);
    flame.addColorStop(0.55, PALETTE.ember);
    flame.addColorStop(1, 'rgba(255, 93, 58, 0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER.radius * 1.7 * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.emberCore;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER.radius * 0.62, 0, Math.PI * 2);
    ctx.fill();
    // Two bright eyes looking along the aim.
    ctx.rotate(player.angle);
    ctx.fillStyle = '#1b0d02';
    ctx.beginPath();
    ctx.arc(6, -5, 2.6, 0, Math.PI * 2);
    ctx.arc(6, 5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    if (enemy.kind === 'drifter') {
      ctx.shadowBlur = 18;
      ctx.shadowColor = PALETTE.ember;
      ctx.fillStyle = PALETTE.ember;
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = (i * Math.PI * 2) / 8 + time * 0.4;
        const radius = enemy.radius * (i % 2 === 0 ? 1.15 : 0.8);
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.flame;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius * 0.5, 0, Math.PI * 2);
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
      const y = pickup.y + bob;
      ctx.save();
      ctx.translate(pickup.x, y);
      ctx.shadowBlur = 14;
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

  function drawHud(state, best, muted) {
    ctx.save();
    ctx.textBaseline = 'top';
    // Score, top left.
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE ${state.score.toLocaleString('en-US')}`, 24, 18);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(`BEST ${Math.max(best, state.score).toLocaleString('en-US')}`, 24, 54);
    // Combo, under the score, only while it burns.
    if (state.combo >= 2) {
      const mult = comboMultiplier(state.combo);
      ctx.fillStyle = state.combo >= 8 ? PALETTE.spark : PALETTE.gold;
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.fillText(`COMBO x${state.combo}  (${mult.toFixed(1)}x)`, 24, 82);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(24, 116, 160, 6);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(24, 116, 160 * Math.max(0, state.comboTimer / 3), 6);
    }
    // Wave, top centre, with progress through it.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(`WAVE ${Math.min(state.wave, TOTAL_WAVES)} / ${TOTAL_WAVES}`, FIELD.width / 2, 18);
    const remaining = state.enemies.length + state.spawnQueue.length;
    const total = Math.max(1, state.enemies.length + state.spawnQueue.length + state.kills);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(FIELD.width / 2 - 110, 52, 220, 7);
    ctx.fillStyle = PALETTE.frost;
    ctx.fillRect(FIELD.width / 2 - 110, 52, 220 * (1 - remaining / Math.max(total, remaining)), 7);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(remaining > 0 ? `${remaining} ember${remaining === 1 ? '' : 's'} left` : 'Wave clear!', FIELD.width / 2, 66);
    // Hearts, top right.
    ctx.textAlign = 'right';
    for (let i = 0; i < Math.max(state.lives, 0); i += 1) {
      ctx.save();
      ctx.translate(FIELD.width - 30 - i * 34, 34);
      ctx.fillStyle = PALETTE.danger;
      ctx.shadowBlur = 10;
      ctx.shadowColor = PALETTE.danger;
      heartPath(ctx, 0, 0, 11);
      ctx.fill();
      ctx.restore();
    }
    if (state.player.shield) {
      ctx.fillStyle = PALETTE.frost;
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText('SHIELD', FIELD.width - 24, 58);
    }
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(muted ? 'M — sound off' : 'M — mute · P — pause', FIELD.width - 24, 82);
    ctx.restore();
  }

  function drawBanner(state) {
    if (!state.banner || state.banner.timer <= 0) return;
    const alpha = Math.min(1, state.banner.timer);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.shadowBlur = 22;
    ctx.shadowColor = PALETTE.ember;
    ctx.fillText(state.banner.text, FIELD.width / 2, 150);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText(state.banner.sub, FIELD.width / 2, 192);
    ctx.restore();
  }

  function panel(x, y, width, height) {
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 18);
    ctx.fill();
    ctx.stroke();
  }

  function drawTitle(state, best) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glow = 0.7 + 0.3 * Math.sin(state.time * 2.2);
    ctx.globalAlpha = glow;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.shadowBlur = 34;
    ctx.shadowColor = PALETTE.ember;
    ctx.fillText('EMBERFALL', FIELD.width / 2, 168);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.frost;
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillText('ARENA', FIELD.width / 2, 252);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.text;
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText('A tiny wisp of ember against the falling dark. Survive all 10 waves.', FIELD.width / 2, 322);
    panel(FIELD.width / 2 - 330, 352, 660, 168);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('MOVE — WASD or arrow keys      AIM — mouse      FIRE — hold click', FIELD.width / 2, 384);
    ctx.fillText('PAUSE — P or Esc      RESTART — R      MUTE — M', FIELD.width / 2, 414);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText('Chain kills for combos · Grab hearts, star shards and shields', FIELD.width / 2, 452);
    ctx.fillText('Drifters wander · Rushers hunt you · Shooters fire back from wave 3', FIELD.width / 2, 482);
    ctx.fillStyle = PALETTE.emberCore;
    ctx.font = '800 26px system-ui, sans-serif';
    const pulse = 0.65 + 0.35 * Math.sin(state.time * 4);
    ctx.globalAlpha = pulse;
    ctx.fillText('CLICK OR PRESS SPACE TO BEGIN', FIELD.width / 2, 566);
    ctx.globalAlpha = 1;
    if (best > 0) {
      ctx.fillStyle = PALETTE.dimText;
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(`Best score: ${best.toLocaleString('en-US')}`, FIELD.width / 2, 606);
    }
    ctx.restore();
  }

  function drawPaused() {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 16, 0.62)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    panel(FIELD.width / 2 - 260, FIELD.height / 2 - 110, 520, 220);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText('PAUSED', FIELD.width / 2, FIELD.height / 2 - 48);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.fillText('Press P or click to keep playing', FIELD.width / 2, FIELD.height / 2 + 12);
    ctx.fillText('R restarts the run', FIELD.width / 2, FIELD.height / 2 + 44);
    ctx.restore();
  }

  function drawEnd(state, best, won) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 16, 0.6)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    panel(FIELD.width / 2 - 320, FIELD.height / 2 - 160, 640, 320);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = won ? PALETTE.gold : PALETTE.danger;
    ctx.font = '900 56px system-ui, sans-serif';
    ctx.shadowBlur = 26;
    ctx.shadowColor = won ? PALETTE.gold : PALETTE.danger;
    ctx.fillText(won ? 'VICTORY!' : 'GAME OVER', FIELD.width / 2, FIELD.height / 2 - 104);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = '600 21px system-ui, sans-serif';
    ctx.fillText(
      won ? 'Ten waves survived — the arena is yours, little ember.' : 'The dark caught the little ember this time.',
      FIELD.width / 2, FIELD.height / 2 - 44,
    );
    ctx.fillStyle = PALETTE.emberCore;
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText(`SCORE ${state.score.toLocaleString('en-US')}`, FIELD.width / 2, FIELD.height / 2 + 6);
    ctx.fillStyle = PALETTE.dimText;
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.fillText(`Best ${Math.max(best, state.score).toLocaleString('en-US')}   ·   ${state.kills} embers shattered   ·   Wave ${state.wave}`, FIELD.width / 2, FIELD.height / 2 + 48);
    const pulse = 0.65 + 0.35 * Math.sin(state.time * 4);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText('PRESS R OR CLICK TO PLAY AGAIN', FIELD.width / 2, FIELD.height / 2 + 104);
    ctx.restore();
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    resize,
    toLogical,
    draw(state, screen, best, muted) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PALETTE.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      if (state.shake > 0) {
        const magnitude = state.shake;
        ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
      }
      drawBackground(state);
      for (const bullet of state.bullets) {
        ctx.save();
        ctx.shadowBlur = 14;
        ctx.shadowColor = PALETTE.emberCore;
        ctx.fillStyle = PALETTE.emberCore;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
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
        ctx.restore();
      }
      drawPickups(state);
      for (const enemy of state.enemies) drawEnemy(enemy, state.time);
      if (screen !== SCREEN_OVER) drawPlayer(state);
      for (const particle of state.particles) {
        ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
        ctx.fillStyle = particle.colour;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (screen === SCREEN_TITLE) {
        drawTitle(state, best);
      } else {
        drawHud(state, best, muted);
        drawBanner(state);
        if (screen === SCREEN_PAUSED) drawPaused();
        else if (screen === SCREEN_OVER) drawEnd(state, best, false);
        else if (screen === SCREEN_WON) drawEnd(state, best, true);
      }
    },
  };
}
