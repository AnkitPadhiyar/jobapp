"""
Hours-of-Service (HOS) planning engine.

Deterministic, dependency-free simulation of a property-carrying driver's duty
day per FMCSA 49 CFR Part 395.3 (see the FMCSA "Drivers Guide to Hours of
Service" PDF that ships with this repository).

Rules implemented
-----------------
* 11-hour driving limit       - no driving after 11h driving in a duty period
* 14-hour duty window         - no driving after the 14th consecutive hour on duty
* 30-minute break             - required after 8 cumulative hours of driving
* 70-hour / 8-day cycle limit - no driving after 70h on duty in 8 consecutive days
* 34-hour cycle restart       - resets the 70-hour cycle
* 10-hour reset               - resets the shift (11h / 14h / 30-min clocks)

Assessment assumptions
----------------------
* Property-carrying driver, 70 hrs / 8 days, no adverse driving conditions
* Fueling at least once every 1,000 miles
* 1 hour on duty (not driving) for pickup and 1 hour for drop-off
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

# --------------------------------------------------------------------------
# HOS constants
# --------------------------------------------------------------------------
MAX_DRIVE_PER_SHIFT_HOURS = 11.0
MAX_DUTY_WINDOW_HOURS = 14.0
BREAK_AFTER_DRIVE_HOURS = 8.0
BREAK_DURATION_HOURS = 0.5
FULL_RESET_HOURS = 10.0
CYCLE_LIMIT_HOURS = 70.0
CYCLE_RESTART_HOURS = 34.0
FUEL_INTERVAL_MILES = 1000.0
FUEL_DURATION_HOURS = 0.5
PICKUP_DURATION_HOURS = 1.0
DROPOFF_DURATION_HOURS = 1.0
DEFAULT_SPEED_MPH = 55.0

# Duty status codes (also the row order on a driver's daily log, top -> bottom)
OFF_DUTY = "off_duty"
SLEEPER = "sleeper"
DRIVING = "driving"
ON_DUTY = "on_duty"

DUTY_STATUSES = [OFF_DUTY, SLEEPER, DRIVING, ON_DUTY]
STATUS_LABELS: Dict[str, str] = {
    OFF_DUTY: "Off Duty",
    SLEEPER: "Sleeper Berth",
    DRIVING: "Driving",
    ON_DUTY: "On-Duty (Not Driving)",
}
STATUS_ROW_INDEX: Dict[str, int] = {status: i for i, status in enumerate(DUTY_STATUSES)}

SECONDS_PER_HOUR = 3600.0
EPSILON = 1e-6


# --------------------------------------------------------------------------
# Data containers
# --------------------------------------------------------------------------
@dataclass
class DutyRecord:
    """A single, continuous block of time in one duty status."""

    status: str
    start: datetime
    end: datetime
    location: str = ""
    note: str = ""
    miles: float = 0.0
    lat: Optional[float] = None
    lng: Optional[float] = None

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / SECONDS_PER_HOUR

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "status_label": STATUS_LABELS[self.status],
            "start": self.start.isoformat(timespec="minutes"),
            "end": self.end.isoformat(timespec="minutes"),
            "hours": round(self.hours, 4),
            "location": self.location,
            "note": self.note,
            "miles": round(self.miles, 2),
            "lat": self.lat,
            "lng": self.lng,
        }


@dataclass
class Stop:
    """A derived event shown on the map (pickup, fuel, break, rest, ...)."""

    kind: str
    label: str
    start: datetime
    end: datetime
    lat: Optional[float] = None
    lng: Optional[float] = None
    miles_from_origin: float = 0.0

    @property
    def hours(self) -> float:
        return (self.end - self.start).total_seconds() / SECONDS_PER_HOUR

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "label": self.label,
            "start": self.start.isoformat(timespec="minutes"),
            "end": self.end.isoformat(timespec="minutes"),
            "hours": round(self.hours, 4),
            "lat": self.lat,
            "lng": self.lng,
            "miles_from_origin": round(self.miles_from_origin, 2),
        }


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------
def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in statute miles."""
    radius_miles = 3958.7613
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_miles * math.asin(min(1.0, math.sqrt(a)))


