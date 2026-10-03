# End-to-End Workflow

This document walks through exactly what happens between a user typing three locations
and a set of drawn daily log sheets appearing on screen.

---

## 0. High-level flow

```
 USER
  │  current / pickup / drop-off / cycle-used / departure time
  ▼
┌───────────────────────────── React (frontend) ──────────────────────────────┐
│ TripForm.jsx  ── validates locally (non-empty, 0 ≤ cycle ≤ 70)             │
│               ── POST /api/trips/                                          │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       ▼
┌───────────────────────────── Django REST API ───────────────────────────────┐
│ TripRequestSerializer  ── re-validates + coerces types                    │
│ TripViewSet.create()   ── calls plan_trip(...)                             │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       ▼
┌─────────────────────── trips/services/planner.py ──────────────────────────┐
│ 1  geocode(current)    geocode(pickup)    geocode(dropoff)                 │
│ 2  route(current → pickup)      route(pickup → dropoff)                    │
│ 3  build the activity list (drive, pickup 1h, drive, drop-off 1h)          │
│ 4  HOSPlanner.plan(activities)   ← the duty-clock simulation               │
│ 5  build_daily_logs(records)     ← one sheet per calendar day              │
│ 6  assemble the JSON response                                              │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       ▼
┌───────────────────────────── React (frontend) ──────────────────────────────┐
│ RouteMap.jsx    Leaflet map + route polyline + stop pins                   │
│ StopTimeline.jsx  ordered stops & rests                                    │
│ LogBook.jsx → EldLogSheet.jsx   SVG driver's daily log per day             │
│ Print → PDF                                                                │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Input validation (two layers)

The same rules are enforced in both layers so the API is safe to call directly:

| Rule | Where |
| --- | --- |
| Locations are non-empty strings (≤ 255 chars, trimmed) | `TripForm.jsx` + `TripRequestSerializer` |
| `current_cycle_used` is between 0 and 70 | `TripForm.jsx` + serializer `validate_current_cycle_used` |
| `start_time` is a valid ISO-8601 datetime (or omitted → "now") | `TripRequestSerializer` + `resolve_start_time` |

`resolve_start_time()` normalises everything to a **naive local datetime rounded down to the
nearest 15 minutes**, which is what gets printed on the log grid.

---

## 2. Geocoding — three providers, in order

`trips/services/geo.py :: geocode(query)`

| Order | Provider | Endpoint | Why |
| --- | --- | --- | --- |
| 1 | **Nominatim** | `nominatim.openstreetmap.org/search` | Best quality for "City, State" / full US addresses |
| 2 | **Photon** | `photon.komoot.io/api/` | Independent OSM geocoder; used when Nominatim 403s/rate-limits. US hits are preferred because the HOS rules here are US-specific |
| 3 | **Offline gazetteer** | in-module dict of ~45 US cities | Last resort so a live demo never hard-fails without a network |

Every provider returns the same shape:

```json
{ "label": "Chicago, IL", "display_name": "Chicago, Cook County, Illinois, United States",
  "lat": 41.8781, "lng": -87.6298, "source": "nominatim" }
```

`source` is surfaced to the user so results are never silently faked.
If all three fail, a `GeocodingError` propagates and the API returns **400** with
`{"error": "geocoding_failed"}`.

---

## 3. Routing

`trips/services/routing.py :: route(origin, destination)`

Two separate OSRM calls are made — `current → pickup` and `pickup → dropoff` — so each leg
keeps its own geometry and metrics:

```
GET https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}
      ?overview=full&geometries=geojson&steps=false
