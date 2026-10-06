/**
 * ClickEngine
 *
 * UI/E2E testleri için gelişmiş mouse, click, scroll ve
 * content-reading interaction simulator.
 *
 * Özellikler:
 * - Cubic Bezier mouse trajectories
 * - Coherent Perlin noise path variation
 * - Acceleration / cruise / deceleration speed profile
 * - Configurable speed variation
 * - Seeded deterministic RNG
 * - Configurable click hold duration
 * - Gaussian micro jitter
 * - Momentum-style scrolling
 * - Content-aware reading duration
 * - Deep configuration merge
 * - Runtime config update
 */

import {
  Page,
  ElementHandle,
  Locator,
} from 'patchright';

import { Logger } from '../utils/logger';

/* =========================================================
 * TYPES
 * ======================================================= */

export interface Point {
  x: number;
  y: number;
}

export type ClickTarget =
  | ElementHandle
  | Locator;

export interface BezierControlPoints {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

export interface TrajectoryPoint {
  point: Point;
  progress: number;

  /**
   * > 1 = faster segment
   * < 1 = slower segment
   */
  speedFactor: number;
}

export interface DelayConfig {
  min: number;
  max: number;
  mean: number;
  sigma: number;
}

export interface TrajectoryConfig {
  /**
   * Bezier curve tension.
   */
  tension: number;

  /**
   * Number of trajectory segments.
   */
  steps: number;

  /**
   * Maximum coherent noise displacement.
   */
  noiseAmplitude: number;

  /**
   * Noise sampling frequency.
   */
  noiseFrequency: number;

  /**
   * Maximum speed variation.
   */
  speedVariation: number;
}

export interface ClickConfig {
  hoverDelay: DelayConfig;

  moveDuration: DelayConfig;

  /**
   * mouse.down() -> mouse.up() duration.
   */
  clickHoldDuration: DelayConfig;

  postClickDelay: DelayConfig;

  trajectory: TrajectoryConfig;

  /**
   * Gaussian micro jitter in pixels.
   */
  jitter: number;
}

export interface ScrollConfig {
  speed: {
    min: number;
    max: number;
    mean: number;
  };

  momentumDecay: number;

  steps: number;

  stepDelay: {
    min: number;
    max: number;
  };

  pauseProbability: number;

  pauseDuration: {
    min: number;
    max: number;
  };

  backtrackProbability: number;

  backtrackDistance: {
    min: number;
    max: number;
  };
}

export interface ReadingConfig {
  msPerWord: {
    min: number;
    max: number;
  };

  msPerImage: {
    min: number;
    max: number;
  };

  minDuration: number;

  maxDuration: number;

  scrollRatio: number;
}

export interface ClickEngineConfig {
  base: {
    humanLike: boolean;
    seed?: number;
    debug: boolean;
  };

  click: Partial<ClickConfig>;

  scroll: Partial<ScrollConfig>;

  reading: Partial<ReadingConfig>;
}

interface ResolvedClickEngineConfig {
  base: {
    humanLike: boolean;
    seed?: number;
    debug: boolean;
  };

  click: ClickConfig;

  scroll: ScrollConfig;

  reading: ReadingConfig;
}

/* =========================================================
 * DEFAULT CONFIG
 * ======================================================= */

const DEFAULT_CLICK_CONFIG: ClickConfig = {
  hoverDelay: {
    min: 50,
    max: 800,
    mean: 250,
    sigma: 0.5,
  },

  moveDuration: {
    min: 200,
    max: 2000,
    mean: 600,
    sigma: 0.4,
  },

  clickHoldDuration: {
    min: 50,
    max: 150,
    mean: 90,
    sigma: 0.25,
  },

  postClickDelay: {
    min: 100,
    max: 500,
    mean: 200,
    sigma: 0.3,
  },

  trajectory: {
    tension: 0.5,
    steps: 50,
    noiseAmplitude: 6,
    noiseFrequency: 0.08,
    speedVariation: 0.15,
  },

  jitter: 2,
};

const DEFAULT_SCROLL_CONFIG: ScrollConfig = {
  speed: {
    min: 200,
    max: 1500,
    mean: 600,
  },

  momentumDecay: 0.95,

  steps: 30,

  stepDelay: {
    min: 16,
    max: 50,
  },

  pauseProbability: 0.15,

  pauseDuration: {
    min: 1.5,
    max: 8,
  },

  backtrackProbability: 0.12,

  backtrackDistance: {
    min: 100,
    max: 400,
  },
};

const DEFAULT_READING_CONFIG: ReadingConfig = {
  msPerWord: {
    min: 180,
    max: 350,
  },

  msPerImage: {
    min: 800,
    max: 2500,
  },

  minDuration: 2000,

  maxDuration: 30000,

  scrollRatio: 0.7,
};

/* =========================================================
 * RANDOM SOURCE
 * ======================================================= */

interface RandomSource {
  random(): number;

  range(
    min: number,
    max: number
  ): number;

  gaussian(
    mean?: number,
    stdDev?: number
  ): number;

  integer(
    min: number,
    max: number
  ): number;
}

/**
 * Seeded deterministic pseudo random generator.
 *
 * Important:
 * All stochastic behavior in the engine goes through
 * this class. This makes seeded test runs reproducible.
 */
class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed?: number) {
    const fallback =
      Math.floor(
        Math.random() *
        0xffffffff
      );

