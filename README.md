# ELD Trip Planner — Full-Stack Assessment

Takes trip details as input and outputs **route instructions with all required stops/rests**
plus **filled-out FMCSA Hours-of-Service daily log sheets**.

Built with **Django REST Framework** (backend) + **React / Vite** (frontend), using only
free, key-less map services.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  React (Vite)  ──  trip form · Leaflet map · SVG driver's-daily-log sheets    │
│        │  POST /api/trips/                                                    │
│        ▼                                                                      │
│  Django REST API  ──  trips/serializers.py · views.py                         │
│        │                                                                      │
│        ▼                                                                      │
│  Planning pipeline (trips/services/)                                          │
│    1. geo.py         geocode 3 locations  (Nominatim → Photon → gazetteer)    │
│    2. routing.py     route 2 legs         (OSRM public demo server)           │
│    3. hos_engine.py  simulate the duty clock against 49 CFR §395.3            │
│    4. log_builder.py split duty records into per-day log sheets               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. What it does

**Inputs**

| Field | Notes |
| --- | --- |
| Current location | Free text — city, state or full address |
| Pickup location | Free text |
| Drop-off location | Free text |
| Current cycle used (hrs) | Hours already consumed in the 70-hr / 8-day cycle (0–70) |
| Departure date/time | Optional; used as the start of the duty clock |

**Outputs**

1. **Route map** — OpenStreetMap tiles, the routed road geometry, and a pin for
   every planned stop (pickup, fuel, 30-minute breaks, 10-hour resets, 34-hour restarts,
   drop-off), each with its time window and mile marker.
2. **Route instructions** — an ordered stop/rest timeline plus a trip summary
   (distance, driving time, on-duty time, cycle usage).
3. **Driver's daily log sheets** — one per calendar day, drawn as an SVG grid with the
   four duty-status rows (`Off Duty`, `Sleeper Berth`, `Driving`, `On-Duty (Not Driving)`),
   24 hourly columns with 15-minute subdivisions, the step-line duty graph, per-status
   daily totals, the remarks column, and the 70-hr/8-day recap. Printable to PDF.

**Assumptions applied** (from the assessment brief)

- Property-carrying driver, **70 hours / 8 days**, no adverse driving conditions
- Fuel at least once every **1,000 miles** (30-minute on-duty fuel stop)
- **1 hour** on duty (not driving) for pickup and **1 hour** for drop-off

---

## 2. The Hours-of-Service rules implemented

All rules come from 49 CFR §395.3 (the FMCSA *Drivers Guide to Hours of Service* PDF is
included in this repository).

| Rule | Implementation |
| --- | --- |
| **11-hour driving limit** | After 11 h of driving in a duty period the planner inserts a 10-hour reset. |
| **14-hour on-duty window** | Driving stops at the 14th consecutive hour on duty (off-duty time inside the window does not extend it). |
| **30-minute break** | After 8 cumulative hours of driving, a 30-minute off-duty break is inserted. Any ≥30-min non-driving block (including the fuel stop) satisfies it. |
| **70-hour / 8-day cycle** | The `Current Cycle Used` input seeds the cycle counter; driving and on-duty (not driving) time accumulate against the 70-hour ceiling. |
| **34-hour restart** | When the cycle ceiling is reached, a 34-hour off-duty restart is inserted and the cycle counter resets to 0. |
| **10-hour reset** | Resets the 11-hour, 14-hour and 30-minute clocks. |
| **Fuel every 1,000 miles** | A 30-minute on-duty fuel stop is inserted at each 1,000-mile interval — but only while the truck still needs to keep rolling. |

The engine is a **deterministic, dependency-free simulation** (`trips/services/hos_engine.py`):
it walks the route in the largest chunk the tightest live constraint allows, inserts whatever
interruption that constraint demands, and repeats. See
[`docs/architecture-and-workflow.md`](docs/architecture-and-workflow.md) for a full worked trace.

---

## 3. Repository layout

