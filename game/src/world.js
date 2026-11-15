// The world of Emberfall Arena: state, spawning, movement, collisions,
// scoring, waves and pickups.
//
// The world advances in fixed steps and knows nothing about the screen:
// the loop feeds it a movement direction, whether the trigger is held and
// where the wisp is aiming, and it answers with an event bitmask the loop
// turns into sounds and screen changes. Every random choice comes from
// the seeded generator, so the same seed replays the same arena.
//
// Feedback lives here as state, not as rendering tricks: floating score
// text, hit flashes, spawn telegraphs and the muzzle flash are all part
// of the simulated world, so a staged screenshot shows exactly what a
// player sees.

import {
  CLOSE_MULT, CLOSE_RANGE, COMBO_WINDOW, DROP_CHANCE, ENEMY_BULLET_RADIUS,
  ENEMY_BULLET_SPEED, ENEMY_KINDS, FIELD, MAX_LIVES, PICKUPS, PLAYER,
  RECOVERY_SCORE, RECOVERY_WAVES, SPAWN_TELEGRAPH, START_LIVES,
  TOTAL_WAVES, WAVE_BREAK, comboMultiplier, enemyKindsForWave,
  spawnInterval, wavePattern, waveSize, waveSpeedScale,
} from './config.js';

export const EVENT_HIT = 1;
export const EVENT_OVER = 2;
export const EVENT_WON = 4;
export const EVENT_WAVE_CLEAR = 8;
export const EVENT_KILL = 16;
export const EVENT_PICKUP = 32;
export const EVENT_SHIELD_BLOCK = 64;
export const EVENT_SHOOT = 128;
export const EVENT_WAVE_START = 256;