    this.state =
      (seed ?? fallback) >>> 0;

    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  random(): number {
    let t = this.state += 0x6d2b79f5;

    t = Math.imul(
      t ^ (t >>> 15),
      t | 1
    );

    t ^= t + Math.imul(
      t ^ (t >>> 7),
      t | 61
    );

    return (
      ((t ^ (t >>> 14)) >>> 0) /
      4294967296
    );
  }

  range(
    min: number,
    max: number
  ): number {
    if (max <= min) {
      return min;
    }

    return (
      min +
      this.random() *
      (max - min)
    );
  }

  integer(
    min: number,
    max: number
  ): number {
    return Math.floor(
      this.range(
        min,
        max + 1
      )
    );
  }

  gaussian(
    mean = 0,
    stdDev = 1
  ): number {
    let u = 0;
    let v = 0;

    while (u === 0) {
      u = this.random();
    }

    while (v === 0) {
      v = this.random();
    }

    const z =
      Math.sqrt(
        -2 *
        Math.log(u)
      ) *
      Math.cos(
        2 *
        Math.PI *
        v
      );

    return mean + z * stdDev;
  }
}

/* =========================================================
 * MATH UTILITIES
 * ======================================================= */

class MathUtils {
  static clamp(
    value: number,
    min: number,
    max: number
  ): number {
    return Math.min(
      Math.max(value, min),
      max
    );
  }

  static distance(
    a: Point,
    b: Point
  ): number {
    const dx =
      b.x - a.x;

    const dy =
      b.y - a.y;

    return Math.hypot(
      dx,
      dy
    );
  }

  static easeInOutCubic(
    t: number
  ): number {
    const value =
      MathUtils.clamp(
        t,
        0,
        1
      );

    return value < 0.5
      ? 4 * value ** 3
      : 1 -
          Math.pow(
            -2 * value + 2,
            3
          ) /
            2;
  }

  static smoothStep(
    t: number
  ): number {
    const value =
      MathUtils.clamp(
        t,
        0,
        1
      );

    return (
      value *
      value *
      (3 - 2 * value)
    );
  }
}

/* =========================================================
 * PERLIN NOISE
 * ======================================================= */

class PerlinNoise {
  private readonly permutation: number[];

  constructor(
    seed: number
  ) {
    const values =
      Array.from(
        { length: 256 },
        (_, index) => index
      );

    let state =
      seed >>> 0;

    if (state === 0) {
      state = 0x12345678;
    }

    const random = (): number => {
      state += 0x6d2b79f5;

      let t = state;

      t = Math.imul(
        t ^ (t >>> 15),
        t | 1
      );

      t ^= t + Math.imul(
        t ^ (t >>> 7),
        t | 61
      );

      return (
        ((t ^ (t >>> 14)) >>> 0) /
        4294967296
      );
    };

    for (
      let i = values.length - 1;
      i > 0;
      i--
    ) {
      const j =
        Math.floor(
          random() *
          (i + 1)
        );

      [
        values[i],
        values[j],
      ] = [
        values[j],
        values[i],
      ];
    }

    this.permutation = [
      ...values,
      ...values,
    ];
  }

  private fade(
    t: number
  ): number {
    return (
      t *
      t *
      t *
      (t *
        (t * 6 - 15) +
        10)
    );
  }

  private lerp(
    a: number,
    b: number,
    t: number
  ): number {
    return (
      a +
      (b - a) * t
    );
  }

  private gradient(
    hash: number,
    x: number,
    y: number
  ): number {
    switch (hash & 3) {
      case 0:
        return x + y;

      case 1:
        return -x + y;

      case 2:
        return x - y;

      default:
        return -x - y;
    }
  }

  noise(
    x: number,
    y: number
  ): number {
    const xi =
      Math.floor(x) & 255;

    const yi =
      Math.floor(y) & 255;

    const xf =
      x - Math.floor(x);

    const yf =
      y - Math.floor(y);

    const u =
      this.fade(xf);

    const v =
      this.fade(yf);

    const p =
      this.permutation;

    const aa =
      p[p[xi] + yi];

    const ab =
      p[p[xi] + yi + 1];

    const ba =
      p[p[xi + 1] + yi];

    const bb =
      p[p[xi + 1] + yi + 1];

    const x1 =
      this.lerp(
        this.gradient(
          aa,
          xf,
          yf
        ),
        this.gradient(
          ba,
          xf - 1,
          yf
        ),
        u
      );

    const x2 =
      this.lerp(
        this.gradient(
          ab,
          xf,
          yf - 1
        ),
        this.gradient(
          bb,
          xf - 1,
          yf - 1
        ),
        u
      );

    return this.lerp(
      x1,
      x2,
      v
    );
  }
}

/* =========================================================
 * CONFIG UTILITIES
 * ======================================================= */

function cloneConfig<T>(
  value: T
): T {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return [
      ...value,
    ] as T;
  }

  const result =
    {} as T;

  for (
    const key of Object.keys(
      value as object
    ) as Array<keyof T>
  ) {
    result[key] =
      cloneConfig(
        value[key]
      );
  }

  return result;
}

function mergeObjects<T extends object>(
  base: T,
  override?: Partial<T>
): T {
  const result =
    cloneConfig(base);

  if (!override) {
    return result;
  }

  for (
    const key of Object.keys(
      override
    ) as Array<keyof T>
  ) {
    const incoming =
      override[key];

    if (
      incoming &&
      typeof incoming === 'object' &&
      !Array.isArray(incoming)
    ) {
      const existing =
        result[key];

      if (
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        result[key] =
          mergeObjects(
            existing as object,
            incoming as object
          ) as T[keyof T];

        continue;
      }
    }

    result[key] =
      incoming as T[keyof T];
  }

  return result;
}