```

- `distance` (metres) → **miles**
- `duration` (seconds) → **hours**  → this also gives the leg's average speed, used to place
  mid-leg stops at the right mile marker
- `geometry.coordinates` (GeoJSON `[lon, lat]`) → flipped to `[[lat, lng], ...]` for Leaflet

If OSRM is unreachable the leg falls back to a great-circle estimate × 1.2 for road detour at
55 mph, and a warning is added to the response (`warnings[]`) so the UI can flag it.

---

## 4. The activity list

The planner turns the two legs plus the assessment's two 1-hour service stops into an ordered
list of activities (`planner.py`):

```python
activities = [
    { "type": "drive",   "from": current, "to": pickup,  "distance_miles": ..., "duration_hours": ..., "geometry": [...] },
    { "type": "on_duty", "kind": "pickup",  "label": "Pickup - <pickup>",   "hours": 1.0, "location": ... },
    { "type": "drive",   "from": pickup,  "to": dropoff, "distance_miles": ..., "duration_hours": ..., "geometry": [...] },
    { "type": "on_duty", "kind": "dropoff", "label": "Drop-off - <dropoff>", "hours": 1.0, "location": ... },
]
```

---

## 5. The HOS simulation — the core algorithm

`trips/services/hos_engine.py :: HOSPlanner`

### 5.1 Live state kept while simulating

| Variable | Meaning |
| --- | --- |
| `clock` | Current wall-clock time |
| `shift_start` | When the current duty period began (set at start + after each 10-h reset) |
| `drive_this_shift` | Driving hours in this duty period (11-hr rule) |
| `drive_since_break` | Driving hours since the last ≥30-min non-driving block (8-hr rule) |
| `cycle_used` | Hours used in the 70-hr / 8-day cycle (seeded from the input) |
| `miles_since_fuel` | Miles since the last fuel stop (1,000-mile rule) |
| `records[]` / `stops[]` | The emitted duty records and the map markers |

### 5.2 One driving leg, step by step

For each leg the engine takes the **largest chunk the tightest live constraint allows**:

```
while miles_left > 0:
    # 0. hard limits — take the required rest first, then retry
    if cycle_used                  >= 70        : take 34-h restart ; continue
    if drive_this_shift            >= 11        : take 10-h reset   ; continue
    if clock - shift_start         >= 14        : take 10-h reset   ; continue
    if drive_since_break           >= 8         : take 30-min break; continue

    # 1. how far can we go before *something* forces a stop?
    chunk = min( miles_left,
                 (11 - drive_this_shift)        hours,   # 11-hr driving limit
                 (14 - elapsed_in_shift)        hours,   # 14-hr window
                 (8  - drive_since_break)       hours,   # 30-min break rule
                 (70 - cycle_used)              hours,   # 70-hr/8-day cycle
                 (1000 - miles_since_fuel) / speed )     # 1,000-mile fuel rule

    # 2. log the driving and advance every counter
    emit(DRIVING, chunk)
    miles_left -= chunk_miles ; miles_covered += chunk_miles

    # 3. refuel only if the truck still has road ahead of it
    if miles_since_fuel >= 1000 and miles_left > 1:
        emit(ON_DUTY 0.5h) ; miles_since_fuel = 0
```

### 5.3 What each forced stop emits

| Trigger | Duty status emitted | Duration | Also resets |
| --- | --- | --- | --- |
| 8 h driving since a break | `Off Duty` | 0.5 h | `drive_since_break` |
| 11 h driving **or** 14 h window | `Sleeper Berth` | 10 h | 11 h, 14 h, 30-min clocks |
| 70 h cycle reached | `Off Duty` | 34 h | cycle counter → 0, plus all shift clocks |
| 1,000 miles | `On Duty (Not Driving)` | 0.5 h | `miles_since_fuel` (and the 30-min clock, since ≥30 min non-driving) |
| Pickup / drop-off activity | `On Duty (Not Driving)` | 1 h (configurable) | 30-min clock |

### 5.4 Where mid-leg stops land on the map

A forced stop happens at an *arbitrary* point in the middle of a leg, so its coordinates are
interpolated from the road geometry:

```
RouteGeometry(leg.geometry, total_miles)
  ├─ cumulative[] = haversine distance at every vertex
  ├─ rescale: geometry length → the provider's reported leg distance
  └─ point_at(miles) → binary search the segment, linearly interpolate lat/lng
```

That is how a fuel stop can be reported at **exactly mile 1,000.0** with a real coordinate on
the road.

### 5.5 Worked trace — Los Angeles → Phoenix → Dallas, cycle already 20 h

Leg 1: LA → Phoenix, **372.63 mi / 6.70 h** (≈55.6 mph). Leg 2: Phoenix → Dallas,
**1,065.39 mi / 18.15 h** (≈58.7 mph). Start 06:00.

| Clock | Action | Why |
| --- | --- | --- |
| 06:00–12:42 | Drive 372.6 mi (6.70 h) | Leg 1 fits inside every limit |
| 12:42–13:42 | **Pickup**, On-Duty 1 h | 1-hour service stop; also clears the 30-min clock |
| 13:42–18:00 | Drive 4.30 h (252.4 mi) → odometer mile 625.0 | Hits `drive_this_shift = 11.0` |
| 18:00–04:00 | **Sleeper Berth 10 h** | 11-hour driving limit reset |
| 04:00–10:23 | Drive 6.39 h (375.0 mi) → mile 1,000.0 | 1,000-mile fuel rule |
| 10:23–10:53 | **Fuel stop**, On-Duty 0.5 h | Fuel + satisfies the 30-min break |
| 10:53–15:30 | Drive 4.61 h (270.6 mi) → mile 1,270.6 | `drive_this_shift = 11.0` again |
| 15:30–01:30 | **Sleeper Berth 10 h** | 11-hour driving limit reset |
| 01:30–04:21 | Drive 2.85 h (167.4 mi) → mile 1,438.0 | Arrive |
| 04:21–05:21 | **Drop-off**, On-Duty 1 h | 1-hour service stop |

Result: **1,438.02 mi**, 24.85 h driving, 2.5 h on-duty (not driving), 20 h sleeper,
cycle `20 → 47.35 / 70`, spread across **3 daily log sheets**.

Reproduce it with:

```bash
cd backend
python manage.py plan_trip "Los Angeles, CA" "Phoenix, AZ" "Dallas, TX" --cycle-used 20
```

---

## 6. Duty records → daily log sheets

`trips/services/log_builder.py :: build_daily_logs(records, trip_meta)`

The simulator emits one flat, **contiguous** list of `DutyRecord`s. The log builder fans it out
into calendar days:

```
pass 1 — for each midnight→midnight window that the trip touches:
    for each record that overlaps the window:
        clip it to the window                       (a 22:00→02:00 drive becomes two segments)
        prorate its miles by the clipped fraction   (so daily mile totals still add up)
        accumulate the per-status totals
        emit a "remark" for every status change (the first block of the day always gets one)
    store: segments[], remarks[], totals{}, miles_driving_today, total_mileage_today