def geometry_cumulative_miles(geometry: Sequence[Sequence[float]]) -> List[float]:
    """Cumulative distance (miles) at each vertex of a [(lat, lng), ...] line."""
    cumulative = [0.0]
    for (lat1, lng1), (lat2, lng2) in zip(geometry, geometry[1:]):
        cumulative.append(cumulative[-1] + haversine_miles(lat1, lng1, lat2, lng2))
    return cumulative


class RouteGeometry:
    """Interpolates a (lat, lng) position at any distance along a route line."""

    def __init__(self, geometry: Sequence[Sequence[float]], total_miles: Optional[float] = None):
        self.geometry: List[Tuple[float, float]] = [(float(p[0]), float(p[1])) for p in geometry]
        if len(self.geometry) > 1:
            self.cumulative = geometry_cumulative_miles(self.geometry)
        else:
            self.cumulative = [0.0, 0.0]
            if len(self.geometry) == 1:
                self.geometry.append(self.geometry[0])
        self.line_miles = self.cumulative[-1] if self.cumulative else 0.0
        self.total_miles = float(total_miles) if total_miles else self.line_miles

    def point_at(self, miles: float) -> Tuple[float, float]:
        if not self.geometry:
            return (0.0, 0.0)
        target = max(0.0, min(float(miles), self.total_miles))
        # Rescale the haversine line-length onto the provider's reported distance
        # so interpolated stops line up with the reported mile markers.
        if self.line_miles > 0 and self.total_miles > 0:
            target = target / self.total_miles * self.line_miles

        lo, hi = 0, len(self.cumulative) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if self.cumulative[mid] <= target:
                lo = mid
            else:
                hi = mid
        span = self.cumulative[hi] - self.cumulative[lo]
        ratio = 0.0 if span <= 0 else (target - self.cumulative[lo]) / span
        lat1, lng1 = self.geometry[lo]
        lat2, lng2 = self.geometry[hi]
        return (lat1 + (lat2 - lat1) * ratio, lng1 + (lng2 - lng1) * ratio)


