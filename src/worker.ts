// Aurenstar Engine (Cloudflare Worker): POST /api/positions
//   { "utc": "1990-01-26T16:30:00Z", "lat": -23.55, "lon": -46.63, "houseSystem": "P" }
// Returns planet positions and house cusps from the Swiss Ephemeris (see LICENSE: AGPL-3.0).
// Source code of this service: https://github.com/aurenstar/aurenstar-engine
import swissWasm from './aurenstar.wasm';
import { SwissEngine, ephemerisFilesForJd } from './swiss';

interface Env {
  ASSETS: { fetch(input: Request | string | URL): Promise<Response> };
  ENGINE_KEY?: string; // optional: when set, callers must send the same value in the "x-engine-key" header
}

const SOURCE = 'https://github.com/aurenstar/aurenstar-engine';
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Source-Code': SOURCE },
  });

let engine: SwissEngine | undefined;
const getEngine = () => (engine ??= new SwissEngine(swissWasm));

async function positions(request: Request, env: Env): Promise<Response> {
  if (env.ENGINE_KEY && request.headers.get('x-engine-key') !== env.ENGINE_KEY) return json({ error: 'unauthorized' }, 401);

  let body: { utc?: string; lat?: number; lon?: number; houseSystem?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send JSON: { "utc": "ISO time", "lat": number, "lon": number }' }, 400);
  }
  const ms = Date.parse(body.utc ?? '');
  const lat = Number(body.lat ?? 0);
  const lon = Number(body.lon ?? 0);
  if (!Number.isFinite(ms)) return json({ error: 'utc must be an ISO date-time, e.g. 1990-01-26T16:30:00Z' }, 400);
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return json({ error: 'lat/lon out of range' }, 400);
  const year = new Date(ms).getUTCFullYear();
  if (year < 1300 || year > 2390) return json({ error: 'date out of supported range (1300-2390)' }, 400);
  const house = (body.houseSystem || 'P').toUpperCase().charCodeAt(0);

  const jd = ms / 86400000 + 2440587.5;
  try {
    const eng = getEngine();
    for (const name of ephemerisFilesForJd(jd)) {
      if (eng.hasFile(name)) continue;
      const res = await env.ASSETS.fetch(new URL(`/ephe/${name}`, request.url));
      if (!res.ok) throw new Error(`Ephemeris file ${name} unavailable (${res.status})`);
      eng.addFile(name, new Uint8Array(await res.arrayBuffer()));
    }
    return json({ julianDayUt: +jd.toFixed(6), source: SOURCE, ...eng.calculate(jd, lat, lon, house) });
  } catch (error) {
    console.error('engine error', error);
    return json({ error: 'Calculation is temporarily unavailable.' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/positions') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return positions(request, env);
    }
    return env.ASSETS.fetch(request); // home page and ephemeris files
  },
};