/* =========================================================
 * CONFIG VALIDATOR
 * ======================================================= */

class ConfigValidator {
  static validate(
    config: ResolvedClickEngineConfig
  ): void {
    this.assertRange(
      config.click.trajectory.tension,
      0,
      1,
      'click.trajectory.tension'
    );

    this.assertPositiveInteger(
      config.click.trajectory.steps,
      'click.trajectory.steps'
    );

    this.assertNonNegative(
      config.click.trajectory.noiseAmplitude,
      'click.trajectory.noiseAmplitude'
    );

    this.assertPositive(
      config.click.trajectory.noiseFrequency,
      'click.trajectory.noiseFrequency'
    );

    this.assertRange(
      config.click.trajectory.speedVariation,
      0,
      1,
      'click.trajectory.speedVariation'
    );

    this.assertNonNegative(
      config.click.jitter,
      'click.jitter'
    );

    this.assertDelay(
      config.click.hoverDelay,
      'click.hoverDelay'
    );

    this.assertDelay(
      config.click.moveDuration,
      'click.moveDuration'
    );

    this.assertDelay(
      config.click.clickHoldDuration,
      'click.clickHoldDuration'
    );

    this.assertDelay(
      config.click.postClickDelay,
      'click.postClickDelay'
    );

    this.assertRange(
      config.scroll.momentumDecay,
      0,
      1,
      'scroll.momentumDecay'
    );

    this.assertRange(
      config.scroll.pauseProbability,
      0,
      1,
      'scroll.pauseProbability'
    );

    this.assertRange(
      config.scroll.backtrackProbability,
      0,
      1,
      'scroll.backtrackProbability'
    );

    this.assertRange(
      config.reading.scrollRatio,
      0,
      1,
      'reading.scrollRatio'
    );
  }

  private static assertDelay(
    value: DelayConfig,
    name: string
  ): void {
    this.assertNonNegative(
      value.min,
      `${name}.min`
    );

    this.assertNonNegative(
      value.max,
      `${name}.max`
    );

    if (value.max < value.min) {
      throw new Error(
        `${name}.max must be >= min`
      );
    }

    this.assertPositive(
      value.mean,
      `${name}.mean`
    );

    this.assertPositive(
      value.sigma,
      `${name}.sigma`
    );
  }

  private static assertRange(
    value: number,
    min: number,
    max: number,
    name: string
  ): void {
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      throw new Error(
        `${name} must be between ${min} and ${max}`
      );
    }
  }

  private static assertPositive(
    value: number,
    name: string
  ): void {
    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      throw new Error(
        `${name} must be > 0`
      );
    }
  }

  private static assertNonNegative(
    value: number,
    name: string
  ): void {
    if (
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new Error(
        `${name} must be >= 0`
      );
    }
  }

  private static assertPositiveInteger(
    value: number,
    name: string
  ): void {
    if (
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new Error(
        `${name} must be a positive integer`
      );
    }
  }
}

/* =========================================================
 * DELAY CALCULATOR
 * ======================================================= */

class DelayCalculator {
  constructor(
    private readonly random: RandomSource
  ) {}

  calculateDelay(
    config: DelayConfig
  ): number {
    const raw =
      this.random.gaussian(
        Math.log(config.mean),
        config.sigma
      );

    let value =
      Math.exp(raw);

    value =
      MathUtils.clamp(
        value,
        config.min,
        config.max
      );

    return Math.round(value);
  }

  calculateMoveDuration(
    distance: number,
    config: DelayConfig
  ): number {
    const sampled =
      this.calculateDelay(
        config
      );

    /*
     * Minimum duration avoids a movement
     * that is unrealistically compressed for
     * a long distance in a test simulation.
     */
    const distanceFloor =
      distance / 3;

    return Math.round(
      MathUtils.clamp(
        Math.max(
          sampled,
          distanceFloor,
          config.min
        ),
        config.min,
        config.max
      )
    );
  }

  calculateReadingTime(
    contentLength: number,
    config: ReadingConfig
  ): number {
    const estimatedWords =
      Math.ceil(
        Math.max(
          0,
          contentLength
        ) / 5
      );

    const msPerWord =
      this.random.range(
        config.msPerWord.min,
        config.msPerWord.max
      );

    const duration =
      estimatedWords *
      msPerWord;

    return Math.round(
      MathUtils.clamp(
        duration,
        config.minDuration,
        config.maxDuration
      )
    );
  }
}

/* =========================================================
 * TRAJECTORY GENERATOR
 * ======================================================= */

class TrajectoryGenerator {
  private readonly noise: PerlinNoise;

  constructor(
    private readonly config: TrajectoryConfig,
    private readonly random: RandomSource,
    seed: number
  ) {
    this.noise =
      new PerlinNoise(seed);
  }

