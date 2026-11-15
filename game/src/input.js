// Keyboard, mouse and touch input for Emberfall Arena.
//
// Movement keys are read as a held set every frame; single-press actions
// (start, pause, restart, mute) are queued as one-shot bits the loop takes
// and clears, so holding a key never fires the action twice. Clicks that
// land on a HUD button (the loop supplies the test) never fire the weapon:
// pressing pause must not shoot.
//
// Touch is an addition, never a replacement: the desktop path below is
// unchanged. On a touch screen, while a run is live, the left half is a
// floating joystick (it spawns where the thumb lands, with a dead zone
// and analog strength) and the right half aims at the touch point and
// fires while held. Both thumbs work at the same time. A quick tap that
// is not a joystick or aim touch becomes exactly the same click the mouse
// produces, so PLAY, PLAY AGAIN and the HUD buttons all work by tap, and
// a tap on a HUD button never moves or shoots. Off the play screen every
// touch is a tap candidate. Touch defaults (scroll, zoom, synthetic
// clicks) are suppressed on the canvas so the game owns the glass.
//
// Losing the window clears everything held, so the wisp never keeps
// walking after the player alt-tabs away mid-press.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

const MOVE_KEYS = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

// Thumb travel, in CSS pixels: the stick reaches full strength at this
// drag distance, and smaller trembles near the base are ignored.
const STICK_RADIUS = 60;
const STICK_DEAD_ZONE = 10;
// A tap is a short touch that barely moves; anything longer or further
// is a drag, not a press.
const TAP_SLOP = 12;
const TAP_MAX_MS = 500;

