from rest_framework import serializers

from .models import Trip


class TripRequestSerializer(serializers.Serializer):
    """Validates and normalises the trip planning request."""

    current_location = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)
    pickup_location = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)
    dropoff_location = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)
    current_cycle_used = serializers.FloatField(min_value=0, max_value=70, default=0.0)
    start_time = serializers.DateTimeField(required=False, allow_null=True)
    save = serializers.BooleanField(required=False, default=True)

    def validate_current_cycle_used(self, value):
        if value < 0 or value > 70:
            raise serializers.ValidationError(
                "Current cycle used must be between 0 and 70 hours for a 70-hour/8-day cycle."
            )
        return value


class TripSerializer(serializers.ModelSerializer):
    """Read serializer for a persisted trip."""

    class Meta:
        model = Trip
        fields = (
            "id",
            "current_location",
            "pickup_location",
            "dropoff_location",
            "current_cycle_used",
            "start_time",
            "total_distance_miles",
            "total_drive_hours",
            "log_days",
            "created_at",
            "result",
        )
        read_only_fields = fields


class TripListSerializer(serializers.ModelSerializer):
    """Lightweight list serializer (omits the heavy ``result`` payload)."""

    class Meta:
        model = Trip
        fields = (
            "id",
            "current_location",
            "pickup_location",
            "dropoff_location",
            "current_cycle_used",
            "total_distance_miles",
            "log_days",
            "created_at",
        )
        read_only_fields = fields