  generate(
    start: Point,
    end: Point
  ): TrajectoryPoint[] {
    if (
      MathUtils.distance(
        start,
        end
      ) < 0.001
    ) {
      return [
        {
          point: end,
          progress: 1,
          speedFactor: 1,
        },
      ];
    }

    const steps =
      Math.max(
        2,
        Math.round(
          this.config.steps
        )
      );

    const controlPoints =
      this.generateControlPoints(
        start,
        end
      );

    const trajectory:
      TrajectoryPoint[] = [];

    for (
      let i = 0;
      i <= steps;
      i++
    ) {
      const progress =
        i / steps;

      const eased =
        MathUtils.easeInOutCubic(
          progress
        );

      let point =
        this.cubicBezier(
          eased,
          controlPoints
        );

      /*
       * Coherent noise.
       *
       * The envelope forces the noise to zero
       * at the beginning and end of the path.
       */
      if (
        this.config.noiseAmplitude > 0
      ) {
        const envelope =
          Math.sin(
            Math.PI *
            progress
          );

        const frequency =
          this.config.noiseFrequency;

        const sample =
          progress /
          frequency;

        const noiseX =
          this.noise.noise(
            sample,
            0.37
          );

        const noiseY =
          this.noise.noise(
            sample,
            7.91
          );

        point = {
          x:
            point.x +
            noiseX *
              this.config
                .noiseAmplitude *
              envelope,

          y:
            point.y +
            noiseY *
              this.config
                .noiseAmplitude *
              envelope,
        };
      }

      /*
       * Guarantee exact endpoints.
       */
      if (i === 0) {
        point = {
          ...start,
        };
      }

      if (i === steps) {
        point = {
          ...end,
        };
      }

      trajectory.push({
        point,
        progress,
        speedFactor:
          this.generateSpeedFactor(
            progress
          ),
      });
    }

    return trajectory;
  }

  private generateSpeedFactor(
    progress: number
  ): number {
    /*
     * Smooth acceleration/deceleration envelope.
     */
    const envelope =
      Math.sin(
        Math.PI *
        progress
      );

    const base =
      0.35 +
      envelope * 0.65;

    const variation =
      this.random.range(
        -this.config
          .speedVariation,
        this.config
          .speedVariation
      );

    return Math.max(
      0.1,
      base + variation
    );
  }

  private generateControlPoints(
    start: Point,
    end: Point
  ): BezierControlPoints {
    const dx =
      end.x - start.x;

    const dy =
      end.y - start.y;

    const distance =
      Math.hypot(
        dx,
        dy
      );

    if (distance < 0.001) {
      return {
        p0: start,
        p1: start,
        p2: end,
        p3: end,
      };
    }

    const angle =
      Math.atan2(
        dy,
        dx
      );

    const perpendicular =
      angle +
      Math.PI / 2;

    const offset1 =
      distance *
      this.config.tension *
      this.random.range(
        0.15,
        0.35
      );

    const offset2 =
      distance *
      this.config.tension *
      this.random.range(
        0.15,
        0.35
      );

    const directionVariation1 =
      this.random.range(
        -0.25,
        0.25
      );

    const directionVariation2 =
      this.random.range(
        -0.25,
        0.25
      );

    return {
      p0: start,

      p1: {
        x:
          start.x +
          dx * 0.3 +
          Math.cos(
            perpendicular +
              directionVariation1
          ) *
            offset1,

        y:
          start.y +
          dy * 0.3 +
          Math.sin(
            perpendicular +
              directionVariation1
          ) *
            offset1,
      },

      p2: {
        x:
          end.x -
          dx * 0.3 +
          Math.cos(
            perpendicular +
              Math.PI +
              directionVariation2
          ) *
            offset2,

        y:
          end.y -
          dy * 0.3 +
          Math.sin(
            perpendicular +
              Math.PI +
              directionVariation2
          ) *
            offset2,
      },

      p3: end,
    };
  }

  private cubicBezier(
    t: number,
    cp: BezierControlPoints
  ): Point {
    const u =
      1 - t;

    const tt =
      t * t;

    const uu =
      u * u;

    const uuu =
      uu * u;

    const ttt =
      tt * t;

    return {
      x:
        uuu * cp.p0.x +
        3 *
          uu *
          t *
          cp.p1.x +
        3 *
          u *
          tt *
          cp.p2.x +
        ttt * cp.p3.x,

      y:
        uuu * cp.p0.y +
        3 *
          uu *
          t *
          cp.p1.y +
        3 *
          u *
          tt *
          cp.p2.y +
        ttt * cp.p3.y,
    };
  }
}

/* =========================================================
 * MOUSE BEHAVIOR
 * ======================================================= */

class MouseBehavior {
  private currentPosition: Point | null =
    null;

  private readonly random: RandomSource;

  private readonly trajectory:
    TrajectoryGenerator;

  private readonly delay:
    DelayCalculator;

  constructor(
    private readonly page: Page,
    private readonly config: ClickConfig,
    private readonly logger: Logger,
    private readonly debug: boolean,
    seed: number
  ) {
    this.random =
      new SeededRandom(seed);

    this.trajectory =
      new TrajectoryGenerator(
        config.trajectory,
        this.random,
        seed
      );

    this.delay =
      new DelayCalculator(
        this.random
      );
  }

  private async getCurrentPosition(): Promise<Point> {
    if (this.currentPosition) {
      return {
        ...this.currentPosition,
      };
    }

    const viewport =
      this.page.viewportSize();

    const position = {
      x:
        (viewport?.width ?? 1280) /
        2,

      y:
        (viewport?.height ?? 720) /
        2,
    };

    this.currentPosition =
      position;

    return {
      ...position,
    };
  }