pass 2 — attach the 70-hour / 8-day recap to each day:
    A = on-duty hours that day
    B = on-duty hours in the previous 7 stored days
    C = A + B
    available tomorrow = 70 − (current_cycle_used + C)
```

Each segment carries **`start_hour` / `end_hour` as decimal hours since midnight (0–24)**,
which is exactly what the SVG renderer needs to place the step line.

---

## 7. Frontend rendering

### 7.1 The map — `RouteMap.jsx`

- `MapContainer` + OSM raster tiles (`TileLayer`), no API key
- one `Polyline` per leg (alternate colours) built from `route.legs[i].geometry`
- circular `L.divIcon` pins (emoji in a coloured ring) for the start, pickup, drop-off and
  each intermediate stop — this avoids Leaflet's missing marker-image assets entirely
- `FitBounds` re-fits the viewport every time a new route arrives

### 7.2 The daily log sheet — `EldLogSheet.jsx`

The grid is one responsive SVG (`viewBox`, `preserveAspectRatio`) so it scales and prints
crisply:

```
TOP_LABEL_H = 26      hour numbers ("Mid · 1 · 2 … Noon … Mid")
PAD_LEFT    = 190     status row labels + per-status daily totals
HOUR_W      = 34      24 columns  → GRID_W = 816
ROW_H       = 46      4 status rows → GRID_H = 184
```

Rendering order: white background → hour labels → quarter-hour ticks → alternating row bands →
hour grid lines (heavier every 6 h) → row separators → row labels & totals → **the duty step
path** (a white halo stroke under a dark stroke, so it reads over the grid) → the noon marker.

The step path is built directly from the segments — horizontal run per segment at that
status's row, with a vertical drop between consecutive segments:

```js
segments.forEach((s, i) => {
  const y  = rowCenter(s.status)      // off_duty | sleeper | driving | on_duty
  parts.push(`${i === 0 ? 'M' : 'L'} ${xAt(s.start_hour)} ${y}`)
  parts.push(`L ${xAt(s.end_hour)} ${y}`)
})
```

Below the grid: the **Remarks** column (time + description of every status change) and the
**Recap** table (A / B / C + available tomorrow).

### 7.3 Multi-day handling — `LogBook.jsx`

One sheet per day, exposed as tabs ("Day 1 · Sat, Oct 3, 2026"). `@media print` overrides the
tab visibility so **Print all logs** produces one page per day, landscape — a shortcut to the
PDF a dispatcher would actually keep.

---

## 8. Data contract (frontend ⇄ backend)

```
POST /api/trips/                      → 201  { id, inputs, locations, route, stops,
                                              records, daily_logs, summary,
                                              assumptions, warnings }
POST /api/trips/plan/                 → 200  same body, id = null, nothing persisted
GET  /api/trips/                      → 200  [ { id, locations…, total_distance_miles, log_days, created_at } ]
GET  /api/trips/{id}/                 → 200  { id, …, result: { …full payload… } }
GET  /api/health/                     → 200  { status: "ok" }

400 → { "error": "geocoding_failed", "detail": "Could not geocode '…'" }
400 → { "field": ["message"] }        (DRF field validation errors)
```

---

## 9. How to verify the whole chain

```bash
# 1. backend unit + API tests (offline, ~20 tests)
cd backend && python manage.py test trips -v 2

# 2. live end-to-end check without a browser
python manage.py plan_trip "Los Angeles, CA" "Phoenix, AZ" "Dallas, TX" --cycle-used 20

# 3. run both halves and use the UI
python manage.py runserver 8000            # terminal 1
cd ../frontend && npm run dev              # terminal 2 → http://localhost:5173

# 4. production build check
cd frontend && npm run build
```

Expected checkpoints for the LA → Phoenix → Dallas example:

- route ≈ **1,438 mi** across **2 legs** with 7,000+ geometry points
- stops: `pickup`, `10-hour reset` (~mile 625), `fuel` (exactly mile 1,000),
  `10-hour reset` (~mile 1,271), `drop-off`
- **3** daily log sheets; every interior sheet totals exactly 24.0 h
- summary: 24.85 h driving, 2.5 h on duty (not driving), 20 h sleeper, cycle 47.35 / 70
