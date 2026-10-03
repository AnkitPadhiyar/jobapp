"""API tests. Geocoding/routing are patched so the suite is fully offline."""
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from trips.models import Trip

PAYLOAD = {
    "current_location": "Newark, NJ",
    "pickup_location": "Philadelphia, PA",
    "dropoff_location": "Pittsburgh, PA",
    "current_cycle_used": 12.5,
    "start_time": "2026-01-01T06:00:00",
}


def fake_geocode(query):
    return {"label": query, "display_name": f"{query}, USA",
            "lat": 40.0 + len(query) / 100.0, "lng": -75.0, "source": "test"}


def fake_route(origin, destination):
    return {
        "distance_miles": 600.0,
        "duration_hours": 10.0,
        "geometry": [[origin["lat"], origin["lng"]], [destination["lat"], destination["lng"]]],
        "source": "test",
    }


@patch("trips.services.planner.route", side_effect=fake_route)
@patch("trips.services.planner.geocode", side_effect=fake_geocode)
class TripApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_trip_persists_and_returns_logs(self, *_mocks):
        response = self.client.post(reverse("trip-list"), PAYLOAD, format="json")

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(len(body["daily_logs"]), 2)
        self.assertIn("route", body)
        self.assertIn("geometry", body["route"])
        self.assertEqual(body["route"]["total_distance_miles"], 1200.0)
        self.assertEqual(Trip.objects.count(), 1)

        trip = Trip.objects.first()
        self.assertEqual(trip.log_days, 2)
        self.assertEqual(trip.result["inputs"]["current_cycle_used"], 12.5)

    def test_plan_endpoint_is_a_dry_run(self, *_mocks):
        response = self.client.post(reverse("trip-plan"), PAYLOAD, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.json()["id"])
        self.assertEqual(Trip.objects.count(), 0)

    def test_cycle_used_above_70_is_rejected(self, *_mocks):
        response = self.client.post(
            reverse("trip-list"), {**PAYLOAD, "current_cycle_used": 80}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_blank_location_is_rejected(self, *_mocks):
        response = self.client.post(
            reverse("trip-list"), {**PAYLOAD, "pickup_location": ""}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_geocoding_failure_returns_400(self, *_mocks):
        from trips.services.geo import GeocodingError

        with patch("trips.services.planner.geocode", side_effect=GeocodingError("not found")):
            response = self.client.post(reverse("trip-list"), PAYLOAD, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "geocoding_failed")

    def test_list_and_detail(self, *_mocks):
        created = self.client.post(reverse("trip-list"), PAYLOAD, format="json").json()
        trip_id = created["id"]

        listing = self.client.get(reverse("trip-list")).json()
        self.assertEqual(len(listing), 1)
        self.assertNotIn("result", listing[0])

        detail = self.client.get(reverse("trip-detail", args=[trip_id])).json()
        self.assertEqual(detail["id"], trip_id)
        self.assertIn("daily_logs", detail["result"])

    def test_health_endpoint(self, *_mocks):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_suggest_locations(self, *_mocks):
        response = self.client.get(reverse("trip-suggest") + "?q=Chic")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(any("Chicago" in item["label"] for item in data))