  private async getElementPosition(
    element: ClickTarget
  ): Promise<Point | null> {
    try {
      const box =
        await element.boundingBox();

      if (!box) {
        return null;
      }

      if (
        box.width <= 0 ||
        box.height <= 0
      ) {
        return null;
      }

      /*
       * Center-biased target selection.
       *
       * For test stability we keep the point
       * inside a safe inner region.
       */
      const offsetX =
        this.random.range(
          box.width * 0.25,
          box.width * 0.75
        );

      const offsetY =
        this.random.range(
          box.height * 0.25,
          box.height * 0.75
        );

      return {
        x:
          box.x +
          offsetX,

        y:
          box.y +
          offsetY,
      };
    } catch {
      return null;
    }
  }

  private applyJitter(
    point: Point
  ): Point {
    if (
      this.config.jitter <= 0
    ) {
      return point;
    }

    return {
      x:
        point.x +
        this.random.gaussian(
          0,
          this.config.jitter
        ),

      y:
        point.y +
        this.random.gaussian(
          0,
          this.config.jitter
        ),
    };
  }

  async moveTo(
    target:
      | Point
      | ClickTarget,
    options?: {
      duration?: number;
      jitter?: boolean;
    }
  ): Promise<void> {
    const start =
      await this.getCurrentPosition();

    let end: Point;

    if (
      'x' in target &&
      'y' in target
    ) {
      end = {
        x: target.x,
        y: target.y,
      };
    } else {
      const position =
        await this.getElementPosition(
          target
        );

      if (!position) {
        throw new Error(
          'Unable to resolve target position.'
        );
      }

      end = position;
    }

    const distance =
      MathUtils.distance(
        start,
        end
      );

    if (distance < 0.001) {
      this.currentPosition =
        end;

      return;
    }

    const duration =
      options?.duration ??
      this.delay.calculateMoveDuration(
        distance,
        this.config.moveDuration
      );

    /*
     * humanLike=false:
     *
     * Use a direct movement through the
     * underlying mouse API.
     */
    const trajectory =
      this.trajectory.generate(
        start,
        end
      );

    const useVariation =
      this.config.trajectory
        .speedVariation > 0;

    /*
     * Calculate inverse speed weights.
     *
     * Higher speedFactor =>
     * less time spent on that segment.
     */
    const weights =
      trajectory.map(
        item =>
          useVariation
            ? 1 /
              Math.max(
                0.1,
                item.speedFactor
              )
            : 1
      );

    const totalWeight =
      weights.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    for (
      let i = 0;
      i < trajectory.length;
      i++
    ) {
      const item =
        trajectory[i];

      const isEndpoint =
        i ===
        trajectory.length - 1;

      let point =
        item.point;

      if (
        options?.jitter !== false &&
        !isEndpoint
      ) {
        point =
          this.applyJitter(
            point
          );
      }

      await this.page.mouse.move(
        point.x,
        point.y
      );

      if (!isEndpoint) {
        const segmentDuration =
          (weights[i] /
            totalWeight) *
          duration;

        await this.page.waitForTimeout(
          Math.max(
            1,
            Math.round(
              segmentDuration
            )
          )
        );
      }
    }

    this.currentPosition = {
      ...end,
    };

    if (this.debug) {
      this.logger.debug(
        `Mouse moved ` +
          `(${Math.round(start.x)},${Math.round(start.y)}) -> ` +
          `(${Math.round(end.x)},${Math.round(end.y)}) ` +
          `distance=${Math.round(distance)}px ` +
          `duration=${duration}ms`
      );
    }
  }

  async hover(
    element: ClickTarget
  ): Promise<void> {
    await this.moveTo(
      element
    );

    const delay =
      this.delay.calculateDelay(
        this.config.hoverDelay
      );

    await this.page.waitForTimeout(
      delay
    );

    if (this.debug) {
      this.logger.debug(
        `Hover delay=${delay}ms`
      );
    }
  }

  async click(
    element: ClickTarget,
    options?: {
      button?:
        | 'left'
        | 'right'
        | 'middle';

      skipHover?: boolean;
    }
  ): Promise<void> {
    if (
      !options?.skipHover
    ) {
      await this.hover(
        element
      );
    }

    const target =
      await this.getElementPosition(
        element
      );

    if (!target) {
      throw new Error(
        'Unable to resolve click target.'
      );
    }

    /*
     * Final approach does not apply jitter.
     * This avoids accidentally leaving the
     * actionable area of small controls.
     */
    await this.moveTo(
      target,
      {
        jitter: false,
      }
    );

    const button =
      options?.button ??
      'left';

    await this.page.mouse.down({
      button,
    });

    /*
     * Configurable click hold duration.
     */
    const holdDuration =
      this.delay.calculateDelay(
        this.config
          .clickHoldDuration
      );

    await this.page.waitForTimeout(
      holdDuration
    );

    await this.page.mouse.up({
      button,
    });

    const postDelay =
      this.delay.calculateDelay(
        this.config
          .postClickDelay
      );

    await this.page.waitForTimeout(
      postDelay
    );

    if (this.debug) {
      this.logger.debug(
        `Click completed ` +
          `button=${button} ` +
          `hold=${holdDuration}ms ` +
          `post=${postDelay}ms`
      );
    }
  }

  async doubleClick(
    element: ClickTarget
  ): Promise<void> {
    await this.hover(
      element
    );

    const interval =
      this.random.range(
        80,
        150
      );

    await this.click(
      element,
      {
        skipHover: true,
      }
    );

    await this.page.waitForTimeout(
      interval
    );

    await this.click(
      element,
      {
        skipHover: true,
      }
    );

    if (this.debug) {
      this.logger.debug(
        `Double click interval=${Math.round(interval)}ms`
      );
    }
  }

