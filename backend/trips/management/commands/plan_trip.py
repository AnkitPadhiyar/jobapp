"""
Plan a trip straight from the command line (no browser needed).

Example::

    python manage.py plan_trip "Newark, NJ" "Philadelphia, PA" "Pittsburgh, PA" --cycle-used 12.5
"""
import json
import sys
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from trips.services.geo import GeocodingError
from trips.services.planner import plan_trip


def safe(text) -> str:
    """
    Windows consoles often use a legacy code page (cp1252) that cannot encode the
    arrow glyph used in leg descriptions, so downgrade output to plain ASCII.
    """
    return str(text).replace("\u2192", "->").encode("ascii", "replace").decode("ascii")


class Command(BaseCommand):
    help = "Route a trip, apply the HOS rules and print the generated daily logs."

    def add_arguments(self, parser):
        parser.add_argument("current_location")
        parser.add_argument("pickup_location")
        parser.add_argument("dropoff_location")
        parser.add_argument("--cycle-used", type=float, default=0.0,
                            help="Hours already used in the 70-hour/8-day cycle.")
        parser.add_argument("--start", default=None,
                            help="Departure time, ISO-8601 (e.g. 2026-01-01T06:00).")
        parser.add_argument("--json", action="store_true", help="Dump the raw JSON result.")

    def write(self, message="", style=None):
        """Write ASCII-safe output; `style` is an optional self.style.* callable."""
        text = safe(message)
        self.stdout.write(style(text) if style else text)

    def handle(self, *args, **options):
        # Prefer UTF-8 when the host console supports it.
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):  # pragma: no cover - platform dependent
            pass

        start_time = None
        if options["start"]:
            try:
                start_time = datetime.fromisoformat(options["start"])
            except ValueError as exc:
                raise CommandError(f"--start must be ISO-8601: {exc}")

        try:
            result = plan_trip(
                current_location=options["current_location"],
                pickup_location=options["pickup_location"],
                dropoff_location=options["dropoff_location"],
                current_cycle_used=options["cycle_used"],
                start_time=start_time,
            )
        except GeocodingError as exc:
            raise CommandError(safe(exc))

        if options["json"]:
            self.write(json.dumps(result, indent=2, ensure_ascii=False))
            return

        route = result["route"]
        summary = result["summary"]

        self.write("\n=== ROUTE ===", self.style.SUCCESS)
        for index, leg in enumerate(route["legs"], start=1):
            self.write(
                f"  Leg {index}: {leg['from']['label']} -> {leg['to']['label']}  "
                f"{leg['distance_miles']:,.1f} mi / {leg['duration_hours']:.2f} h ({leg['source']})"
            )
        self.write(
            f"  Total: {route['total_distance_miles']:,.1f} mi, "
            f"{route['total_drive_hours']:.2f} h driving"
        )

        self.write("\n=== PLANNED STOPS ===", self.style.SUCCESS)
        for stop in result["stops"]:
            self.write(
                f"  {stop['start'][11:16]}  {stop['kind']:<8} {stop['label'][:48]:<50} "
                f"({stop['hours']:.2f} h, mile {stop['miles_from_origin']:,.0f})"
            )

        self.write(f"\n=== DAILY LOGS ({len(result['daily_logs'])}) ===", self.style.SUCCESS)
        for sheet in result["daily_logs"]:
            self.write(
                f"\n  {sheet['date']}  miles driving today: {sheet['miles_driving_today']:,.0f}"
            )
            for segment in sheet["segments"]:
                self.write(
                    f"    {segment['from_time']}-{segment['to_time']}  "
                    f"{segment['status_label']:<24} {segment['label'][:44]}"
                )

        self.write("\n=== SUMMARY ===", self.style.SUCCESS)
        for key in ("trip_start", "trip_end", "total_miles", "driving_hours",
                    "on_duty_hours", "off_duty_hours", "sleeper_hours", "cycle_hours_used"):
            self.write(f"  {key:<18} {summary[key]}")

        for warning in result["warnings"]:
            self.write(f"  ! {warning}", self.style.WARNING)
