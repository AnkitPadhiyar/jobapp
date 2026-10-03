"""Unit tests for the HOS planning engine and log builder (no network required)."""
from datetime import datetime

from django.test import SimpleTestCase

from trips.services.hos_engine import (
    DRIVING,
    OFF_DUTY,
    ON_DUTY,
    SLEEPER,
    HOSPlanner,
    RouteGeometry,
    haversine_miles,
)
from trips.services.log_builder import build_daily_logs, format_hours


def make_leg(miles, hours, from_label="Origin", to_label="Destination"):
    return {
        "type": "drive",
        "from": {"label": from_label, "lat": 0.0, "lng": 0.0},
        "to": {"label": to_label, "lat": 1.0, "lng": 1.0},
        "distance_miles": miles,
        "duration_hours": hours,
        "geometry": [[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]],
    }


def make_stop(kind, label, hours, lat=1.0, lng=1.0):
    return {"type": "on_duty", "kind": kind, "label": label, "hours": hours,
            "location": {"label": label, "lat": lat, "lng": lng}}


class GeometryTests(SimpleTestCase):
    def test_haversine_known_distance(self):
        # NYC -> Philadelphia is roughly 80 miles as the crow flies.
        miles = haversine_miles(40.7128, -74.0060, 39.9526, -75.1652)
        self.assertTrue(75 < miles < 85, miles)

    def test_point_at_interpolates_along_line(self):
        geometry = RouteGeometry([[0.0, 0.0], [0.0, 1.0]], total_miles=100.0)
        lat, lng = geometry.point_at(50.0)
        self.assertAlmostEqual(lat, 0.0, places=6)
        self.assertAlmostEqual(lng, 0.5, places=2)

    def test_point_at_clamps_out_of_range(self):
        geometry = RouteGeometry([[0.0, 0.0], [0.0, 1.0]], total_miles=100.0)
        self.assertEqual(geometry.point_at(-10.0), (0.0, 0.0))
        self.assertAlmostEqual(geometry.point_at(999.0)[1], 1.0, places=6)


class HOSPlannerTests(SimpleTestCase):
    def test_short_trip_needs_no_breaks(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 6, 0), cycle_used_hours=0)
        planner.plan([make_leg(200, 3.5)])

        self.assertAlmostEqual(planner.total_miles, 200.0, places=1)
        self.assertAlmostEqual(planner.totals()[DRIVING], 3.5, places=3)
        self.assertEqual(planner.stops, [])
        self.assertEqual(planner.records[0].start, datetime(2026, 1, 1, 6, 0))

    def test_eleven_hour_limit_triggers_ten_hour_reset(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 0, 0), cycle_used_hours=0)
        planner.plan([make_leg(800, 800 / 60)])

        self.assertAlmostEqual(planner.totals()[DRIVING], 800 / 60, places=2)
        self.assertGreaterEqual(planner.totals()[SLEEPER], 10.0)
        self.assertTrue(any(stop.kind == "rest" for stop in planner.stops))

    def test_thirty_minute_break_after_eight_hours_driving(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 0, 0), cycle_used_hours=0)
        planner.plan([make_leg(510, 8.5)])  # 60 mph -> 8.5 h of driving

        self.assertAlmostEqual(planner.totals()[DRIVING], 8.5, places=2)
        breaks = [stop for stop in planner.stops if stop.kind == "break"]
        self.assertEqual(len(breaks), 1)
        self.assertAlmostEqual(breaks[0].hours, 0.5, places=3)
        self.assertAlmostEqual(planner.totals()[OFF_DUTY], 0.5, places=3)

    def test_fuel_stop_every_thousand_miles(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 0, 0), cycle_used_hours=0)
        planner.plan([make_leg(1200, 1200 / 60)])

        fuel_stops = [stop for stop in planner.stops if stop.kind == "fuel"]
        self.assertEqual(len(fuel_stops), 1)
        # The fuel stop lands at (about) mile 1,000 of the trip.
        self.assertTrue(990 <= fuel_stops[0].miles_from_origin <= 1010,
                        fuel_stops[0].miles_from_origin)
        self.assertAlmostEqual(planner.total_miles, 1200.0, places=1)

    def test_seventy_hour_cycle_forces_restart(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 0, 0), cycle_used_hours=69.5)
        planner.plan([make_leg(300, 5.0)])

        restarts = [stop for stop in planner.stops if stop.kind == "restart"]
        self.assertEqual(len(restarts), 1)
        self.assertAlmostEqual(restarts[0].hours, 34.0, places=3)
        self.assertAlmostEqual(planner.total_miles, 300.0, places=1)
        self.assertTrue(planner.cycle_used <= 70.0)

    def test_pickup_and_dropoff_are_on_duty_not_driving(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 0, 0), cycle_used_hours=0)
        planner.plan([
            make_leg(100, 2.0),
            make_stop("pickup", "Pickup", 1.0),
            make_leg(150, 3.0),
            make_stop("dropoff", "Drop-off", 1.0),
        ])

        on_duty = [r for r in planner.records if r.status == ON_DUTY]
        self.assertAlmostEqual(sum(r.hours for r in on_duty), 2.0, places=3)
        kinds = [stop.kind for stop in planner.stops]
        self.assertEqual(kinds, ["pickup", "dropoff"])

    def test_records_cover_the_duty_clock_contiguously(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 8, 30), cycle_used_hours=0)
        planner.plan([make_leg(1500, 25.0)])
        for previous, current in zip(planner.records, planner.records[1:]):
            self.assertEqual(previous.end, current.start)


