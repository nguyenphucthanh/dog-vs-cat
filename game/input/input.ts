/** What the game needs from a control scheme. Touch controls will produce this same shape. */
export type FrameInput = {
  moveForward: number;
  moveRight: number;
  jump: boolean;
  fire: boolean;
  yawDelta: number;
  pitchDelta: number;
};

export type InputSource = {
  read(): FrameInput;
  dispose(): void;
};

const MOUSE_SENSITIVITY = 0.0022;
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Space']);

/** Keyboard plus pointer-locked mouse. Clicking `element` captures the mouse. */
export function createDesktopInput(element: HTMLElement, onLockChange: (locked: boolean) => void): InputSource {
  const keys = new Set<string>();
  let yawDelta = 0;
  let pitchDelta = 0;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault(); // Space would otherwise scroll or press a focused button.
    keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onBlur = () => keys.clear(); // A key released while unfocused never fires keyup.
  const onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== element) return;
    yawDelta -= event.movementX * MOUSE_SENSITIVITY;
    pitchDelta -= event.movementY * MOUSE_SENSITIVITY;
  };
  const onClick = () => {
    if (document.pointerLockElement === element) return;
    // Rejects if the browser wants a pause after Esc; the next click simply tries again.
    void Promise.resolve(element.requestPointerLock()).catch(() => {});
  };
  const onPointerLockChange = () => onLockChange(document.pointerLockElement === element);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  element.addEventListener('click', onClick);

  return {
    read() {
      const frame: FrameInput = {
        moveForward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
        moveRight: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
        jump: keys.has('KeyE'),
        fire: keys.has('Space'),
        yawDelta,
        pitchDelta,
      };
      yawDelta = 0;
      pitchDelta = 0;
      return frame;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      element.removeEventListener('click', onClick);
      if (document.pointerLockElement === element) document.exitPointerLock();
    },
  };
}