export function createInput(canvas, isUiPoint = null, options = {}) {
  const toLogical = options.toLogical || null;
  const isPlaying = options.isPlaying || (() => false);
  const held = new Set();
  let queued = 0;
  let mouse = { x: 0, y: 0, firing: false, clicked: false, moved: false };
  let lastClick = null;
  let pressWasUi = false;

  let touchDetected = false;
  let stick = null; // { id, baseX, baseY, x, y } in client coordinates.
  let aimTouch = null; // { id, x, y } in client coordinates.
  let tap = null; // { id, startX, startY, startedAt, ui }.

  function onKeyDown(event) {
    const move = MOVE_KEYS[event.code];
    if (move) {
      held.add(move);
      event.preventDefault();
      return;
    }
    if (event.code === 'Space' || event.code === 'Enter') {
      queued |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      queued |= ACTION_PAUSE;
    } else if (event.code === 'KeyR') {
      queued |= ACTION_RESTART;
    } else if (event.code === 'KeyM') {
      queued |= ACTION_MUTE;
    }
  }

  function onKeyUp(event) {
    const move = MOVE_KEYS[event.code];
    if (move) held.delete(move);
  }

  function releaseTouches() {
    stick = null;
    aimTouch = null;
    tap = null;
  }

  function onBlur() {
    held.clear();
    mouse = { ...mouse, firing: false, clicked: false };
    releaseTouches();
  }

  function trackMouse(event) {
    const rect = canvas.getBoundingClientRect();
    mouse = { ...mouse, x: event.clientX - rect.left, y: event.clientY - rect.top, moved: true };
  }

  function onMouseDown(event) {
    trackMouse(event);
    pressWasUi = Boolean(isUiPoint && isUiPoint(event.clientX, event.clientY));
    if (!pressWasUi) mouse = { ...mouse, firing: true };
  }

  function onMouseUp() {
    mouse = { ...mouse, firing: false };
  }

  function onClick(event) {
    trackMouse(event);
    lastClick = { x: event.clientX, y: event.clientY, ui: pressWasUi };
    if (!pressWasUi) mouse = { ...mouse, clicked: true };
    pressWasUi = false;
  }

  function canvasPoint(touch) {
    const rect = canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top, width: rect.width, height: rect.height };
  }

  function onTouchStart(event) {
    event.preventDefault();
    touchDetected = true;
    for (const touch of event.changedTouches) {
      const point = canvasPoint(touch);
      // A HUD button always wins, whatever half it sits on.
      if (isUiPoint && isUiPoint(touch.clientX, touch.clientY)) {
        if (!tap) tap = { id: touch.identifier, startX: point.x, startY: point.y, startedAt: performance.now(), ui: true };
        continue;
      }
      if (!isPlaying()) {
        if (!tap) tap = { id: touch.identifier, startX: point.x, startY: point.y, startedAt: performance.now(), ui: false };
        continue;
      }
      if (point.x < point.width / 2) {
        // Left half: the floating stick, one at a time.
        if (!stick) stick = { id: touch.identifier, baseX: point.x, baseY: point.y, x: point.x, y: point.y };
      } else if (!aimTouch) {
        // Right half: aim at the thumb and fire while it stays down.
        aimTouch = { id: touch.identifier, x: point.x, y: point.y };
      }
    }
  }

  function onTouchMove(event) {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const point = canvasPoint(touch);
      if (stick && touch.identifier === stick.id) {
        stick.x = point.x;
        stick.y = point.y;
      } else if (aimTouch && touch.identifier === aimTouch.id) {
        aimTouch.x = point.x;
        aimTouch.y = point.y;
      }
    }
  }

  function endTouch(touch, cancelled) {
    if (stick && touch.identifier === stick.id) {
      stick = null;
      return;
    }
    if (aimTouch && touch.identifier === aimTouch.id) {
      aimTouch = null;
      return;
    }
    if (tap && touch.identifier === tap.id) {
      const point = canvasPoint(touch);
      const moved = Math.hypot(point.x - tap.startX, point.y - tap.startY);
      const quick = performance.now() - tap.startedAt <= TAP_MAX_MS;
      // A tap becomes the same click a mouse press makes, so every
      // button in the game works identically for both pointers.
      if (!cancelled && moved <= TAP_SLOP && quick) {
        lastClick = { x: touch.clientX, y: touch.clientY, ui: tap.ui };
        if (!tap.ui) mouse = { ...mouse, clicked: true };
      }
      tap = null;
    }
  }

  function onTouchEnd(event) {
    event.preventDefault();
    for (const touch of event.changedTouches) endTouch(touch, false);
  }

  function onTouchCancel(event) {
    event.preventDefault();
    for (const touch of event.changedTouches) endTouch(touch, true);
  }

  function stickVector() {
    if (!stick) return null;
    const dx = stick.x - stick.baseX;
    const dy = stick.y - stick.baseY;
    const distance = Math.hypot(dx, dy);
    if (distance <= STICK_DEAD_ZONE) return { x: 0, y: 0, strength: 0 };
    const strength = Math.min(1, distance / STICK_RADIUS);
    return { x: (dx / distance) * strength, y: (dy / distance) * strength, strength };
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseTouches();
  });
  canvas.addEventListener('mousemove', trackMouse);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchCancel, { passive: false });
  canvas.addEventListener('gesturestart', (event) => event.preventDefault());

  return {
    // Normalised movement direction from the held keys, or the analog
    // stick vector while the thumb is pushing past the dead zone.
    direction() {
      const vector = stickVector();
      if (vector && vector.strength > 0) return { x: vector.x, y: vector.y };
      const x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      const y = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const length = Math.hypot(x, y);
      return { x: x / length, y: y / length };
    },
    // The aim pointer: the mouse, or the right thumb while it is down.
    // `moved` tells the loop whether any pointer has ever aimed, so the
    // reticle never parks in a corner on a phone that never saw a mouse.
    mouse() {
      if (aimTouch) {
        return { ...mouse, x: aimTouch.x, y: aimTouch.y, firing: true, moved: true };
      }
      return mouse;
    },
    // Touch state for the renderer, in logical coordinates: whether any
    // touch has ever happened, and the live stick (base, clamped thumb,
    // radius) while the left thumb is down.
    touch() {
      if (!toLogical) return { detected: touchDetected, stick: null, aiming: Boolean(aimTouch) };
      const rect = canvas.getBoundingClientRect();
      const toClient = (point) => ({ x: point.x + rect.left, y: point.y + rect.top });
      let stickState = null;
      if (stick) {
        const base = toLogical(stick.baseX + rect.left, stick.baseY + rect.top);
        const vector = stickVector() || { x: 0, y: 0 };
        const edge = toLogical(stick.baseX + rect.left + STICK_RADIUS, stick.baseY + rect.top);
        const radius = Math.abs(edge.x - base.x);
        const clamped = {
          x: stick.baseX + vector.x * STICK_RADIUS,
          y: stick.baseY + vector.y * STICK_RADIUS,
        };
        const thumbClient = toClient(clamped);
        const thumb = toLogical(thumbClient.x, thumbClient.y);
        stickState = { baseX: base.x, baseY: base.y, thumbX: thumb.x, thumbY: thumb.y, radius, active: true };
      }
      return { detected: touchDetected, stick: stickState, aiming: Boolean(aimTouch) };
    },
    takeActions() {
      const actions = queued;
      queued = 0;
      return actions;
    },
    takeClick() {
      const clicked = mouse.clicked;
      mouse = { ...mouse, clicked: false };
      return clicked;
    },
    // The most recent click in client coordinates (for HUD button hits),
    // consumed on read.
    takeClickPoint() {
      const point = lastClick;
      lastClick = null;
      return point;
    },
  };
}
