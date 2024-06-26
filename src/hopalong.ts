/*
 * AUTHOR: Iacopo Sassarini
 * Updated by Sam Leatherdale
 */
import autoBind from 'auto-bind';
import {
  AdditiveBlending,
  BufferGeometry,
  FogExp2,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  Bounds,
  Movement,
  Orbit,
  OrbitParams,
  ParticleSet,
  Settings,
  SimSettings,
  SubsetPoint,
} from './types/hopalong';
import { hsvToHsl } from './util/color';
import { buildGamepadMovementStrategy } from './gamepad';

const SCALE_FACTOR = 1500;
const CAMERA_BOUND = 200;

const LEVEL_DEPTH = 600;

const DEF_BRIGHTNESS = 1;
const DEF_SATURATION = 0.8;

const SPRITE_SIZE = 5;

// Orbit parameters constraints
const A_MIN = -30;
const A_MAX = 30;
const B_MIN = 0.2;
const B_MAX = 1.8;
const C_MIN = 5;
const C_MAX = 17;
const D_MIN = 0;
const D_MAX = 10;
const E_MIN = 0;
const E_MAX = 12;

export const DEFAULT_SPEED = 8;
export const DEFAULT_ROTATION_SPEED = 0.005;
export const DEFAULT_FOV = 60;

export const DEFAULT_POINTS_SUBSET = 4000;
export const DEFAULT_SUBSETS = 7;
export const DEFAULT_LEVELS = 7;

export const SPEED_DELTA = 0.25;
export const SPEED_DELTA_EXTRA = SPEED_DELTA * 4;
export const ROTATION_DELTA = 0.0005;
export const ROTATION_DELTA_EXTRA = ROTATION_DELTA * 4;
export const POINTS_DELTA = 1000;
export const FOV_DELTA = 2;

type HopalongParticleSet = ParticleSet<PointsMaterial>;

type ConstructorProps = {
  settings: Partial<SimSettings>;
  canvas: HTMLCanvasElement;
  texture: Texture;
  stats: Stats;
  onSettingsUpdate: (settings: Settings) => unknown;
};

function hopalong(x: number, y: number, a: number, b: number, c: number) {
  return [
    y - Math.sqrt(Math.abs(b * x - c)) * Math.sign(x),
    a - x
  ]
}

function hopalong2(x: number, y: number, a: number, b: number, c: number) {
  return [
    y - 1.0 - Math.sqrt(Math.abs(b * x - 1.0 - c)) * Math.sign(x - 1.0),
    a - x - 1.0
  ]
}

export default class Hopalong {
  // Orbit parameters
  orbitParams: OrbitParams<number> = {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
  };

  texture: Texture;
  camera: PerspectiveCamera;
  scene: Scene;
  renderer: WebGLRenderer;
  stats: Stats;
  onSettingsUpdate: (settings: SimSettings) => unknown;

  hueValues: number[] = [];

  mouseX = 0;
  mouseY = 0;
  private mouseLocked: boolean;

  windowHalfX = window.innerWidth / 2;
  windowHalfY = window.innerHeight / 2;

  private speed: number;
  private rotationSpeed: number;
  private numPointsSubset: number;
  private numSubsets: number;
  private numLevels: number;

  private controllerConnected: boolean;

  // Orbit data
  orbit: Orbit<number> = {
    subsets: [],
    xMin: 0,
    xMax: 0,
    yMin: 0,
    yMax: 0,
    scaleX: 0,
    scaleY: 0,
  };
  particleSets: HopalongParticleSet[] = [];
  updateIntervalKey: number;
  destroyed = false;

  constructor({ settings, canvas, texture, stats, onSettingsUpdate }: ConstructorProps) {
    autoBind(this);

    this.speed = settings.speed || DEFAULT_SPEED;
    this.rotationSpeed = settings.rotationSpeed || DEFAULT_ROTATION_SPEED;
    this.numSubsets = settings.subsetCount || DEFAULT_SUBSETS;
    this.numLevels = settings.levelCount || DEFAULT_LEVELS;
    this.numPointsSubset = settings.pointsPerSubset || DEFAULT_POINTS_SUBSET;
    this.mouseLocked = settings.mouseLocked || false;
    this.controllerConnected = false;

    this.texture = texture;
    this.stats = stats;
    this.initOrbit(this.numSubsets, this.numPointsSubset);
    this.init(canvas);
    this.animate();
    this.onSettingsUpdate = onSettingsUpdate;
    this.fireSettingsChange();
  }

