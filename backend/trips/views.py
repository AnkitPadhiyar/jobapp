import logging
from datetime import datetime

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Trip
from .serializers import TripListSerializer, TripRequestSerializer, TripSerializer
from .services.geo import GeocodingError, suggest_locations
from .services.planner import plan_trip

logger = logging.getLogger(__name__)


def _build_result(request_data: dict) -> dict:
    serializer = TripRequestSerializer(data=request_data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    return plan_trip(
        current_location=data["current_location"],
        pickup_location=data["pickup_location"],
        dropoff_location=data["dropoff_location"],
        current_cycle_used=data.get("current_cycle_used") or 0.0,
        start_time=data.get("start_time"),
    ), serializer.validated_data


class TripViewSet(viewsets.ModelViewSet):
    """
    API for planning a trip and producing route instructions + ELD logs.

    * ``POST /api/trips/``          - plan AND persist a trip
    * ``POST /api/trips/plan/``     - plan only (dry run, nothing saved)
    * ``GET  /api/trips/``          - recent trips
    * ``GET  /api/trips/{id}/``     - a stored trip incl. full result
    """

    queryset = Trip.objects.all()

    def get_serializer_class(self):
        if self.action in ("create", "plan"):
            return TripRequestSerializer
        if self.action == "list":
            return TripListSerializer
        return TripSerializer

    # -- helpers -----------------------------------------------------------
    def _respond(self, request, *, persist: bool) -> Response:
        try:
            result, validated = _build_result(request.data)
        except GeocodingError as exc:
            return Response({"detail": str(exc), "error": "geocoding_failed"},
                            status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"detail": str(exc), "error": "invalid_request"},
                            status=status.HTTP_400_BAD_REQUEST)

        trip = None
        if persist and validated.get("save", True):
            start_time = None
            try:
                naive = datetime.fromisoformat(result["inputs"]["start_time"])
                start_time = timezone.make_aware(naive, timezone.get_current_timezone())
            except ValueError:  # pragma: no cover - defensive
                start_time = None
            trip = Trip.objects.create(
                current_location=result["inputs"]["current_location"],
                pickup_location=result["inputs"]["pickup_location"],
                dropoff_location=result["inputs"]["dropoff_location"],
                current_cycle_used=result["inputs"]["current_cycle_used"],
                start_time=start_time,
                total_distance_miles=result["route"]["total_distance_miles"],
                total_drive_hours=result["route"]["total_drive_hours"],
                log_days=len(result["daily_logs"]),
                result=result,
            )

        payload = dict(result)
        payload["id"] = trip.id if trip else None
        payload["created_at"] = trip.created_at.isoformat() if trip else None
        return Response(payload, status=status.HTTP_201_CREATED if trip else status.HTTP_200_OK)

    # -- routes ------------------------------------------------------------
    def create(self, request, *args, **kwargs):
        """Plan and persist the trip."""
        return self._respond(request, persist=True)

    @action(detail=False, methods=["post"], url_path="plan")
    def plan(self, request):
        """Plan a trip without storing it (dry run)."""
        return self._respond(request, persist=False)

    @action(detail=False, methods=["get"], url_path="suggest")
    def suggest(self, request):
        """Auto-suggest locations for freight hubs and US addresses."""
        query = request.query_params.get("q", "")
        return Response(suggest_locations(query))

