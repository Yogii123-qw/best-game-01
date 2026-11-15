// Keyboard and mouse input for Emberfall Arena.
//
// Movement keys are read as a held set every frame; single-press actions
// (start, pause, restart, mute) are queued as one-shot bits the loop takes
// and clears, so holding a key never fires the action twice. Clicks that
// land on a HUD button (the loop supplies the test) never fire the weapon:
// pressing pause must not shoot.
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

export function createInput(canvas, isUiPoint = null) {
  const held = new Set();
  let queued = 0;
  let mouse = { x: 0, y: 0, firing: false, clicked: false };
  let lastClick = null;
  let pressWasUi = false;

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

  function onBlur() {
    held.clear();
    mouse = { ...mouse, firing: false, clicked: false };
  }

  function trackMouse(event) {
    const rect = canvas.getBoundingClientRect();
    mouse = { ...mouse, x: event.clientX - rect.left, y: event.clientY - rect.top };
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

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', trackMouse);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    // Normalised movement direction from the held keys, or {x:0,y:0}.
    direction() {
      const x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      const y = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0 };
      const length = Math.hypot(x, y);
      return { x: x / length, y: y / length };
    },
    mouse() {
      return mouse;
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