  destroy() {
    window.clearInterval(this.updateIntervalKey);
    this.renderer.dispose();
    this.destroyed = true;
  }

  initOrbit(numSubsets: number, numPointsSubset: number) {
    // Initialize data points
    this.orbit.subsets = [];
    for (let i = 0; i < numSubsets; i++) {
      const subsetPoints: SubsetPoint[] = [];
      for (let j = 0; j < numPointsSubset; j++) {
        subsetPoints[j] = {
          x: 0,
          y: 0,
          vertex: new Vector3(0, 0, 0),
        };
      }
      this.orbit.subsets.push(subsetPoints);
    }
  }

  init(canvas: HTMLCanvasElement) {
    // Setup renderer and effects
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000);
    this.renderer.setClearAlpha(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);

    this.camera = new PerspectiveCamera(
      DEFAULT_FOV,
      window.innerWidth / window.innerHeight,
      1,
      3 * SCALE_FACTOR
    );
    this.camera.position.set(0, 0, SCALE_FACTOR / 2);

    this.scene = new Scene();
    this.scene.fog = new FogExp2(0x000000, 0.001);

    this.generateOrbit(this.numSubsets, this.numPointsSubset);
    this.generateHues(this.numSubsets);

    // Create particle systems
    for (let k = 0; k < this.numLevels; k++) {
      for (let s = 0; s < this.numSubsets; s++) {
        this.generateParticleSet(k, s);
      }
    }

    this.addEventListeners();
    this.onWindowResize();

