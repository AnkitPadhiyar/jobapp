"""
Routing via the free OSRM demo server (Project OSRM), with a straight-line
great-circle fallback so the planner always produces a result.
"""
from __future__ import annotations

import logging
from typing import List

import requests
from django.conf import settings

from .hos_engine import DEFAULT_SPEED_MPH, haversine_miles

logger = logging.getLogger(__name__)

METERS_PER_MILE = 1609.344
SECONDS_PER_HOUR = 3600.0


class RoutingError(RuntimeError):
    """Raised when a route cannot be produced at all."""


def _fallback_route(origin: dict, destination: dict) -> dict:
    """Straight-line estimate used when the routing provider is unavailable."""
    miles = haversine_miles(origin["lat"], origin["lng"], destination["lat"], destination["lng"])
    # 1.2 detour factor approximates real road distance vs. great-circle.
    road_miles = round(miles * 1.2, 2)
    return {
        "distance_miles": road_miles,
        "duration_hours": round(road_miles / DEFAULT_SPEED_MPH, 4),
        "geometry": [[origin["lat"], origin["lng"]], [destination["lat"], destination["lng"]]],
        "source": "fallback",
    }


def route(origin: dict, destination: dict) -> dict:
    """
    Return ``{"distance_miles", "duration_hours", "geometry", "source"}`` for a
    single leg, where geometry is ``[[lat, lng], ...]``.
    """
    coords = f"{origin['lng']},{origin['lat']};{destination['lng']},{destination['lat']}"
    url = f"{settings.OSRM_BASE_URL.rstrip('/')}/route/v1/driving/{coords}"
    params = {"overview": "full", "geometries": "geojson", "steps": "false", "alternatives": "false"}
    headers = {"User-Agent": settings.HTTP_USER_AGENT, "Accept": "application/json"}

    try:
        response = requests.get(url, params=params, headers=headers, timeout=settings.HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != "Ok" or not payload.get("routes"):
            raise RoutingError(payload.get("message", "OSRM returned no route"))

        best = payload["routes"][0]
        geometry: List[List[float]] = [
            [lat, lng] for lng, lat in best["geometry"]["coordinates"]
        ]
        if len(geometry) < 2:
            raise RoutingError("OSRM returned an empty geometry")

        return {
            "distance_miles": round(best["distance"] / METERS_PER_MILE, 2),
            "duration_hours": round(best["duration"] / SECONDS_PER_HOUR, 4),
            "geometry": geometry,
            "source": "osrm",
        }
    except (requests.RequestException, ValueError, KeyError, RoutingError) as exc:
        logger.warning("OSRM routing failed (%s -> %s): %s", origin.get("label"), destination.get("label"), exc)
        return _fallback_route(origin, destination)
