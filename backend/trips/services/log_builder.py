"""
Turns a flat list of :class:`DutyRecord` objects into driver's-daily-log
sheets (one per calendar day), ready to be drawn by the React front end.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Sequence

from .hos_engine import (
    DUTY_STATUSES,
    DRIVING,
    ON_DUTY,
    STATUS_LABELS,
    DutyRecord,
)

SECONDS_PER_HOUR = 3600.0


def format_hours(hours: float) -> str:
    """1.75 -> '1:45' (total-hours display)."""
    total_minutes = int(round(hours * 60))
    sign = "-" if total_minutes < 0 else ""
    total_minutes = abs(total_minutes)
    return f"{sign}{total_minutes // 60}:{total_minutes % 60:02d}"


def format_clock(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def _hours_between(start: datetime, end: datetime) -> float:
    return (end - start).total_seconds() / SECONDS_PER_HOUR


def _segment_label(record: DutyRecord) -> str:
    if record.status == DRIVING:
        return record.note or "Driving"
    return record.note or record.location or STATUS_LABELS[record.status]


def _remark_text(record: DutyRecord) -> str:
    note = record.note or STATUS_LABELS[record.status]
    location = record.location or ""
    if location and location not in note:
        return f"{note} - {location}"
    return note


def _cumulative_miles_at(records: Sequence[DutyRecord], moment: datetime) -> float:
    total = 0.0
    for record in records:
        if record.start >= moment:
            break
        if record.end <= moment:
            total += record.miles
        else:
            ratio = _hours_between(record.start, moment) / record.hours if record.hours else 0.0
            total += record.miles * ratio
    return total


def build_daily_logs(records: Sequence[DutyRecord], trip_meta: Dict | None = None) -> List[dict]:
    """Split ``records`` into per-day log sheets with segments, remarks and recap."""
    trip_meta = trip_meta or {}
    if not records:
        return []

    first_midnight = records[0].start.replace(hour=0, minute=0, second=0, microsecond=0)
    trip_end = records[-1].end

    # --- pass 1: build the raw per-day sheets ------------------------------
    raw_days: List[dict] = []
    day = first_midnight
    while day < trip_end:
        day_start = day
        day_end = day + timedelta(days=1)

        segments: List[dict] = []
        remarks: List[dict] = []
        totals = {status: 0.0 for status in DUTY_STATUSES}
        miles_driving_today = 0.0

        for record in records:
            if record.end <= day_start or record.start >= day_end:
                continue
            seg_start = max(record.start, day_start)
            seg_end = min(record.end, day_end)
            seg_hours = _hours_between(seg_start, seg_end)
            if seg_hours <= 0:
                continue

            # Prorate miles when a driving block straddles midnight.
            ratio = seg_hours / record.hours if record.hours > 0 else 0.0
            seg_miles = record.miles * ratio

            totals[record.status] += seg_hours
            if record.status == DRIVING:
                miles_driving_today += seg_miles

            segments.append({
                "status": record.status,
                "status_label": STATUS_LABELS[record.status],
                "start_hour": round(_hours_between(day_start, seg_start), 4),
                "end_hour": round(_hours_between(day_start, seg_end), 4),
                "from_time": format_clock(seg_start),
                "to_time": format_clock(seg_end),
                "hours": round(seg_hours, 4),
                "hours_label": format_hours(seg_hours),
                "miles": round(seg_miles, 2),
                "label": _segment_label(record),
                "location": record.location,
                "lat": record.lat,
                "lng": record.lng,
                "continues_from_previous_day": record.start < day_start,
            })

            # One remark per status change (the first block of the day always
            # gets a remark, even when it began before midnight).
            if record.start >= day_start or not remarks:
                remarks.append({
                    "time": format_clock(seg_start),
                    "text": _remark_text(record),
                    "status": record.status,
                    "location": record.location,
                    "lat": record.lat,
                    "lng": record.lng,
                })

        on_duty_hours = totals[DRIVING] + totals[ON_DUTY]
        raw_days.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "day_index": len(raw_days) + 1,
            "segments": segments,
            "remarks": remarks,
            "totals": {status: round(value, 4) for status, value in totals.items()},
            "totals_label": {status: format_hours(value) for status, value in totals.items()},
            "on_duty_hours": round(on_duty_hours, 4),
            "total_hours": round(sum(totals.values()), 4),
            "miles_driving_today": round(miles_driving_today, 2),
            "total_mileage_today": round(_cumulative_miles_at(records, day_end), 2),
        })
        day = day_end

    # --- pass 2: attach the 70-hour / 8-day recap --------------------------
    cycle_used = float(trip_meta.get("cycle_used", 0.0) or 0.0)
    for i, sheet in enumerate(raw_days):
        today_hours = sheet["on_duty_hours"]
        previous_seven = sum(d["on_duty_hours"] for d in raw_days[max(0, i - 7):i])
        total_eight = today_hours + previous_seven
        available = max(0.0, 70.0 - (cycle_used + total_eight))
        sheet["recap"] = {
            "on_duty_today": round(today_hours, 4),
            "on_duty_today_label": format_hours(today_hours),
            "on_duty_previous_7_days": round(previous_seven, 4),
            "on_duty_previous_7_days_label": format_hours(previous_seven),
            "total_last_8_days": round(total_eight, 4),
            "total_last_8_days_label": format_hours(total_eight),
            "cycle_limit": 70,
            "available_tomorrow": round(available, 4),
            "available_tomorrow_label": format_hours(available),
        }
        sheet["is_partial"] = sheet["total_hours"] < 23.999

    return raw_days