    // Schedule orbit regeneration
    this.updateIntervalKey = window.setInterval(this.updateOrbit, 3000);
  }

  setLevelSubsetCount(
    partialSettings: Pick<Partial<SimSettings>, 'levelCount' | 'pointsPerSubset' | 'subsetCount'>
  ) {
    const { levelCount, pointsPerSubset, subsetCount } = partialSettings;
    console.log('setLevelSubsetCount', partialSettings);
    this.numLevels = levelCount || this.numLevels;
    this.numSubsets = subsetCount || this.numSubsets;
    this.numPointsSubset = pointsPerSubset || this.numPointsSubset;

    // First, generate the new orbits
    if (subsetCount !== undefined || pointsPerSubset !== undefined) {
      this.initOrbit(this.numSubsets, this.numPointsSubset);
      this.updateOrbit();
    }

    const exists = new Set();

    // Delete any particle sets that are no longer needed
    this.particleSets = this.particleSets.filter(({ myLevel, particles, mySubset }) => {
      const keep = myLevel < this.numLevels && mySubset < this.numSubsets;
      if (!keep) {
        this.scene.remove(particles);
      } else {
        exists.add(`${myLevel}-${mySubset}`);
      }
      return keep;
    });

    // Generate any new particle sets
    for (let k = 0; k < this.numLevels; k++) {
      for (let s = 0; s < this.numSubsets; s++) {
        if (!exists.has(`${k}-${s}`)) {
          this.generateParticleSet(k, s);
        }
      }
    }
    this.fireSettingsChange();
  }

  generateParticleSet(level: number, subset: number) {
    // Updating from Geometry to BufferGeometry
    // https://github.com/mrdoob/three.js/pull/21031
    // https://discourse.threejs.org/t/three-geometry-will-be-removed-from-core-with-r125/22401
    const vertices = this.orbit.subsets[subset].map(({ vertex }) => vertex);
    const geometry = new BufferGeometry();
    geometry.setFromPoints(vertices);

    // Updating from ParticleSystem to points
    // https://github.com/mrdoob/three.js/issues/4065
    const materials = new PointsMaterial({
      size: SPRITE_SIZE,
      map: this.texture,
      blending: AdditiveBlending,
      depthTest: false,
      transparent: false,
    });

    materials.color.setHSL(...hsvToHsl(this.hueValues[subset], DEF_SATURATION, DEF_BRIGHTNESS));

    const particles = new Points(geometry, materials);
    particles.position.x = 0;
    particles.position.y = 0;
    particles.position.z =
      -LEVEL_DEPTH * level - (subset * LEVEL_DEPTH) / this.numSubsets + SCALE_FACTOR / 2;

    const particleSet: HopalongParticleSet = {
      myMaterial: materials,
      myLevel: level,
      mySubset: subset,
      needsUpdate: false,
      particles,
    };

    this.scene.add(particles);
    this.particleSets.push(particleSet);
  }

  addEventListeners() {
    // Setup listeners
    document.addEventListener('mousemove', this.onDocumentMouseMove, false);
    document.addEventListener('touchstart', this.onDocumentTouchStart, false);
    document.addEventListener('touchmove', this.onDocumentTouchMove, false);
    document.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('gamepadconnected', this.onControllerConnected, false);
    window.addEventListener('gamepaddisconnected', this.onControllerDisconnected, false);
    window.addEventListener('resize', this.onWindowResize, false);
  }

  animate() {
    if (this.destroyed) {
      // This function will continue to run as long as it requests animation frames,
      // so we must stop it
      return;
    }
    requestAnimationFrame(this.animate);
    this.stats.begin();
    this.render();
    this.stats.end();
  }

  render() {
    if (this.camera.position.x >= -CAMERA_BOUND && this.camera.position.x <= CAMERA_BOUND) {
      this.camera.position.x += (this.getMouseX() - this.camera.position.x) * 0.05;
      if (this.camera.position.x < -CAMERA_BOUND) {
        this.camera.position.x = -CAMERA_BOUND;
      }
      if (this.camera.position.x > CAMERA_BOUND) {
        this.camera.position.x = CAMERA_BOUND;
      }
    }
    if (this.camera.position.y >= -CAMERA_BOUND && this.camera.position.y <= CAMERA_BOUND) {
      this.camera.position.y += (-this.getMouseY() - this.camera.position.y) * 0.05;
      if (this.camera.position.y < -CAMERA_BOUND) {
        this.camera.position.y = -CAMERA_BOUND;
      }
      if (this.camera.position.y > CAMERA_BOUND) {
        this.camera.position.y = CAMERA_BOUND;
      }
    }

    this.camera.lookAt(this.scene.position);

    // update particle positions
    // for (let i = 0; i < this.scene.children.length; i++) {
    for (const particleSet of this.particleSets) {
      const { particles, myMaterial, mySubset } = particleSet;
      particles.position.z += this.speed;
      particles.rotation.z += this.rotationSpeed;

      // if the particle level has passed the fade distance
      if (particles.position.z > this.camera.position.z) {
        // move the particle level back in front of the camera
        particles.position.z = -(this.numLevels - 1) * LEVEL_DEPTH;

        if (particleSet.needsUpdate) {
          // update the geometry and color
          const vertices = this.orbit.subsets[mySubset].map(({ vertex }) => vertex);
          const geometry = particleSet.particles.geometry;

          geometry.setFromPoints(vertices);
          particles.geometry.attributes.position.needsUpdate = true;

          myMaterial.color.setHSL(
            ...hsvToHsl(this.hueValues[mySubset], DEF_SATURATION, DEF_BRIGHTNESS)
          );
          particleSet.needsUpdate = false;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  ///////////////////////////////////////////////
  // Hopalong Orbit Generator
  ///////////////////////////////////////////////

  updateOrbit() {
    this.generateOrbit(this.numSubsets, this.numPointsSubset);
    this.generateHues(this.numSubsets);
    for (const particleSet of this.particleSets.values()) {
      particleSet.needsUpdate = true;
    }
  }

  generateHues(numSubsets: number) {
    this.hueValues = new Array(numSubsets).fill(0).map(() => Math.random());
  }

  generateOrbit(numSubsets: number, numPointsSubset: number) {
    this.prepareOrbit();

    const { a, b, c, d, e } = this.orbitParams;
    // Using local vars should be faster
    const al = a;
    const bl = b;
    const cl = c;
    const dl = d;
    const el = e;
    const subsets = this.orbit.subsets;
    const scale_factor_l = SCALE_FACTOR;

    let xMin = 0,
      xMax = 0,
      yMin = 0,
      yMax = 0;
    const choice = Math.random();

    for (let s = 0; s < numSubsets; s++) {
      // Use a different starting point for each orbit subset
      let x = s * 0.005 * (0.5 - Math.random());
      let y = s * 0.005 * (0.5 - Math.random());
      let z: number;
      let x1: number;

      const curSubset = subsets[s];

      for (let i = 0; i < numPointsSubset; i++) {
        // Iteration formula (generalization of the Barry Martin's original one)

        const [xn, yn] = hopalong(x, y, a, b, c)
        x = xn;
        y = yn;

        curSubset[i].x = x;
        curSubset[i].y = y;

        if (x < xMin) {
          xMin = x;
        } else if (x > xMax) {
          xMax = x;
        }
        if (y < yMin) {
          yMin = y;
        } else if (y > yMax) {
          yMax = y;
        }
      }
    }

    const scaleX = (2 * scale_factor_l) / (xMax - xMin);
    const scaleY = (2 * scale_factor_l) / (yMax - yMin);

    this.orbit.xMin = xMin;
    this.orbit.xMax = xMax;
    this.orbit.yMin = yMin;
    this.orbit.yMax = yMax;
    this.orbit.scaleX = scaleX;
    this.orbit.scaleY = scaleY;

    // Normalize and update vertex data
    for (let s = 0; s < this.numSubsets; s++) {
      const curSubset = subsets[s];
      for (let i = 0; i < numPointsSubset; i++) {
        curSubset[i].vertex.setX(scaleX * (curSubset[i].x - xMin) - scale_factor_l);
        curSubset[i].vertex.setY(scaleY * (curSubset[i].y - yMin) - scale_factor_l);
      }
    }
  }

  prepareOrbit() {
    this.shuffleParams();
    this.orbit.xMin = 0;
    this.orbit.xMax = 0;
    this.orbit.yMin = 0;
    this.orbit.yMax = 0;
  }

  shuffleParams() {
    this.orbitParams = {
      a: A_MIN + Math.random() * (A_MAX - A_MIN),
      b: B_MIN + Math.random() * (B_MAX - B_MIN),
      c: C_MIN + Math.random() * (C_MAX - C_MIN),
      d: D_MIN + Math.random() * (D_MAX - D_MIN),
      e: E_MIN + Math.random() * (E_MAX - E_MIN),
    };
  }

  ///////////////////////////////////////////////
  // Event listeners
  ///////////////////////////////////////////////

  onDocumentMouseMove(event: MouseEvent) {
    if (this.mouseLocked) {
      return;
    }
    this.mouseX = event.clientX - this.windowHalfX;
    this.mouseY = event.clientY - this.windowHalfY;
  }

  onDocumentTouchStart(event: TouchEvent) {
    if (this.mouseLocked) {
      return;
    }
    if (event.touches.length == 1) {
      this.mouseX = event.touches[0].pageX - this.windowHalfX;
      this.mouseY = event.touches[0].pageY - this.windowHalfY;
    }
  }

  onDocumentTouchMove(event: TouchEvent) {
    if (this.mouseLocked) {
      return;
    }
    if (event.touches.length == 1) {
      this.mouseX = event.touches[0].pageX - this.windowHalfX;
      this.mouseY = event.touches[0].pageY - this.windowHalfY;
    }
  }

  setMouseLock(locked?: boolean) {
    if (typeof locked === 'undefined') {
      this.mouseLocked = !this.mouseLocked;
    } else {
      this.mouseLocked = locked;
    }
    this.fireSettingsChange();
  }

  recenterCamera() {
    this.camera.position.x = 0;
    this.camera.position.y = 0;
    this.mouseX = 0;
    this.mouseY = 0;

    this.setMouseLock(true);
  }

  getMouseX() {
    return this.mouseX;
  }
  getMouseY() {
    return this.mouseY;
  }

  applySettings(settings: Partial<SimSettings>) {
    const { speed, rotationSpeed, mouseLocked, cameraFov } = settings;
    if (typeof speed !== 'undefined') {
      this.speed = speed;
    }
    if (typeof rotationSpeed !== 'undefined') {
      this.rotationSpeed = rotationSpeed;
    }
    if (typeof mouseLocked !== 'undefined') {
      this.mouseLocked = mouseLocked;
    }
    if (typeof cameraFov !== 'undefined') {
      this.setCameraFOV(cameraFov);
    }
    const { levelCount, subsetCount, pointsPerSubset } = settings;
    const advancedSettings = { levelCount, subsetCount, pointsPerSubset };
    if (Object.values(advancedSettings).some((value) => typeof value !== 'undefined')) {
      this.setLevelSubsetCount(advancedSettings);
    }
  }

  fireSettingsChange() {
    this.onSettingsUpdate(this.getSettings());
  }

  getSettings(): SimSettings {
    const { speed, rotationSpeed, mouseLocked } = this;
    return {
      speed,
      rotationSpeed,
      mouseLocked,
      cameraFov: this.camera.fov,
      levelCount: this.numLevels,
      subsetCount: this.numSubsets,
      pointsPerSubset: this.numPointsSubset,
    };
  }

  changeFov(delta: number) {
    const newFov = this.camera.fov + delta;
    this.setCameraFOV(newFov);
  }

  changeSpeed(delta: number) {
    const newSpeed = this.speed + delta;
    if (newSpeed >= 0) {
      this.speed = newSpeed;
    } else {
      this.speed = 0;
    }
    this.fireSettingsChange();
  }

  changeRotationSpeed(delta: number) {
    this.rotationSpeed += delta;
    this.fireSettingsChange();
  }

  changeLevelSubset(delta: number) {
    this.setLevelSubsetCount({
      levelCount: this.numLevels + delta,
      subsetCount: this.numSubsets + delta,
    });
  }

  changePointsPerSubset(delta: number) {
    this.setLevelSubsetCount({
      pointsPerSubset: this.numPointsSubset + delta,
    });
  }

  resetDefaults() {
    this.speed = DEFAULT_SPEED;
    this.rotationSpeed = DEFAULT_ROTATION_SPEED;
    this.camera.fov = DEFAULT_FOV;
    this.mouseLocked = false;

    this.setLevelSubsetCount({
      levelCount: DEFAULT_LEVELS,
      subsetCount: DEFAULT_SUBSETS,
      pointsPerSubset: DEFAULT_POINTS_SUBSET,
    });
    this.fireSettingsChange();
  }

  getBounds(): Bounds {
    return {
      width: this.windowHalfX * 2,
      height: this.windowHalfY * 2,
    }
  }

  getCurrentMovement(): Movement {
    return {
      speed: this.speed,
      rotationSpeed: this.rotationSpeed,
      x: this.mouseX,
      y: this.mouseY
    }
  }

  applyMovement(movement: Movement) {
    this.speed = movement.speed;
    this.rotationSpeed = movement.rotationSpeed;
    this.mouseX = movement.x;
    this.mouseY = movement.y;
  }

  updateGamepadMovement(gamepad: Gamepad) {
    const movementStrategyExecutor = buildGamepadMovementStrategy(gamepad);
    const bounds = this.getBounds();

    const currentMovement = this.getCurrentMovement();

    const nextMovement = movementStrategyExecutor(bounds, currentMovement, gamepad);

    this.applyMovement(nextMovement);
    this.fireSettingsChange();
  }

  controllerLoop() {
    const [ gamepad ] = navigator.getGamepads();
    if(!this.controllerConnected || !gamepad) { return; }

    this.updateGamepadMovement(gamepad);

    requestAnimationFrame(this.controllerLoop);
  }

  stopMovement() {
    this.speed = 0;
    this.rotationSpeed = 0;
  }

  initGamepadMode() {
    this.controllerConnected = true;
    this.stopMovement();
    this.recenterCamera();
    requestAnimationFrame(this.controllerLoop);
  }

  exitGamepadMode() {
    this.controllerConnected = false;
  }

  onControllerConnected(e) {
    this.controllerConnected = true;
    this.initGamepadMode();
  }

  onControllerDisconnected(e) {
    this.controllerConnected = false;
  }

  onKeyDown(event: KeyboardEvent) {
    const { key } = event;
    const keyNormalised = key.length === 1 ? key.toUpperCase() : key;

    const settingsShortcuts: { [key: string]: () => void } = {
      F: () => this.changeFov(FOV_DELTA),
      G: () => this.changeFov(-FOV_DELTA),
      '.': () => this.changeLevelSubset(1),
      ',': () => this.changeLevelSubset(-1),
      P: () => this.changePointsPerSubset(POINTS_DELTA),
      O: () => this.changePointsPerSubset(-POINTS_DELTA),
      H: () => document.body.classList.toggle('hideCursor'),
      C: () => this.recenterCamera()
    };

    if(keyNormalised in settingsShortcuts) {
      settingsShortcuts[keyNormalised]();
      return;
    }

    if(this.controllerConnected) return;

    const movementShortcuts: { [key: string]: () => void } = {
      ArrowUp: () => this.changeSpeed(SPEED_DELTA),
      W: () => this.changeSpeed(SPEED_DELTA_EXTRA),
      ArrowDown: () => this.changeSpeed(-SPEED_DELTA),
      S: () => this.changeSpeed(-SPEED_DELTA_EXTRA),
      ArrowLeft: () => this.changeRotationSpeed(ROTATION_DELTA),
      A: () => this.changeRotationSpeed(ROTATION_DELTA_EXTRA),
      ArrowRight: () => this.changeRotationSpeed(-ROTATION_DELTA),
      D: () => this.changeRotationSpeed(-ROTATION_DELTA_EXTRA),
      R: () => this.resetDefaults(),
      L: () => this.setMouseLock()
    };

    if (keyNormalised in movementShortcuts) {
      movementShortcuts[keyNormalised]();
    }
  }

  onWindowResize() {
    this.windowHalfX = window.innerWidth / 2;
    this.windowHalfY = window.innerHeight / 2;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }

  setCameraFOV(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.fireSettingsChange();
  }
}