  async randomMove(): Promise<void> {
    const viewport =
      this.page.viewportSize() ?? {
        width: 1280,
        height: 720,
      };

    const padding = 50;

    const target: Point = {
      x: this.random.range(
        padding,
        Math.max(
          padding,
          viewport.width -
            padding
        )
      ),

      y: this.random.range(
        padding,
        Math.max(
          padding,
          viewport.height -
            padding
        )
      ),
    };

    await this.moveTo(
      target
    );
  }

  getLastPosition(): Point | null {
    return this.currentPosition
      ? {
          ...this.currentPosition,
        }
      : null;
  }
}

/* =========================================================
 * SCROLL BEHAVIOR
 * ======================================================= */

class ScrollBehavior {
  private readonly random: RandomSource;

  constructor(
    private readonly page: Page,
    private readonly config: ScrollConfig,
    private readonly logger: Logger,
    private readonly debug: boolean,
    seed: number
  ) {
    this.random =
      new SeededRandom(seed);
  }

  async scrollTo(
    targetY: number,
    options?: {
      behavior?:
        | 'smooth'
        | 'auto';
    }
  ): Promise<void> {
    const currentY =
      await this.page.evaluate(
        () => window.scrollY
      );

    const distance =
      targetY - currentY;

    if (
      Math.abs(distance) <
      1
    ) {
      return;
    }

    const direction =
      distance >= 0
        ? 1
        : -1;

    const absDistance =
      Math.abs(distance);

    const steps =
      Math.max(
        1,
        Math.min(
          this.config.steps,
          Math.ceil(
            absDistance / 50
          )
        )
      );

    let velocity =
      this.random.range(
        this.config.speed.min,
        this.config.speed.max
      );

    for (
      let i = 0;
      i < steps;
      i++
    ) {
      const progress =
        (i + 1) /
        steps;

      /*
       * Ease progress while preserving
       * the exact final target.
       */
      const eased =
        MathUtils.easeInOutCubic(
          progress
        );

      const newY =
        currentY +
        distance *
          eased;

      velocity *=
        this.config.momentumDecay;

      const variation =
        this.random.range(
          0.85,
          1.15
        );

      const effectiveSpeed =
        MathUtils.clamp(
          velocity *
            variation,
          this.config.speed.min,
          this.config.speed.max
        );

      await this.page.evaluate(
        (scrollY) => {
          window.scrollTo({
            top: scrollY,
            behavior: 'auto',
          });
        },
        newY
      );

      const stepDelay =
        Math.max(
          1,
          Math.round(
            this.random.range(
              this.config
                .stepDelay.min,
              this.config
                .stepDelay.max
            )
          )
        );

      /*
       * Keep the computed speed relevant
       * without making the final position
       * dependent on timing.
       */
      const speedFactor =
        MathUtils.clamp(
          600 /
            Math.max(
              1,
              effectiveSpeed
            ),
          0.5,
          2
        );

      await this.page.waitForTimeout(
        Math.max(
          1,
          Math.round(
            stepDelay *
              speedFactor
          )
        )
      );

      if (
        i < steps - 1 &&
        this.random.random() <
          this.config
            .pauseProbability
      ) {
        const pause =
          this.random.range(
            this.config
              .pauseDuration.min,
            this.config
              .pauseDuration.max
          ) * 1000;

        if (this.debug) {
          this.logger.debug(
            `Scroll pause=${Math.round(pause)}ms`
          );
        }

        await this.page.waitForTimeout(
          Math.round(pause)
        );

        velocity =
          this.random.range(
            this.config.speed.min,
            this.config.speed.max
          );
      }

      if (
        i > steps / 2 &&
        this.random.random() <
          this.config
            .backtrackProbability
      ) {
        const backtrack =
          this.random.range(
            this.config
              .backtrackDistance.min,
            this.config
              .backtrackDistance.max
          );

        await this.page.evaluate(
          (amount) => {
            window.scrollBy({
              top: -amount,
              behavior: 'auto',
            });
          },
          backtrack
        );

        await this.page.waitForTimeout(
          Math.round(
            this.random.range(
              300,
              900
            )
          )
        );
      }
    }

    /*
     * Correct accumulated floating point
     * and backtrack drift by explicitly
     * setting the requested final position.
     */
    await this.page.evaluate(
      (scrollY) => {
        window.scrollTo({
          top: scrollY,
          behavior: 'auto',
        });
      },
      Math.max(0, targetY)
    );

    if (this.debug) {
      this.logger.debug(
        `Scrolled ${Math.round(currentY)} -> ${Math.round(targetY)}`
      );
    }

    void options;
  }

  async scrollToElement(
    element: ClickTarget,
    options?: {
      offset?: number;
    }
  ): Promise<void> {
    const box =
      await element.boundingBox();

    if (!box) {
      throw new Error(
        'Unable to resolve scroll target.'
      );
    }

    const viewport =
      this.page.viewportSize();

    const viewportHeight =
      viewport?.height ??
      720;

    const currentY =
      await this.page.evaluate(
        () => window.scrollY
      );

    /*
     * boundingBox() is viewport-relative.
     * Convert it to document coordinates.
     */
    const documentY =
      currentY +
      box.y;

    const offset =
      options?.offset ??
      this.random.range(
        100,
        300
      );

    const targetY =
      Math.max(
        0,
        documentY -
          offset -
          viewportHeight * 0.05
      );

    await this.scrollTo(
      targetY
    );
  }

