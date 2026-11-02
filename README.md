# Aurenstar Engine

Small public service that returns planet positions and house cusps using the
[Swiss Ephemeris](https://www.astro.com/swisseph/) compiled to WebAssembly. It runs as a Cloudflare Worker with static assets.
The rest of the Aurenstar website is a separate, private program that calls this service over HTTP.

```
POST /api/positions
{ "utc": "1990-01-26T16:30:00Z", "lat": -23.55, "lon": -46.63, "houseSystem": "P" }
```

Returns `bodies` (sun, moon, planets, nodes, Lilith, Chiron, Ceres: longitude, latitude, distance, speed, sign, retrograde),
`houses` (cusps, ascendant, midheaven) and `status` (0 = all from the ephemeris files). Supported dates: 1300-2390.

## Layout
- `src/worker.ts` – the HTTP endpoint (`wrangler.jsonc` = Cloudflare settings)
- `src/swiss.ts`, `src/wasiLite.ts` – WebAssembly wrapper (minimal WASI layer)
- `src/aurenstar.wasm` – Swiss Ephemeris build
- `public/ephe/*.se1` – ephemeris data files from Astrodienst (1200–2400)

## Run locally
```
npm install
npm run dev     # http://127.0.0.1:8788
npm run deploy  # publishes to Cloudflare
```

## Optional protection
Set the environment variable `ENGINE_KEY` in Cloudflare; callers must then send the same value in the `x-engine-key` header.

## License
GNU AGPL-3.0 (see `LICENSE`), because the Swiss Ephemeris is used under its AGPL option.
The Swiss Ephemeris is © Astrodienst AG.