export function createWorld(random) {
  const state = freshState();

  function freshState() {
    return {
      time: 0,
      player: {
        x: FIELD.width / 2, y: FIELD.height / 2, angle: -Math.PI / 2,
        vx: 0, vy: 0,
        fireCooldown: 0, invulnerable: 0, shield: false, muzzle: 0,
      },
      enemies: [],
      bullets: [],
      enemyBullets: [],
      pickups: [],
      particles: [],
      floaters: [],
      stars: [],
      motes: [],
      score: 0,
      combo: 0,
      comboTimer: 0,
      maxCombo: 0,
      closeKills: 0,
      lives: START_LIVES,
      wave: 1,
      waveTotal: 0,
      waveKills: 0,
      phase: 'fight',
      breakTimer: 0,
      spawnQueue: [],
      spawnTimer: 0,
      spawnPattern: 'edge',
      banner: { text: '', sub: '', timer: 0, duration: 1 },
      shake: 0,
      kills: 0,
      shotsFired: 0,
      shotsHit: 0,
    };
  }

  function makeStars() {
    state.stars = [];
    for (let i = 0; i < 110; i += 1) {
      state.stars.push({
        x: random.range(0, FIELD.width),
        y: random.range(0, FIELD.height),
        size: random.range(0.6, 2.4),
        twinkle: random.range(0, Math.PI * 2),
        speed: random.range(0.4, 1.6),
      });
    }
  }

  function makeMotes() {
    state.motes = [];
    for (let i = 0; i < 26; i += 1) {
      state.motes.push({
        x: random.range(0, FIELD.width),
        y: random.range(0, FIELD.height),
        size: random.range(1.2, 2.8),
        rise: random.range(8, 22),
        sway: random.range(0, Math.PI * 2),
      });
    }
  }

  function burst(x, y, colour, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const angle = random.range(0, Math.PI * 2);
      const velocity = random.range(speed * 0.3, speed);
      state.particles.push({
        x, y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: random.range(0.3, 0.7),
        maxLife: 0.7,
        size: random.range(2, 5),
        colour,
      });
    }
  }

  function floater(x, y, text, colour) {
    if (state.floaters.length >= 12) state.floaters.shift();
    state.floaters.push({ x, y, text, colour, life: 0.9, maxLife: 0.9 });
  }

  function edgeSpawnPoint() {
    const side = Math.floor(random.next() * 4);
    const margin = 40;
    if (side === 0) return { x: random.range(0, FIELD.width), y: margin };
    if (side === 1) return { x: random.range(0, FIELD.width), y: FIELD.height - margin };
    if (side === 2) return { x: margin, y: random.range(0, FIELD.height) };
    return { x: FIELD.width - margin, y: random.range(0, FIELD.height) };
  }

  function ringSpawnPoint() {
    const angle = random.range(0, Math.PI * 2);
    const radius = 400;
    const x = Math.max(40, Math.min(FIELD.width - 40, state.player.x + Math.cos(angle) * radius));
    const y = Math.max(40, Math.min(FIELD.height - 40, state.player.y + Math.sin(angle) * radius));
    return { x, y };
  }

  function startWave(wave) {
    const kinds = enemyKindsForWave(wave);
    const queue = [];
    const total = waveSize(wave);
    for (let i = 0; i < total; i += 1) {
      if (kinds.includes('shooter') && i % 4 === 3) queue.push('shooter');
      else if (kinds.includes('rusher') && i % 3 === 2) queue.push('rusher');
      else queue.push('drifter');
    }
    // Shuffle so the mix never arrives in a predictable order.
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random.next() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    state.spawnQueue = queue;
    state.spawnPattern = wavePattern(wave);
    state.spawnTimer = wave === 1 ? 0.6 : 0.4;
    state.waveTotal = total;
    state.waveKills = 0;
    state.phase = 'fight';
    const sub = wave === TOTAL_WAVES
      ? 'The final wave — hold the line!'
      : wave === 1
        ? 'Drifters only. Learn to aim, then to run.'
        : state.spawnPattern === 'ring'
          ? 'They close in from every side!'
          : `${total} embers approach`;
    state.banner = { text: `WAVE ${wave}`, sub, timer: 2.2, duration: 2.2 };
  }

  function spawnEnemy(kind) {
    const spec = ENEMY_KINDS[kind];
    const point = state.spawnPattern === 'ring' ? ringSpawnPoint() : edgeSpawnPoint();
    const speed = spec.speed * waveSpeedScale(state.wave);
    state.enemies.push({
      kind, x: point.x, y: point.y,
      vx: 0, vy: 0, angle: random.range(0, Math.PI * 2),
      wander: random.range(0, Math.PI * 2),
      radius: spec.radius, hp: spec.hp, maxHp: spec.hp,
      speed, fireCooldown: random.range(1.2, 2.4),
      orbit: random.range(0, Math.PI * 2),
      spawning: SPAWN_TELEGRAPH,
      flash: 0,
    });
  }

  function maybeDrop(enemy) {
    const roll = random.next();
    let kind = null;
    if (roll < DROP_CHANCE.heart) kind = 'heart';
    else if (roll < DROP_CHANCE.heart + DROP_CHANCE.shard) kind = 'shard';
    else if (roll < DROP_CHANCE.heart + DROP_CHANCE.shard + DROP_CHANCE.shield) kind = 'shield';
    if (!kind) return;
    state.pickups.push({ kind, x: enemy.x, y: enemy.y, life: PICKUPS[kind].life, bob: random.range(0, Math.PI * 2) });
  }

  function killEnemy(index, events) {
    const enemy = state.enemies[index];
    const spec = ENEMY_KINDS[enemy.kind];
    state.enemies.splice(index, 1);
    state.kills += 1;
    state.waveKills += 1;
    if (state.comboTimer > 0) state.combo += 1;
    else state.combo = 1;
    state.comboTimer = COMBO_WINDOW;
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;
    const close = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y) < CLOSE_RANGE;
    let gained = Math.round(spec.score * comboMultiplier(state.combo));
    if (close) {
      gained = Math.round(gained * CLOSE_MULT);
      state.closeKills += 1;
      floater(enemy.x, enemy.y - 18, `CLOSE +${gained}`, '#ff4fd8');
    } else {
      floater(enemy.x, enemy.y - 18, `+${gained}`, '#ffe066');
    }
    state.score += gained;
    state.shake = Math.max(state.shake, 5);
    burst(enemy.x, enemy.y, spec.colour, 16, 260);
    burst(enemy.x, enemy.y, '#ffffff', 5, 160);
    maybeDrop(enemy);
    return events | EVENT_KILL;
  }

  function hurtPlayer(events) {
    const player = state.player;
    if (player.invulnerable > 0) return events;
    if (player.shield) {
      player.shield = false;
      player.invulnerable = 1.0;
      state.combo = 0;
      state.comboTimer = 0;
      state.shake = 10;
      burst(player.x, player.y, '#37e6ff', 14, 220);
      return events | EVENT_SHIELD_BLOCK;
    }
    state.lives -= 1;
    state.combo = 0;
    state.comboTimer = 0;
    state.shake = 18;
    player.invulnerable = PLAYER.invulnerableSeconds;
    burst(player.x, player.y, '#ff5d3a', 22, 300);
    if (state.lives <= 0) {
      state.phase = 'over';
      burst(player.x, player.y, '#ffd166', 40, 380);
      return events | EVENT_HIT | EVENT_OVER;
    }
    return events | EVENT_HIT;
  }

  function collectPickup(pickup, events) {
    const player = state.player;
    if (pickup.kind === 'heart') {
      if (state.lives < MAX_LIVES) {
        state.lives += 1;
        state.banner = { text: '+1 HEART', sub: 'The ember burns brighter', timer: 1.4, duration: 1.4 };
      } else {
        // Hearts are full: the pickup pays score instead of vanishing
        // silently, and the banner says exactly that.
        state.score += RECOVERY_SCORE;
        floater(pickup.x, pickup.y - 18, `+${RECOVERY_SCORE}`, '#ffe066');
        state.banner = { text: `+${RECOVERY_SCORE} — HEARTS FULL`, sub: 'No room for another heart', timer: 1.4, duration: 1.4 };
      }
    } else if (pickup.kind === 'shard') {
      const gained = Math.round(250 * comboMultiplier(state.combo));
      state.score += gained;
      floater(pickup.x, pickup.y - 18, `+${gained}`, '#ffe066');
      state.banner = { text: `+${gained} STAR SHARD`, sub: 'A burst of light', timer: 1.4, duration: 1.4 };
    } else {
      player.shield = true;
      state.banner = { text: 'SHIELD UP', sub: 'One hit, on the house', timer: 1.4, duration: 1.4 };
    }
    burst(pickup.x, pickup.y, PICKUPS[pickup.kind].colour, 12, 200);
    return events | EVENT_PICKUP;
  }

  function stepEnemies(dt, events) {
    const player = state.player;
    for (const enemy of state.enemies) {
      if (enemy.flash > 0) enemy.flash -= dt;
      if (enemy.spawning > 0) {
        enemy.spawning -= dt;
        continue;
      }
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (enemy.kind === 'drifter') {
        enemy.wander += dt * 0.8;
        enemy.angle += Math.sin(enemy.wander) * dt * 1.6;
        // Drifters meander, but they are drawn to the wisp: a slow turn
        // toward the player guarantees every wave reaches a conclusion —
        // no wave can stall with a lone ember wandering a far corner.
        const toPlayer = Math.atan2(dy, dx);
        let turn = toPlayer - enemy.angle;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        enemy.angle += Math.max(-0.6 * dt, Math.min(0.6 * dt, turn));
        enemy.x += Math.cos(enemy.angle) * enemy.speed * dt;
        enemy.y += Math.sin(enemy.angle) * enemy.speed * dt;
      } else if (enemy.kind === 'rusher') {
        enemy.x += (dx / distance) * enemy.speed * dt;
        enemy.y += (dy / distance) * enemy.speed * dt;
        enemy.angle = Math.atan2(dy, dx);
      } else {
        enemy.orbit += dt * 0.9;
        const wantX = player.x + Math.cos(enemy.orbit) * 270;
        const wantY = player.y + Math.sin(enemy.orbit) * 270;
        enemy.x += (wantX - enemy.x) * Math.min(1, dt * 1.8);
        enemy.y += (wantY - enemy.y) * Math.min(1, dt * 1.8);
        enemy.angle = Math.atan2(dy, dx);
        enemy.fireCooldown -= dt;
        if (enemy.fireCooldown <= 0 && distance < 560) {
          enemy.fireCooldown = 2.3;
          state.enemyBullets.push({
            x: enemy.x, y: enemy.y,
            vx: (dx / distance) * ENEMY_BULLET_SPEED,
            vy: (dy / distance) * ENEMY_BULLET_SPEED,
            radius: ENEMY_BULLET_RADIUS, life: 4,
          });
        }
      }
      enemy.x = Math.max(24, Math.min(FIELD.width - 24, enemy.x));
      enemy.y = Math.max(24, Math.min(FIELD.height - 24, enemy.y));
    }
    return events;
  }

  function stepBullets(dt, events) {
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = state.bullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0 || bullet.x < -20 || bullet.x > FIELD.width + 20 || bullet.y < -20 || bullet.y > FIELD.height + 20) {
        state.bullets.splice(i, 1);
        continue;
      }
      for (let j = state.enemies.length - 1; j >= 0; j -= 1) {
        const enemy = state.enemies[j];
        if (enemy.spawning > 0) continue;
        const dx = bullet.x - enemy.x;
        const dy = bullet.y - enemy.y;
        if (dx * dx + dy * dy < (bullet.radius + enemy.radius) * (bullet.radius + enemy.radius)) {
          state.bullets.splice(i, 1);
          state.shotsHit += 1;
          enemy.hp -= bullet.damage;
          enemy.flash = 0.07;
          // A hit shoves the enemy back along the shot: every hit reads.
          enemy.x += bullet.vx * 0.014;
          enemy.y += bullet.vy * 0.014;
          burst(bullet.x, bullet.y, '#ffd166', 4, 140);
          if (enemy.hp <= 0) events = killEnemy(j, events);
          break;
        }
      }
    }
    for (let i = state.enemyBullets.length - 1; i >= 0; i -= 1) {
      const bullet = state.enemyBullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.life -= dt;
      if (bullet.life <= 0 || bullet.x < -20 || bullet.x > FIELD.width + 20 || bullet.y < -20 || bullet.y > FIELD.height + 20) {
        state.enemyBullets.splice(i, 1);
        continue;
      }
      const player = state.player;
      const dx = bullet.x - player.x;
      const dy = bullet.y - player.y;
      if (dx * dx + dy * dy < (bullet.radius + PLAYER.radius) * (bullet.radius + PLAYER.radius)) {
        state.enemyBullets.splice(i, 1);
        events = hurtPlayer(events);
      }
    }
    return events;
  }

  function stepCollisions(dt, events) {
    const player = state.player;
    for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = state.enemies[i];
      if (enemy.spawning > 0) continue;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const reach = PLAYER.radius + enemy.radius - 2;
      if (dx * dx + dy * dy < reach * reach) {
        // A touch hurts the player and knocks the enemy back, not through it.
        events = hurtPlayer(events);
        const distance = Math.hypot(dx, dy) || 1;
        enemy.x -= (dx / distance) * 26;
        enemy.y -= (dy / distance) * 26;
        if (events & EVENT_OVER) return events;
      }
    }
    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = state.pickups[i];
      pickup.life -= dt;
      pickup.bob += dt * 4;
      if (pickup.life <= 0) {
        state.pickups.splice(i, 1);
        continue;
      }
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 110 && distance > 0.001) {
        pickup.x += (dx / distance) * 190 * dt;
        pickup.y += (dy / distance) * 190 * dt;
      }
      if (distance < PLAYER.radius + PICKUPS[pickup.kind].radius + 4) {
        state.pickups.splice(i, 1);
        events = collectPickup(pickup, events);
      }
    }
    return events;
  }

  // Everything that moves even when the game is not being played: time,
  // particles, floating text, embers, stars and the banner. The loop calls
  // this on end screens so victory and defeat stay alive behind the panel.
  function ambient(dt) {
    state.time += dt;
    if (state.banner.timer > 0) state.banner.timer -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 40);
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.96;
      particle.vy *= 0.96;
      particle.life -= dt;
      if (particle.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i -= 1) {
      const floaterItem = state.floaters[i];
      floaterItem.y -= 42 * dt;
      floaterItem.life -= dt;
      if (floaterItem.life <= 0) state.floaters.splice(i, 1);
    }
    for (const star of state.stars) star.twinkle += dt * star.speed;
    for (const mote of state.motes) {
      mote.y -= mote.rise * dt;
      mote.sway += dt * 0.8;
      mote.x += Math.sin(mote.sway) * 6 * dt;
      if (mote.y < -6) {
        mote.y = FIELD.height + 6;
        mote.x = random.range(0, FIELD.width);
      }
    }
  }

  function celebrate() {
    for (let i = 0; i < 5; i += 1) {
      burst(random.range(180, FIELD.width - 180), random.range(120, FIELD.height - 120), '#ffe066', 18, 300);
    }
    burst(state.player.x, state.player.y, '#ffd166', 30, 340);
  }

  return {
    state,
    reset() {
      Object.assign(state, freshState());
      makeStars();
      makeMotes();
      startWave(1);
    },
    // Advance only the ambient layer (see ambient). Used on end screens.
    tick(dt) {
      ambient(dt);
    },
    // Advance the world one fixed step. `move` is a normalised direction,
    // `firing` whether the trigger is held, `aim` the aim angle in radians.
    // In attract mode the arena idles behind the title screen.
    step(dt, move, firing, aim, attract = false) {
      let events = 0;
      ambient(dt);
      const player = state.player;
      if (player.muzzle > 0) player.muzzle -= dt;

      if (attract) {
        if (state.enemies.length < 7 && random.chance(dt * 0.7)) spawnEnemy(random.pick(['drifter', 'rusher']));
        for (const enemy of state.enemies) {
          if (enemy.spawning > 0) {
            enemy.spawning -= dt;
            continue;
          }
          enemy.wander += dt * 0.8;
          enemy.angle += Math.sin(enemy.wander) * dt * 1.4;
          enemy.x += Math.cos(enemy.angle) * enemy.speed * 0.6 * dt;
          enemy.y += Math.sin(enemy.angle) * enemy.speed * 0.6 * dt;
          enemy.x = Math.max(24, Math.min(FIELD.width - 24, enemy.x));
          enemy.y = Math.max(24, Math.min(FIELD.height - 24, enemy.y));
        }
        return events;
      }

      if (player.invulnerable > 0) player.invulnerable -= dt;
      // The combo clock freezes between waves: a streak survives the
      // breather, so keeping it alive across waves is part of the game.
      if (state.phase !== 'break' && state.comboTimer > 0) {
        state.comboTimer -= dt;
        if (state.comboTimer <= 0) state.combo = 0;
      }

      if (state.phase === 'break') {
        state.breakTimer -= dt;
        if (state.breakTimer <= 0) {
          if (state.wave >= TOTAL_WAVES) {
            state.phase = 'won';
            celebrate();
            return events | EVENT_WON;
          }
          state.wave += 1;
          startWave(state.wave);
          return events | EVENT_WAVE_START;
        }
        return events;
      }
      if (state.phase === 'over' || state.phase === 'won') return events;

      player.vx = move.x * PLAYER.speed;
      player.vy = move.y * PLAYER.speed;
      player.x = Math.max(PLAYER.radius, Math.min(FIELD.width - PLAYER.radius, player.x + move.x * PLAYER.speed * dt));
      player.y = Math.max(PLAYER.radius, Math.min(FIELD.height - PLAYER.radius, player.y + move.y * PLAYER.speed * dt));
      player.angle = aim;
      player.fireCooldown -= dt;
      if (firing && player.fireCooldown <= 0) {
        player.fireCooldown = PLAYER.fireInterval;
        player.muzzle = 0.05;
        state.shotsFired += 1;
        state.bullets.push({
          x: player.x + Math.cos(aim) * (PLAYER.radius + 6),
          y: player.y + Math.sin(aim) * (PLAYER.radius + 6),
          vx: Math.cos(aim) * PLAYER.bulletSpeed,
          vy: Math.sin(aim) * PLAYER.bulletSpeed,
          radius: PLAYER.bulletRadius,
          damage: PLAYER.bulletDamage,
          life: 1.1,
        });
        events |= EVENT_SHOOT;
      }

      if (state.spawnQueue.length > 0) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          state.spawnTimer = spawnInterval(state.wave);
          spawnEnemy(state.spawnQueue.shift());
        }
      }

      events = stepEnemies(dt, events);
      events = stepBullets(dt, events);
      if (events & EVENT_OVER) return events;
      events = stepCollisions(dt, events);
      if (events & EVENT_OVER) return events;

      if (state.spawnQueue.length === 0 && state.enemies.length === 0 && state.phase === 'fight') {
        const bonus = 250 * state.wave;
        state.score += bonus;
        if (state.wave >= TOTAL_WAVES) {
          state.phase = 'won';
          celebrate();
          return events | EVENT_WAVE_CLEAR | EVENT_WON;
        }
        // Recovery: a hurt player regains a heart on milestone waves; a
        // healthy one takes score instead. The banner says which.
        let recovery = '';
        if (RECOVERY_WAVES.includes(state.wave)) {
          if (state.lives < START_LIVES) {
            state.lives += 1;
            recovery = ' · +1 heart';
          } else {
            state.score += RECOVERY_SCORE;
            recovery = ` · +${RECOVERY_SCORE}`;
          }
        }
        state.phase = 'break';
        state.breakTimer = WAVE_BREAK;
        state.banner = { text: `WAVE ${state.wave} CLEAR`, sub: `Bonus +${bonus}${recovery} — next wave incoming`, timer: WAVE_BREAK, duration: WAVE_BREAK };
        return events | EVENT_WAVE_CLEAR;
      }
      return events;
    },
  };
}