  async scrollToBottom(): Promise<void> {
    const pageHeight =
      await this.page.evaluate(
        () =>
          Math.max(
            document.body
              .scrollHeight,
            document.documentElement
              .scrollHeight
          )
      );

    const viewportHeight =
      await this.page.evaluate(
        () => window.innerHeight
      );

    await this.scrollTo(
      Math.max(
        0,
        pageHeight -
          viewportHeight
      )
    );
  }

  async randomScroll(): Promise<void> {
    const pageHeight =
      await this.page.evaluate(
        () =>
          Math.max(
            document.body
              .scrollHeight,
            document.documentElement
              .scrollHeight
          )
      );

    const viewportHeight =
      await this.page.evaluate(
        () => window.innerHeight
      );

    const maxScroll =
      Math.max(
        0,
        pageHeight -
          viewportHeight
      );

    if (maxScroll <= 0) {
      return;
    }

    const target =
      this.random.range(
        0,
        maxScroll
      );

    await this.scrollTo(
      target
    );
  }
}

/* =========================================================
 * READING BEHAVIOR
 * ======================================================= */

class ReadingBehavior {
  private readonly random: RandomSource;

  private readonly delay:
    DelayCalculator;

  constructor(
    private readonly page: Page,
    private readonly config: ReadingConfig,
    private readonly logger: Logger,
    private readonly debug: boolean,
    seed: number
  ) {
    this.random =
      new SeededRandom(seed);

    this.delay =
      new DelayCalculator(
        this.random
      );
  }

  private async getContentLength(): Promise<number> {
    return this.page.evaluate(
      () =>
        (
          document.body
            ?.innerText ?? ''
        ).trim().length
    );
  }

  private async getImageCount(): Promise<number> {
    return this.page.evaluate(
      () =>
        document.querySelectorAll(
          'img'
        ).length
    );
  }

  async simulateReading(
    options?: {
      scroll?: boolean;
    }
  ): Promise<void> {
    const contentLength =
      await this.getContentLength();

    const imageCount =
      await this.getImageCount();

    const baseDuration =
      this.delay.calculateReadingTime(
        contentLength,
        this.config
      );

    const imageDelayConfig:
      DelayConfig = {
        min:
          this.config.msPerImage.min,

        max:
          this.config.msPerImage.max,

        mean:
          (
            this.config.msPerImage.min +
            this.config.msPerImage.max
          ) / 2,

        sigma: 0.3,
      };

    const imageDuration =
      imageCount *
      this.delay.calculateDelay(
        imageDelayConfig
      );

    const totalDuration =
      Math.min(
        this.config.maxDuration,
        baseDuration +
          imageDuration
      );

    if (this.debug) {
      this.logger.debug(
        `Reading simulation: ` +
          `content=${contentLength} chars, ` +
          `images=${imageCount}, ` +
          `duration=${Math.round(totalDuration)}ms`
      );
    }

    const shouldScroll =
      options?.scroll !== false &&
      this.config.scrollRatio > 0;

    if (!shouldScroll) {
      await this.page.waitForTimeout(
        totalDuration
      );

      return;
    }

    const scrollCount =
      Math.max(
        1,
        Math.floor(
          totalDuration /
            3000
        )
      );

    const interval =
      totalDuration /
      (scrollCount + 1);

    let elapsed = 0;

    for (
      let i = 0;
      i < scrollCount;
      i++
    ) {
      const pause =
        interval +
        this.random.range(
          -interval * 0.15,
          interval * 0.15
        );

      await this.page.waitForTimeout(
        Math.max(
          0,
          pause
        )
      );

      elapsed += pause;

      if (
        elapsed >=
        totalDuration
      ) {
        break;
      }

      const currentY =
        await this.page.evaluate(
          () => window.scrollY
        );

      const viewportHeight =
        await this.page.evaluate(
          () => window.innerHeight
        );

      const pageHeight =
        await this.page.evaluate(
          () =>
            Math.max(
              document.body
                .scrollHeight,
              document.documentElement
                .scrollHeight
            )
        );

      if (
        currentY +
          viewportHeight >=
        pageHeight
      ) {
        break;
      }

      const amount =
        Math.round(
          this.random.range(
            200,
            600
          ) *
            this.config
              .scrollRatio
        );

      await this.page.evaluate(
        (value) => {
          window.scrollBy({
            top: value,
            behavior: 'smooth',
          });
        },
        amount
      );
    }
  }

  async waitForContent(
    selector: string
  ): Promise<void> {
    const element =
      this.page.locator(
        selector
      );

    const text =
      (await element.textContent()) ??
      '';

    const duration =
      this.delay.calculateReadingTime(
        text.length,
        this.config
      );

    if (this.debug) {
      this.logger.debug(
        `Content wait=${duration}ms selector=${selector}`
      );
    }

    await this.page.waitForTimeout(
      duration
    );
  }
}

/* =========================================================
 * CLICK ENGINE
 * ======================================================= */

export class ClickEngine {
  private config:
    ResolvedClickEngineConfig;

  private readonly logger: Logger;

  public readonly mouse: MouseBehavior;

  public readonly scroll: ScrollBehavior;

  public readonly reading: ReadingBehavior;

