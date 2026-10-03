"""
Geocoding via free OpenStreetMap-based services.

Resolution order:
    1. Nominatim (``nominatim.openstreetmap.org``) - best for "City, State"/addresses
    2. Photon   (``photon.komoot.io``)             - independent OSM geocoder
    3. A tiny built-in gazetteer                   - keeps demos/tests working offline
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class GeocodingError(ValueError):
    """Raised when a location string cannot be resolved to coordinates."""


# Minimal offline fallback so the demo never hard-fails without a network.
OFFLINE_GAZETTEER: Dict[str, tuple] = {
    "new york": (40.7128, -74.0060),
    "newark": (40.7357, -74.1724),
    "philadelphia": (39.9526, -75.1652),
    "baltimore": (39.2904, -76.6122),
    "washington": (38.9072, -77.0369),
    "richmond": (37.5407, -77.4360),
    "charlotte": (35.2271, -80.8431),
    "atlanta": (33.7490, -84.3880),
    "jacksonville": (30.3322, -81.6557),
    "orlando": (28.5383, -81.3792),
    "miami": (25.7617, -80.1918),
    "chicago": (41.8781, -87.6298),
    "indianapolis": (39.7684, -86.1581),
    "columbus": (39.9612, -82.9988),
    "nashville": (36.1627, -86.7816),
    "memphis": (35.1495, -90.0490),
    "st. louis": (38.6270, -90.1994),
    "dallas": (32.7767, -96.7970),
    "houston": (29.7604, -95.3698),
    "san antonio": (29.4241, -98.4936),
    "denver": (39.7392, -104.9903),
    "kansas city": (39.0997, -94.5786),
    "omaha": (41.2565, -95.9345),
    "minneapolis": (44.9778, -93.2650),
    "detroit": (42.3314, -83.0458),
    "cleveland": (41.4993, -81.6944),
    "pittsburgh": (40.4406, -79.9959),
    "boston": (42.3601, -71.0589),
    "phoenix": (33.4484, -112.0740),
    "tucson": (32.2226, -110.9747),
    "albuquerque": (35.0844, -106.6504),
    "salt lake city": (40.7608, -111.8910),
    "las vegas": (36.1699, -115.1398),
    "los angeles": (34.0522, -118.2437),
    "san diego": (32.7157, -117.1611),
    "san francisco": (37.7749, -122.4194),
    "san jose": (37.3382, -121.8863),
    "sacramento": (38.5816, -121.4944),
    "portland": (45.5152, -122.6784),
    "seattle": (47.6062, -122.3321),
    "spokane": (47.6588, -117.4260),
    "boise": (43.6150, -116.2023),
    "oklahoma city": (35.4676, -97.5164),
    "new orleans": (29.9511, -90.0715),
    "louisville": (38.2527, -85.7585),
    "cincinnati": (39.1031, -84.5120),
    "milwaukee": (43.0389, -87.9065),
    "buffalo": (42.8864, -78.8784),
    "reno": (39.5296, -119.8138),
    "el paso": (31.7619, -106.4850),
    "fort worth": (32.7555, -97.3308),
    "ontario": (34.0633, -117.6509),
    "long beach": (33.7701, -118.1937),
    "tampa": (27.9506, -82.4572),
    "des moines": (41.5868, -93.6250),
    "tulsa": (36.1540, -95.9928),
    "austin": (30.2672, -97.7431),
    "birmingham": (33.5186, -86.8104),
    "savannah": (32.0809, -81.0912),
    "charleston": (32.7765, -79.9311),
    "allentown": (40.6084, -75.4902),
    "harrisburg": (40.2732, -76.8867),
}

US_FREIGHT_HUBS = [
    "Atlanta, GA", "Chicago, IL", "Dallas, TX", "Fort Worth, TX", "Los Angeles, CA",
    "Ontario, CA", "Long Beach, CA", "Houston, TX", "Newark, NJ", "Philadelphia, PA",
    "Memphis, TN", "Indianapolis, IN", "Columbus, OH", "Kansas City, MO", "St. Louis, MO",
    "Louisville, KY", "Nashville, TN", "Charlotte, NC", "Jacksonville, FL", "Miami, FL",
    "Orlando, FL", "Tampa, FL", "Phoenix, AZ", "Denver, CO", "Salt Lake City, UT",
    "Las Vegas, NV", "Seattle, WA", "Portland, OR", "Detroit, MI", "Minneapolis, MN",
    "Milwaukee, WI", "Pittsburgh, PA", "Baltimore, MD", "Richmond, VA", "Boston, MA",
    "Buffalo, NY", "Cleveland, OH", "Cincinnati, OH", "Omaha, NE", "Des Moines, IA",
    "Oklahoma City, OK", "Tulsa, OK", "San Antonio, TX", "Austin, TX", "El Paso, TX",
    "Albuquerque, NM", "Tucson, AZ", "San Diego, CA", "San Francisco, CA", "Sacramento, CA",
    "Reno, NV", "Boise, ID", "Spokane, WA", "Birmingham, AL", "New Orleans, LA",
    "Savannah, GA", "Charleston, SC", "Allentown, PA", "Harrisburg, PA", "New York, NY",
    "Washington, DC",
]


def _offline_lookup(query: str) -> Optional[dict]:
    lowered = query.lower()
    for name, (lat, lng) in OFFLINE_GAZETTEER.items():
        if name in lowered:
            return {
                "label": query,
                "display_name": f"{query} (offline estimate)",
                "lat": lat,
                "lng": lng,
                "source": "offline-gazetteer",
            }
    return None


def suggest_locations(query: str, limit: int = 8) -> list[dict]:
    """Suggest locations based on matching US freight hubs or geocoder results."""
    q = (query or "").strip().lower()
    matches = []

    # 1. Match local freight hubs
    for hub in US_FREIGHT_HUBS:
        if not q or q in hub.lower():
            matches.append({"label": hub, "display_name": f"{hub}, United States"})
            if len(matches) >= limit:
                return matches

    # 2. If query is specific and online, query Photon API for live matching
    if len(q) >= 3 and len(matches) < limit:
        try:
            resp = requests.get(
                f"{settings.PHOTON_BASE_URL.rstrip('/')}/api/",
                params={"q": query, "limit": limit, "lang": "en"},
                headers=_headers(),
                timeout=1.5,
            )
            if resp.ok:
                features = resp.json().get("features") or []
                for f in features:
                    props = f.get("properties") or {}
                    name = props.get("name") or props.get("city")
                    state = props.get("state")
                    country = props.get("countrycode")
                    if name and (not country or country.upper() == "US"):
                        label = f"{name}, {state}" if state else name
                        if not any(m["label"].lower() == label.lower() for m in matches):
                            matches.append({
                                "label": label,
                                "display_name": _photon_display_name(props, label),
                            })
                            if len(matches) >= limit:
                                break
        except Exception:
            pass

    return matches[:limit]


def _headers() -> dict:
    return {"User-Agent": settings.HTTP_USER_AGENT, "Accept": "application/json"}


def _nominatim(query: str) -> Optional[dict]:
    response = requests.get(
        f"{settings.NOMINATIM_BASE_URL.rstrip('/')}/search",
        params={"q": query, "format": "jsonv2", "limit": 1, "addressdetails": 0},
        headers=_headers(),
        timeout=settings.HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    results = response.json()
    if not results:
        return None
    top = results[0]
    return {
        "label": query,
        "display_name": top.get("display_name", query),
        "lat": float(top["lat"]),
        "lng": float(top["lon"]),
        "source": "nominatim",
    }


def _photon_display_name(props: dict, query: str) -> str:
    parts = [
        " ".join(p for p in [props.get("housenumber"), props.get("street")] if p),
        props.get("name"),
        props.get("city"),
        props.get("state"),
        props.get("postcode"),
        props.get("country"),
    ]
    return ", ".join(part for part in parts if part) or query


def _photon(query: str) -> Optional[dict]:
    response = requests.get(
        f"{settings.PHOTON_BASE_URL.rstrip('/')}/api/",
        params={"q": query, "limit": 5, "lang": "en"},
        headers=_headers(),
        timeout=settings.HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    features = response.json().get("features") or []
    if not features:
        return None

    # The HOS rules here are US-specific, so prefer a US match when one exists.
    us_features = [f for f in features if (f.get("properties") or {}).get("countrycode") == "US"]
    chosen = (us_features or features)[0]
    lng, lat = chosen["geometry"]["coordinates"][:2]
    props = chosen.get("properties") or {}
    return {
        "label": query,
        "display_name": _photon_display_name(props, query),
        "lat": float(lat),
        "lng": float(lng),
        "source": "photon",
    }


def geocode(query: str) -> dict:
    """
    Resolve a free-text location into ``{"label", "display_name", "lat", "lng"}``.

    Tries Nominatim, then Photon, then the built-in offline gazetteer.
    """
    query = (query or "").strip()
    if not query:
        raise GeocodingError("Location must not be empty.")

    for provider in (_nominatim, _photon):
        try:
            result = provider(query)
            if result:
                return result
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            logger.warning("%s geocoding failed for %r: %s", provider.__name__, query, exc)

    fallback = _offline_lookup(query)
    if fallback:
        logger.info("Using offline gazetteer for %r", query)
        return fallback

    raise GeocodingError(
        f"Could not geocode {query!r}. Check the spelling or try a more specific "
        "\"City, State\" or full street address."
    )
