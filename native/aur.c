/*
 * Aurenstar wrapper around the Swiss Ephemeris (Astrodienst AG, AGPL-3.0).
 * Compiled to WebAssembly (WASI reactor). Exposes a tiny API used by ../src/swiss.ts.
 *
 * aur_chart(jd_ut, lat, lon, house_system, flags, out, out_len) fills `out` (doubles):
 *   [0..59]   15 bodies x (longitude, latitude, distance AU, longitude speed deg/day)
 *   [60..72]  house cusps (index 0 unused, 1..12)
 *   [73..82]  ascmc: Asc, MC, ARMC, Vertex, EquAsc, CoAsc(Koch), CoAsc(Munkasey), PolarAsc, ...
 *   [83..97]  per-body return flags from swe_calc_ut
 *   [98..99]  house calculation status ([98] = return value of swe_houses, [99] = 0)
 * Return value: 0 = every body came from the Swiss Ephemeris files, 2 = at least one body fell
 * back to the built-in (lower precision) Moshier model, -1 = a body could not be computed.
 */
#include <stdlib.h>
#include <string.h>
#include "swephexp.h"

#define EXPORT(n) __attribute__((export_name(n)))
#define NBODIES 15
#define OUT_LEN 100

static const int BODY_IDS[NBODIES] = {
  SE_SUN, SE_MOON, SE_MERCURY, SE_VENUS, SE_MARS, SE_JUPITER, SE_SATURN, SE_URANUS, SE_NEPTUNE, SE_PLUTO,
  SE_MEAN_NODE, SE_TRUE_NODE, SE_MEAN_APOG, SE_CHIRON, SE_CERES
};

EXPORT("aur_alloc") void *aur_alloc(int n) { return malloc((size_t)n); }
EXPORT("aur_free") void aur_free(void *p) { free(p); }
EXPORT("aur_out_len") int aur_out_len(void) { return OUT_LEN; }
EXPORT("aur_nbodies") int aur_nbodies(void) { return NBODIES; }
EXPORT("aur_body_id") int aur_body_id(int i) { return (i >= 0 && i < NBODIES) ? BODY_IDS[i] : -1; }

EXPORT("aur_init") void aur_init(const char *ephe_path) { swe_set_ephe_path((char *)ephe_path); }

EXPORT("aur_chart")
int aur_chart(double jd_ut, double lat, double lon, int house_system, int flags, double *out, int out_len)
{
  char serr[AS_MAXCH];
  double xx[6], cusps[13], ascmc[10];
  int status = 0, i;
  int iflag = flags ? flags : (SEFLG_SWIEPH | SEFLG_SPEED);

  if (out_len < OUT_LEN) return -1;
  memset(out, 0, sizeof(double) * OUT_LEN);

  for (i = 0; i < NBODIES; i++) {
    int r = swe_calc_ut(jd_ut, BODY_IDS[i], iflag, xx, serr);
    if (r < 0) { out[83 + i] = (double)r; status = -1; continue; }
    out[i * 4 + 0] = xx[0];
    out[i * 4 + 1] = xx[1];
    out[i * 4 + 2] = xx[2];
    out[i * 4 + 3] = xx[3];
    out[83 + i] = (double)r;
    if ((r & SEFLG_MOSEPH) && !(iflag & SEFLG_MOSEPH) && status == 0) status = 2;
  }

  memset(cusps, 0, sizeof(cusps));
  memset(ascmc, 0, sizeof(ascmc));
  out[98] = (double)swe_houses(jd_ut, lat, lon, house_system, cusps, ascmc);
  for (i = 0; i <= 12; i++) out[60 + i] = cusps[i];
  for (i = 0; i < 10; i++) out[73 + i] = ascmc[i];
  return status;
}