# --------------------------------------------------------------------------
# Planner
# --------------------------------------------------------------------------
class HOSPlanner:
    """
    Greedily simulates a trip and emits duty-status records.

    Usage::

        planner = HOSPlanner(start_time=..., cycle_used_hours=...)
        planner.plan(activities)
        planner.records   # -> list[DutyRecord]
        planner.stops     # -> list[Stop]
    """

    def __init__(self, start_time: datetime, cycle_used_hours: float = 0.0):
        self.start_time = start_time
        self.initial_cycle_used = max(0.0, float(cycle_used_hours))
        self.clock: datetime = start_time
        self.shift_start: datetime = start_time
        self.drive_this_shift = 0.0
        self.drive_since_break = 0.0
        self.cycle_used = self.initial_cycle_used
        self.miles_since_fuel = 0.0
        self.total_miles = 0.0
        self.records: List[DutyRecord] = []
        self.stops: List[Stop] = []
        self.violations: List[str] = []

    # -- accounting helpers -------------------------------------------------
    def _hours_since_shift_start(self) -> float:
        return (self.clock - self.shift_start).total_seconds() / SECONDS_PER_HOUR

    def _cycle_remaining(self) -> float:
        return CYCLE_LIMIT_HOURS - self.cycle_used

    def _add(self, status: str, hours: float, *, miles: float = 0.0, location: str = "",
             note: str = "", lat: Optional[float] = None, lng: Optional[float] = None) -> Optional[DutyRecord]:
        if hours <= EPSILON:
            return None
        start = self.clock
        end = start + timedelta(hours=hours)
        record = DutyRecord(status=status, start=start, end=end, location=location,
                            note=note, miles=miles, lat=lat, lng=lng)

        # Merge with the previous record when they are contiguous & identical.
        if (self.records and self.records[-1].status == status
                and (start - self.records[-1].end).total_seconds() < 1
                and self.records[-1].note == note):
            self.records[-1].end = end
            self.records[-1].miles += miles
            self.records[-1].location = location or self.records[-1].location
            if lat is not None:
                self.records[-1].lat = lat
            if lng is not None:
                self.records[-1].lng = lng
            record = self.records[-1]
        else:
            self.records.append(record)

        # Advance the duty clocks.
        if status == DRIVING:
            self.drive_this_shift += hours
            self.drive_since_break += hours
            self.cycle_used += hours
            self.miles_since_fuel += miles
            self.total_miles += miles
        elif status == ON_DUTY:
            self.cycle_used += hours

        # Any non-driving block of >= 30 minutes satisfies the 30-minute break.
        if status in (OFF_DUTY, SLEEPER) or (status == ON_DUTY and hours >= BREAK_DURATION_HOURS - EPSILON):
            self.drive_since_break = 0.0

        self.clock = end
        return record

    # -- planned breaks / rests --------------------------------------------
    def _record_stop(self, kind: str, label: str, start: datetime, end: datetime,
                     lat: Optional[float], lng: Optional[float]) -> None:
        self.stops.append(Stop(kind=kind, label=label, start=start, end=end, lat=lat, lng=lng,
                               miles_from_origin=self.total_miles))

    def _take_break(self, location: str, lat: Optional[float], lng: Optional[float]) -> None:
        start = self.clock
        self._add(OFF_DUTY, BREAK_DURATION_HOURS, location=location,
                  note="30-minute break (8h driving rule)", lat=lat, lng=lng)
        self._record_stop("break", "30-min break", start, self.clock, lat, lng)

    def _take_full_reset(self, location: str, lat: Optional[float], lng: Optional[float]) -> None:
        start = self.clock
        self._add(SLEEPER, FULL_RESET_HOURS, location=location,
                  note="10-hour reset (11h / 14h limit reached)", lat=lat, lng=lng)
        self.shift_start = self.clock
        self.drive_this_shift = 0.0
        self.drive_since_break = 0.0
        self._record_stop("rest", "10-hour reset", start, self.clock, lat, lng)

    def _take_restart(self, location: str, lat: Optional[float], lng: Optional[float]) -> None:
        start = self.clock
        self._add(OFF_DUTY, CYCLE_RESTART_HOURS, location=location,
                  note="34-hour restart (70-hour / 8-day cycle reached)", lat=lat, lng=lng)
        self.cycle_used = 0.0
        self.shift_start = self.clock
        self.drive_this_shift = 0.0
        self.drive_since_break = 0.0
        self._record_stop("restart", "34-hour restart", start, self.clock, lat, lng)

    def _take_fuel(self, location: str, lat: Optional[float], lng: Optional[float]) -> None:
        start = self.clock
        self._add(ON_DUTY, FUEL_DURATION_HOURS, location=location,
                  note="Fuel stop (1,000-mile rule)", lat=lat, lng=lng)
        self.miles_since_fuel = 0.0
        self._record_stop("fuel", "Fuel stop", start, self.clock, lat, lng)

    # -- leg simulation -----------------------------------------------------
    def _drive_leg(self, leg: dict) -> None:
        total_hours = float(leg["duration_hours"])
        total_miles = float(leg["distance_miles"])
        if total_hours <= EPSILON or total_miles <= EPSILON:
            return

        geometry = RouteGeometry(leg.get("geometry") or [], total_miles)
        speed = total_miles / total_hours  # mph
        from_label = leg["from"]["label"]
        to_label = leg["to"]["label"]
        leg_desc = f"Driving: {from_label} \u2192 {to_label}"

        covered = 0.0
        remaining_hours = total_hours
        remaining_miles = total_miles

        # A hard iteration ceiling guarantees termination even on odd input.
        for _ in range(5000):
            if remaining_hours <= EPSILON or remaining_miles <= EPSILON:
                break

            # (1) 70-hour / 8-day cycle -> 34-hour restart
            if self._cycle_remaining() <= EPSILON:
                lat, lng = geometry.point_at(covered)
                self._take_restart(leg_desc, lat, lng)
                continue

            # (2) 11-hour drive limit or 14-hour window -> 10-hour reset
            drive_left = MAX_DRIVE_PER_SHIFT_HOURS - self.drive_this_shift
            window_left = MAX_DUTY_WINDOW_HOURS - self._hours_since_shift_start()
            if drive_left <= EPSILON or window_left <= EPSILON:
                lat, lng = geometry.point_at(covered)
                self._take_full_reset(leg_desc, lat, lng)
                continue

            # (3) 30-minute break after 8 cumulative hours of driving
            break_left = BREAK_AFTER_DRIVE_HOURS - self.drive_since_break
            if break_left <= EPSILON:
                lat, lng = geometry.point_at(covered)
                self._take_break(leg_desc, lat, lng)
                continue

            # (4) Fuel at least every 1,000 miles
            fuel_left_miles = FUEL_INTERVAL_MILES - self.miles_since_fuel
            fuel_left_hours = fuel_left_miles / speed if speed > 0 else remaining_hours

            # (5) Remaining hours in the 70-hour / 8-day cycle
            cycle_left_hours = self._cycle_remaining()

            chunk_hours = min(remaining_hours, drive_left, window_left, break_left,
                              fuel_left_hours, cycle_left_hours)
            chunk_hours = max(chunk_hours, 1e-4)
            chunk_miles = min(chunk_hours * speed, remaining_miles)
            chunk_hours = chunk_miles / speed if speed > 0 else chunk_hours

            seg_lat, seg_lng = geometry.point_at(covered + chunk_miles)
            self._add(DRIVING, chunk_hours, miles=chunk_miles, location=leg_desc,
                      note=leg_desc, lat=seg_lat, lng=seg_lng)

            covered += chunk_miles
            remaining_hours -= chunk_hours
            remaining_miles -= chunk_miles
            if remaining_miles < 0.5:
                remaining_miles = 0.0

            # Refuel only if the truck still has to keep rolling.
            if self.miles_since_fuel >= FUEL_INTERVAL_MILES - EPSILON and remaining_miles > 1.0:
                lat, lng = geometry.point_at(covered)
                self._take_fuel(f"{leg_desc} (mile {covered:,.0f})", lat, lng)
        else:  # pragma: no cover - defensive
            self.violations.append(f"Simulation iteration limit reached on leg {leg_desc}")

    def _on_duty_stop(self, activity: dict) -> None:
        hours = float(activity["hours"])
        label = activity["label"]
        loc = activity.get("location") or {}
        lat, lng = loc.get("lat"), loc.get("lng")

        # The 70-hour cycle also applies to on-duty (not driving) time.
        if self._cycle_remaining() < hours - EPSILON:
            self._take_restart(f"Before {label}", lat, lng)

        start = self.clock
        self._add(ON_DUTY, hours, location=label, note=label, lat=lat, lng=lng)
        self._record_stop(activity.get("kind", "on_duty"), label, start, self.clock, lat, lng)

    # -- public API ---------------------------------------------------------
    def plan(self, activities: Sequence[dict]) -> "HOSPlanner":
        for activity in activities:
            if activity["type"] == "drive":
                self._drive_leg(activity)
            elif activity["type"] == "on_duty":
                self._on_duty_stop(activity)
            else:  # pragma: no cover - defensive
                raise ValueError(f"Unknown activity type: {activity['type']!r}")
        return self

    # -- reporting ----------------------------------------------------------
    def totals(self) -> Dict[str, float]:
        totals = {status: 0.0 for status in DUTY_STATUSES}
        for record in self.records:
            totals[record.status] += record.hours
        return totals

    def summary(self) -> dict:
        totals = self.totals()
        return {
            "trip_start": self.start_time.isoformat(timespec="minutes"),
            "trip_end": self.clock.isoformat(timespec="minutes"),
            "total_miles": round(self.total_miles, 2),
            "total_hours": round(sum(totals.values()), 4),
            "driving_hours": round(totals[DRIVING], 4),
            "on_duty_hours": round(totals[ON_DUTY], 4),
            "off_duty_hours": round(totals[OFF_DUTY], 4),
            "sleeper_hours": round(totals[SLEEPER], 4),
            "cycle_hours_start": round(self.initial_cycle_used, 4),
            "cycle_hours_used": round(min(self.cycle_used, CYCLE_LIMIT_HOURS), 4),
            "stops": len(self.stops),
            "violations": list(self.violations),
        }