  constructor(
    private readonly page: Page,
    config?: Partial<ClickEngineConfig>,
    logger?: Logger
  ) {
    this.logger =
      logger ??
      new Logger({} as never);

    this.config = {
      base: {
        humanLike: true,
        debug: false,
        ...config?.base,
      },

      click:
        mergeObjects(
          DEFAULT_CLICK_CONFIG,
          config?.click
        ),

      scroll:
        mergeObjects(
          DEFAULT_SCROLL_CONFIG,
          config?.scroll
        ),

      reading:
        mergeObjects(
          DEFAULT_READING_CONFIG,
          config?.reading
        ),
    };

    ConfigValidator.validate(
      this.config
    );

    const seed =
      this.config.base.seed ??
      Date.now();

    this.mouse =
      new MouseBehavior(
        page,
        this.config.click,
        this.logger,
        this.config.base.debug,
        seed
      );

    this.scroll =
      new ScrollBehavior(
        page,
        this.config.scroll,
        this.logger,
        this.config.base.debug,
        seed + 1
      );

    this.reading =
      new ReadingBehavior(
        page,
        this.config.reading,
        this.logger,
        this.config.base.debug,
        seed + 2
      );
  }

  async fullClickFlow(
    element: ClickTarget,
    options?: {
      scroll?: boolean;
      hover?: boolean;
      postClickWait?: number;
    }
  ): Promise<void> {
    const opts = {
      scroll:
        options?.scroll ??
        true,

      hover:
        options?.hover ??
        true,
    };

    if (opts.scroll) {
      await this.scroll.scrollToElement(
        element,
        {
          offset: 150,
        }
      );
    }

    if (opts.hover) {
      await this.mouse.hover(
        element
      );
    }

    await this.mouse.click(
      element,
      {
        skipHover:
          !opts.hover,
      }
    );

    if (
      options?.postClickWait &&
      options.postClickWait > 0
    ) {
      await this.page.waitForTimeout(
        options.postClickWait
      );
    }
  }

  async serpClick(
    resultElement: ClickTarget,
    options?: {
      readBeforeClick?: boolean;
      readAfterClick?: boolean;
    }
  ): Promise<void> {
    if (
      options?.readBeforeClick
    ) {
      await this.reading.simulateReading(
        {
          scroll: true,
        }
      );
    }

    await this.scroll.scrollToElement(
      resultElement,
      {
        offset: 200,
      }
    );

    await this.mouse.hover(
      resultElement
    );

    /*
     * Evaluation pause before action.
     */
    const evaluationDelay =
      new DelayCalculator(
        new SeededRandom(
          this.config.base.seed
        )
      ).calculateDelay({
        min: 800,
        max: 2500,
        mean: 1500,
        sigma: 0.4,
      });

    await this.page.waitForTimeout(
      evaluationDelay
    );

    await this.mouse.click(
      resultElement,
      {
        skipHover: true,
      }
    );

    if (
      options?.readAfterClick
    ) {
      await this.page.waitForLoadState(
        'domcontentloaded'
      );

      await this.reading.simulateReading(
        {
          scroll: true,
        }
      );
    }
  }

  async randomBehavior(): Promise<void> {
    const random =
      new SeededRandom(
        this.config.base.seed
      );

    const actions = [
      () =>
        this.mouse.randomMove(),

      () =>
        this.scroll.randomScroll(),

      () =>
        this.reading.simulateReading(
          {
            scroll: false,
          }
        ),
    ];

    const count =
      random.integer(
        1,
        3
      );

    for (
      let i = 0;
      i < count;
      i++
    ) {
      const action =
        actions[
          random.integer(
            0,
            actions.length - 1
          )
        ];

      await action();

      await this.page.waitForTimeout(
        Math.round(
          random.range(
            500,
            2500
          )
        )
      );
    }
  }

  updateConfig(
    config: Partial<ClickEngineConfig>
  ): void {
    this.config = {
      base: {
        ...this.config.base,
        ...config.base,
      },

      click:
        mergeObjects(
          this.config.click,
          config.click
        ),

      scroll:
        mergeObjects(
          this.config.scroll,
          config.scroll
        ),

      reading:
        mergeObjects(
          this.config.reading,
          config.reading
        ),
    };

    ConfigValidator.validate(
      this.config
    );
  }

  getConfig(): ResolvedClickEngineConfig {
    return cloneConfig(
      this.config
    );
  }
}

/* =========================================================
 * FACTORY
 * ======================================================= */

const engines =
  new Map<
    string,
    ClickEngine
  >();

export function createClickEngine(
  page: Page,
  name = 'default',
  config?: Partial<ClickEngineConfig>,
  logger?: Logger
): ClickEngine {
  if (
    engines.has(name)
  ) {
    throw new Error(
      `ClickEngine "${name}" already exists.`
    );
  }

  const engine =
    new ClickEngine(
      page,
      config,
      logger
    );

  engines.set(
    name,
    engine
  );

  return engine;
}

export function getClickEngine(
  name = 'default'
): ClickEngine | undefined {
  return engines.get(name);
}

export function removeClickEngine(
  name = 'default'
): boolean {
  return engines.delete(
    name
  );
}

export function clearClickEngines(): void {
  engines.clear();
}

/* =========================================================
 * QUICK HELPER
 * ======================================================= */

export async function humanClick(
  page: Page,
  selector: string,
  options?: {
    seed?: number;
    debug?: boolean;
  }
): Promise<void> {
  const engine =
    new ClickEngine(
      page,
      {
        base: {
          humanLike: true,

          debug:
            options?.debug ??
            false,

          seed:
            options?.seed,
        },
      }
    );

  const element =
    page.locator(
      selector
    );

  await engine.fullClickFlow(
    element
  );
}

export default ClickEngine;