```
sad/
├── backend/                        # Django + DRF API
│   ├── config/                     # settings, root urls, wsgi/asgi
│   ├── trips/
│   │   ├── models.py               # Trip (inputs + computed result)
│   │   ├── serializers.py          # request validation / response shaping
│   │   ├── views.py                # POST /api/trips/, POST /api/trips/plan/
│   │   ├── urls.py                 # DRF router
│   │   ├── admin.py
│   │   ├── management/commands/plan_trip.py   # CLI: plan a trip without a browser
│   │   ├── services/
│   │   │   ├── geo.py              # geocoding (Nominatim → Photon → offline gazetteer)
│   │   │   ├── routing.py          # routing (OSRM, with great-circle fallback)
│   │   │   ├── hos_engine.py       # ★ the HOS simulation + geometry helpers
│   │   │   ├── log_builder.py      # ★ duty records → per-day log sheets
│   │   │   └── planner.py          # orchestrates the whole pipeline
│   │   └── tests/                  # 22 unit + API tests (fully offline)
│   ├── requirements.txt
│   ├── Procfile · build.sh · runtime.txt
│   └── .env.example
├── frontend/                       # React + Vite
│   ├── src/
│   │   ├── App.jsx                 # layout: sidebar form + workflow tabs + KPI metrics
│   │   ├── api.js                  # API client (plan, suggest, list, get, delete)
│   │   ├── styles.css              # enterprise design system + print layout
│   │   ├── components/
│   │   │   ├── TripForm.jsx        # haul setup, autocomplete, cycle gauge, presets
│   │   │   ├── RouteMap.jsx        # Leaflet map, route polyline, stop pins, filter chips
│   │   │   ├── StopTimeline.jsx    # ordered stops & rests, mile markers, map sync
│   │   │   ├── LogBook.jsx         # multi-day tabs, pager, batch print
│   │   │   ├── EldLogSheet.jsx     # ★ SVG driver's daily log, hover inspector, signature
│   │   │   ├── ComplianceAudit.jsx # 7 FMCSA HOS rules verification & metrics
│   │   │   ├── TripHistory.jsx     # saved trips drawer, load/delete hauls
│   │   │   └── DispatchManifestModal.jsx # dispatch manifest copy & JSON export
│   │   └── utils/format.js         # formatters, status palette, manifest builder
│   ├── vercel.json · .env.example
│   └── package.json
├── docs/architecture-and-workflow.md
└── README.md
```

---

## 4. Running it locally

### Backend (Django)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate        # macOS / Linux

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

The API is then at <http://127.0.0.1:8000/api/>.

### Frontend (React)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`, so there is no CORS setup
to do in development.

### Tests

```bash
cd backend
python manage.py test trips -v 2
```

22 tests cover the HOS engine (11-hr limit, 30-min break, fuel interval, 34-hr restart,
midnight splitting, recap maths) and the API (create, dry-run, validation, geocoding
failure, list/detail). They run fully offline — the external services are patched.

---

## 5. API reference

### `POST /api/trips/` — plan and save a trip

```bash
curl -X POST http://127.0.0.1:8000/api/trips/ \
  -H "Content-Type: application/json" \
  -d '{
        "current_location": "Los Angeles, CA",
        "pickup_location": "Phoenix, AZ",
        "dropoff_location": "Dallas, TX",
        "current_cycle_used": 20,
        "start_time": "2026-01-05T06:00:00"
      }'
```

Response (abridged):

```jsonc
{
  "id": 1,
  "locations": { "current": { "lat": 34.05, "lng": -118.24 }, "pickup": {}, "dropoff": {} },
  "route": {
    "legs": [ { "from": {}, "to": {}, "distance_miles": 372.63, "duration_hours": 6.70,
                "geometry": [[lat, lng], "..."] } ],
    "geometry": [[lat, lng], "..."],
    "total_distance_miles": 1438.02,
    "total_drive_hours": 24.85
  },
  "stops": [
    { "kind": "pickup", "label": "Pickup - Phoenix, AZ", "start": "2026-01-05T12:42",
      "hours": 1.0, "miles_from_origin": 372.63, "lat": 33.44, "lng": -112.07 }
  ],
  "daily_logs": [
    {
      "date": "2026-01-05", "day_index": 1,
      "segments": [ { "status": "driving", "start_hour": 6.0, "end_hour": 10.3 } ],
      "totals": { "driving": 4.3, "off_duty": 0.5, "sleeper": 10.0, "on_duty": 1.0 },
      "remarks": [ { "time": "06:00", "text": "Driving: ..." } ],
      "recap": { "on_duty_today": 5.3, "total_last_8_days": 25.3, "available_tomorrow": 44.7 }
    }
  ],
  "summary": { "total_miles": 1438.02, "driving_hours": 24.85, "sleeper_hours": 20.0,
               "cycle_hours_used": 47.35 },
  "assumptions": ["..."],
  "warnings": []
}
```