class DailyLogTests(SimpleTestCase):
    def test_multi_day_trip_produces_multiple_sheets(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 6, 0), cycle_used_hours=0)
        planner.plan([make_leg(1500, 25.0)])
        sheets = build_daily_logs(planner.records, {"cycle_used": 0})

        self.assertGreaterEqual(len(sheets), 2)
        self.assertEqual(sheets[0]["date"], "2026-01-01")
        # Interior sheets (fully inside the trip) must account for 24 hours.
        for sheet in sheets[1:-1]:
            self.assertAlmostEqual(sheet["total_hours"], 24.0, places=3)
        # The first sheet starts at 06:00, so it can only cover 18 hours.
        self.assertAlmostEqual(sheets[0]["total_hours"], 18.0, places=3)

    def test_segments_are_prorated_across_midnight(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 22, 0), cycle_used_hours=0)
        planner.plan([make_leg(240, 4.0)])  # 22:00 -> 02:00 the next day
        sheets = build_daily_logs(planner.records, {})

        self.assertEqual(len(sheets), 2)
        first_segment = sheets[0]["segments"][0]
        self.assertEqual(first_segment["start_hour"], 22.0)
        self.assertEqual(first_segment["end_hour"], 24.0)
        second_segment = sheets[1]["segments"][0]
        self.assertEqual(second_segment["start_hour"], 0.0)
        self.assertTrue(second_segment["continues_from_previous_day"])

    def test_recap_totals(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 6, 0), cycle_used_hours=10)
        planner.plan([make_leg(400, 8.0)])
        sheets = build_daily_logs(planner.records, {"cycle_used": 10})

        self.assertEqual(sheets[0]["recap"]["cycle_limit"], 70)
        self.assertAlmostEqual(sheets[0]["recap"]["on_duty_today"], 8.0, places=3)
        self.assertAlmostEqual(sheets[0]["recap"]["available_tomorrow"], 52.0, places=3)

    def test_driving_miles_are_prorated_across_midnight(self):
        planner = HOSPlanner(datetime(2026, 1, 1, 22, 0), cycle_used_hours=0)
        planner.plan([make_leg(240, 4.0)])
        sheets = build_daily_logs(planner.records, {})
        total = sheets[0]["miles_driving_today"] + sheets[1]["miles_driving_today"]
        self.assertAlmostEqual(total, 240.0, places=1)

    def test_format_hours(self):
        self.assertEqual(format_hours(1.75), "1:45")
        self.assertEqual(format_hours(0), "0:00")
        self.assertEqual(format_hours(11), "11:00")
