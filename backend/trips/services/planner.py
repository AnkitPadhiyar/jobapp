"""
End-to-end trip planner: geocode -> route -> HOS simulation -> daily logs.

This is the single entry point the API layer calls.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from django.utils import timezone

from .geo import geocode
from .hos_engine import (
    DROPOFF_DURATION_HOURS,
    PICKUP_DURATION_HOURS,
    HOSPlanner,
)
from .log_builder import build_daily_logs
from .routing import route

logger = logging.getLogger(__name__)

ASSUMPTIONS = [
    "Property-carrying driver, 70-hour / 8-day cycle, no adverse driving conditions.",
    "11-hour driving limit and 14-hour on-duty window per duty period.",
    "30-minute break required after 8 cumulative hours of driving.",
    "10 consecutive hours off duty resets the 11-hour and 14-hour clocks.",
    "34 consecutive hours off duty restarts the 70-hour / 8-day cycle.",
    "Fueling at least once every 1,000 miles (30-minute on-duty fuel stop).",
    "1 hour on duty (not driving) for pickup and 1 hour for drop-off.",
]


def _round_to_quarter(moment: datetime) -> datetime:
    """Round a naive/local datetime down to the nearest 15 minutes."""
    minute = (moment.minute // 15) * 15
    return moment.replace(minute=minute, second=0, microsecond=0)


def resolve_start_time(value: Optional[datetime] = None) -> datetime:
    """Return a naive local datetime for the trip start."""
    if value is None:
        value = timezone.localtime(timezone.now())
    if timezone.is_aware(value):
        value = timezone.localtime(value)
    naive = value.replace(tzinfo=None)
    return _round_to_quarter(naive)


def plan_trip(
    current_location: str,
    pickup_location: str,
    dropoff_location: str,
    current_cycle_used: float,
    start_time: Optional[datetime] = None,
) -> dict:
    """Run the full planning pipeline and return a JSON-serialisable result."""
    warnings: list[str] = []

    # 1) Geocoding ---------------------------------------------------------
    current = geocode(current_location)
    pickup = geocode(pickup_location)
    dropoff = geocode(dropoff_location)

    # 2) Routing -----------------------------------------------------------
    leg_one = route(current, pickup)
    leg_two = route(pickup, dropoff)
    if leg_one["source"] == "fallback" or leg_two["source"] == "fallback":
        warnings.append(
            "Live road routing was unavailable - straight-line distance estimates were used."
        )

    # Normalise endpoints into a consistent {label, lat, lng} shape.
    def _endpoint(location: dict) -> dict:
        return {"label": location["label"], "lat": location["lat"], "lng": location["lng"]}

    leg_one_drive = {
        "type": "drive",
        "from": _endpoint(current),
        "to": _endpoint(pickup),
        "distance_miles": leg_one["distance_miles"],
        "duration_hours": leg_one["duration_hours"],
        "geometry": leg_one["geometry"],
    }
    leg_two_drive = {
        "type": "drive",
        "from": _endpoint(pickup),
        "to": _endpoint(dropoff),
        "distance_miles": leg_two["distance_miles"],
        "duration_hours": leg_two["duration_hours"],
        "geometry": leg_two["geometry"],
    }

    # 3) Activity list -----------------------------------------------------
    activities = [
        leg_one_drive,
        {"type": "on_duty", "kind": "pickup", "label": f"Pickup - {pickup['label']}",
         "hours": PICKUP_DURATION_HOURS, "location": _endpoint(pickup)},
        leg_two_drive,
        {"type": "on_duty", "kind": "dropoff", "label": f"Drop-off - {dropoff['label']}",
         "hours": DROPOFF_DURATION_HOURS, "location": _endpoint(dropoff)},
    ]

    # 4) Simulate ----------------------------------------------------------
    start = resolve_start_time(start_time)
    planner = HOSPlanner(start_time=start, cycle_used_hours=current_cycle_used)
    planner.plan(activities)
    if planner.violations:
        warnings.extend(planner.violations)

    # 5) Logs + response ---------------------------------------------------
    daily_logs = build_daily_logs(planner.records, {"cycle_used": current_cycle_used})
    combined_geometry = leg_one_drive["geometry"] + leg_two_drive["geometry"][1:]

    return {
        "inputs": {
            "current_location": current_location,
            "pickup_location": pickup_location,
            "dropoff_location": dropoff_location,
            "current_cycle_used": round(float(current_cycle_used), 2),
            "start_time": start.isoformat(timespec="minutes"),
        },
        "locations": {"current": current, "pickup": pickup, "dropoff": dropoff},
        "route": {
            "legs": [
                {"from": leg_one_drive["from"], "to": leg_one_drive["to"],
                 "distance_miles": leg_one["distance_miles"],
                 "duration_hours": leg_one["duration_hours"],
                 "source": leg_one["source"], "geometry": leg_one["geometry"]},
                {"from": leg_two_drive["from"], "to": leg_two_drive["to"],
                 "distance_miles": leg_two["distance_miles"],
                 "duration_hours": leg_two["duration_hours"],
                 "source": leg_two["source"], "geometry": leg_two["geometry"]},
            ],
            "geometry": combined_geometry,
            "total_distance_miles": round(leg_one["distance_miles"] + leg_two["distance_miles"], 2),
            "total_drive_hours": round(leg_one["duration_hours"] + leg_two["duration_hours"], 4),
        },
        "stops": [stop.to_dict() for stop in planner.stops],
        "records": [record.to_dict() for record in planner.records],
        "daily_logs": daily_logs,
        "summary": planner.summary(),
        "assumptions": ASSUMPTIONS,
        "warnings": warnings,
    }
