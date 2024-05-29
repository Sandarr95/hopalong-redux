import { Bounds, Movement, MovementStrategy } from './types/hopalong';

const stdGamepadMovementStrategy: MovementStrategy = function (
  bounds: Bounds,
  current: Movement,
  gamepad: Gamepad
): Movement {
  const { width, height } = bounds;
  const { x, y } = current;

  // Rotational momentum
  const leftStickHorizontal = deadzone(-gamepad.axes[0]);
  const newRotationSpeed = leftStickHorizontal / 50;

  // Forward momentum
  const leftStickVertical = deadzone(-gamepad.axes[1]);
  const leftStickMagnitude = magnitude(leftStickHorizontal, leftStickVertical);
  const forwardSpeed = clamp(
    0,
    exponentiate(leftStickMagnitude * 4) * Math.sign(leftStickVertical)
  );

  // Transverse momentum
  const rightStickHorizontal = deadzone(gamepad.axes[2]);
  const transverseSpeedX = signedSqrt(rightStickHorizontal) * 10;
  const newX = clamp(-width / 2, transverseSpeedX + x, width / 2);

  const rightStickVertical = deadzone(gamepad.axes[3]);
  const transverseSpeedY = signedSqrt(rightStickVertical) * 10;
  const newY = clamp(-height / 2, transverseSpeedY + y, height / 2);

  return {
    speed: forwardSpeed,
    rotationSpeed: newRotationSpeed,
    x: newX,
    y: newY,
  };
};

const arcadeGamepadMovementStrategy: MovementStrategy = function (
  bounds: Bounds,
  current: Movement,
  gamepad: Gamepad
): Movement {
  const { width, height } = bounds;
  const { x, y } = current;

  const bigRightButton = gamepad.buttons[0];
  const bigLeftButton = gamepad.buttons[3];
  const speed = bigRightButton.pressed ? 8 : bigLeftButton.pressed ? 4 : 2;

  const smallRightButton = gamepad.buttons[1];
  const smallLeftButton = gamepad.buttons[2];
  const rotationSpeed = (function () {
    if (smallRightButton.pressed && smallLeftButton.pressed) {
      return 0;
    }
    if (smallRightButton.pressed) {
      return -0.02;
    }
    if (smallLeftButton.pressed) {
      return 0.02;
    }
    return 0;
  })();
  const speedEasterEgg = smallRightButton.pressed && smallLeftButton.pressed ? 2 : 1;

  // Transverse momentum
  const rightStickHorizontal = deadzone(gamepad.axes[0]);
  const transverseSpeedX = signedSqrt(rightStickHorizontal) * 10;
  const newX = clamp(-width / 2, transverseSpeedX + x, width / 2);

  const rightStickVertical = deadzone(gamepad.axes[1]);
  const transverseSpeedY = signedSqrt(rightStickVertical) * 10;
  const newY = clamp(-height / 2, transverseSpeedY + y, height / 2);

  return {
    speed: speed * speedEasterEgg,
    rotationSpeed: rotationSpeed,
    x: newX,
    y: newY,
  };
};

function buildGamepadMovementStrategy(gamepad: Gamepad): MovementStrategy {
  if (gamepad.id.includes('SPEEDLINK COMPETITION PRO Game Controller for Android')) {
    return arcadeGamepadMovementStrategy;
  }
  return stdGamepadMovementStrategy;
}

export { buildGamepadMovementStrategy };

// Helpers

function clamp(min: number, target: number, max: number = Infinity) {
  return Math.max(min, Math.min(target, max));
}

function deadzone(stickOffset: number, deadzone: number = 0.1) {
  return Math.abs(stickOffset) < deadzone ? 0 : stickOffset - deadzone;
}

function exponentiate(stickOffset: number, base: number = 2) {
  return Math.sign(stickOffset) * Math.pow(base, Math.abs(stickOffset));
}

function magnitude(...axes: number[]) {
  return Math.sqrt(
    axes.reduce(
      (acc: number, axis: number) => acc + Math.pow(axis, 2),
      0
    )
  );
}

function signedSqrt(n: number) {
  return Math.sqrt(Math.abs(n)) * Math.sign(n);
}