| Endpoint | Purpose |
| --- | --- |
| `POST /api/trips/` | Plan **and persist** a trip |
| `POST /api/trips/plan/` | Plan only (dry run, nothing saved) |
| `GET /api/trips/` | Recent trips (lightweight list) |
| `GET /api/trips/{id}/` | Stored trip incl. the full result |
| `GET /api/health/` | Health probe |
| `GET /admin/` | Django admin (create a superuser to log in) |

### CLI

```bash
cd backend
python manage.py plan_trip "Los Angeles, CA" "Phoenix, AZ" "Dallas, TX" --cycle-used 20
```

Prints the legs, every planned stop, each day's log segments and the summary.
Add `--json` for the raw payload.

---

## 6. Deployment

The app is designed to deploy as two pieces: **static frontend on Vercel**, **Django API on a
container host**. Both free tiers are enough for a demo.

### Frontend → Vercel

`frontend/vercel.json` is already configured (framework `vite`, output `dist`, SPA rewrite).

```bash
cd frontend
npx vercel --prod
```

Set the environment variable **`VITE_API_BASE_URL`** to the deployed API origin
(e.g. `https://eld-trip-planner-api.onrender.com`). Because it is read at build time, redeploy
after changing it.

### Backend → Render / Railway (or any Docker host)

`backend/Procfile` and `backend/build.sh` are ready to use.

- **Build:** `./build.sh`
- **Start:** `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
- **Environment:** `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`,
  `DJANGO_ALLOWED_HOSTS=<your-host>`, `CORS_ALLOWED_ORIGINS=https://<your-vercel-app>.vercel.app`
- Add a **persistent disk** (e.g. mounted at `/data`) and set `SQLITE_PATH=/data/db.sqlite3`
  if you want planned trips to survive restarts. The API itself is stateless — the database
  only stores a history of planned trips.

> Note: Vercel's serverless functions are a poor fit for Django + SQLite here, so the backend
> ships with a Procfile/Docker-friendly layout instead. The frontend is the piece that lives
> on Vercel, exactly as the brief asks.

---

## 7. Design notes & trade-offs

- **Which geocoder/routing provider?** Nominatim + Photon for geocoding and the public OSRM
  demo server for routing — all free and key-less as the brief requires. Nominatim's public
  server rejects generic-looking `User-Agent` strings, so a descriptive one is set by default
  in `settings.py`, and Photon is used as a second live provider. A small offline gazetteer of
  US cities is the last resort so a demo never hard-fails without a network.
- **Which map tiles?** OpenStreetMap raster tiles via Leaflet, with no API key and no billing.
- **Speed model.** No traffic data is used (out of scope for HOS): each leg's OSRM duration
  gives the average speed, and stops are interpolated along the returned road geometry.
- **Sleeper berth vs off duty.** The 10-hour reset is logged as **Sleeper Berth** (typical for
  a property-carrying driver sleeping in the cab), the 30-minute break as **Off Duty**, and the
  34-hour restart as **Off Duty**. These are constants at the top of `hos_engine.py`.
- **Split sleeper-berth (7/3) provision is intentionally not modelled** — the brief specifies
  plain 70-hr/8-day operation without adverse conditions.
- **Recap maths.** The "A / B / C" recap on each sheet uses the trip's own daily on-duty totals
  plus the supplied `current_cycle_used`, which is the information the API actually receives.
