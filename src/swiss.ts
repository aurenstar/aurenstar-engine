import { createWasiImports } from './wasiLite';

/**
 * Swiss Ephemeris (WebAssembly build, see aurenstar.wasm) wrapper.
 *
 * aur_chart(jd_ut, lat, lon, houseSystem, flags, outPtr, outLen) fills `outLen` doubles:
 *   [0..59]   15 bodies x (longitude, latitude, distance AU, longitude speed deg/day)
 *   [60..72]  house cusps (index 0 unused, 1..12)
 *   [73..82]  ascmc: Asc, MC, ARMC, Vertex, EquAsc, CoAsc(Koch), CoAsc(Munkasey), PolarAsc
 *   [83..97]  per-body return flags, [98..99] house-system status
 */
export const BODY_NAMES = [
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
  'meanNode', 'trueNode', 'lilith', 'chiron', 'ceres',
] as const;
export type BodyName = (typeof BODY_NAMES)[number];

export const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

export interface BodyPosition {
  longitude: number;
  latitude: number;
  distance: number;
  speed: number;
  sign: (typeof SIGNS)[number];
  degreeInSign: number;
  retrograde: boolean;
}

export interface RawChart {
  bodies: Record<BodyName, BodyPosition>;
  houses: { cusps: number[]; ascendant: number; midheaven: number };
  /** 0 = every body from the Swiss Ephemeris files; 2 = some bodies fell back to the built-in (lower precision) model */
  status: number;
}

/** Files the engine needs for a given Julian day (name of every *.se1 file). */
export function ephemerisFilesForJd(jd: number): string[] {
  // 2378496.5 = 1 Jan 1800. The *_18 files cover 1800-2400, the *_12 files cover 1200-1800.
  const suffix = jd >= 2378496.5 ? '18' : '12';
  return [`sepl_${suffix}.se1`, `semo_${suffix}.se1`, `seas_${suffix}.se1`];
}

const signOf = (lon: number) => {
  const l = ((lon % 360) + 360) % 360;
  return { sign: SIGNS[Math.floor(l / 30)], degreeInSign: l % 30 };
};

export class SwissEngine {
  private instance: WebAssembly.Instance;
  private files = new Map<string, Uint8Array>();
  private outLen: number;
  private outPtr: number;

  constructor(module: WebAssembly.Module) {
    let memory: WebAssembly.Memory | undefined;
    const wasi = createWasiImports(() => memory!, this.files);
    this.instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi } as WebAssembly.Imports);
    const exp = this.instance.exports as Record<string, any>;
    memory = exp.memory as WebAssembly.Memory;
    exp._initialize?.();
    const path = new TextEncoder().encode('/ephe\0');
    const pathPtr = exp.aur_alloc(path.length) as number;
    new Uint8Array(memory.buffer).set(path, pathPtr);
    exp.aur_init(pathPtr);
    this.outLen = exp.aur_out_len() as number;
    this.outPtr = exp.aur_alloc(this.outLen * 8) as number;
  }

  /** Registers ephemeris data (call before calculate()). */
  addFile(name: string, data: Uint8Array) {
    this.files.set(name, data);
  }
  hasFile(name: string) {
    return this.files.has(name);
  }

  /** Planet positions + houses for a Julian day (UT) and place. houseSystem: 80='P' Placidus, 87='W' whole sign... */
  calculate(jdUt: number, lat: number, lon: number, houseSystem = 80): RawChart {
    const exp = this.instance.exports as Record<string, any>;
    const status = exp.aur_chart(jdUt, lat, lon, houseSystem, 0, this.outPtr, this.outLen) as number;
    const v = Array.from(new Float64Array((exp.memory as WebAssembly.Memory).buffer, this.outPtr, this.outLen));
    const bodies = {} as Record<BodyName, BodyPosition>;
    BODY_NAMES.forEach((name, i) => {
      const [longitude, latitude, distance, speed] = v.slice(i * 4, i * 4 + 4);
      bodies[name] = { longitude, latitude, distance, speed, ...signOf(longitude), retrograde: speed < 0 };
    });
    return {
      bodies,
      houses: { cusps: v.slice(61, 73), ascendant: v[73], midheaven: v[74] },
      status,
    };
  }
}
