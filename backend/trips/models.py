from django.db import models


class Trip(models.Model):
    """A planned trip plus the computed route, stops and ELD log sheets."""

    current_location = models.CharField(max_length=255)
    pickup_location = models.CharField(max_length=255)
    dropoff_location = models.CharField(max_length=255)
    current_cycle_used = models.FloatField(default=0.0)
    start_time = models.DateTimeField(null=True, blank=True)

    total_distance_miles = models.FloatField(default=0.0)
    total_drive_hours = models.FloatField(default=0.0)
    log_days = models.PositiveIntegerField(default=0)

    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.current_location} -> {self.dropoff_location} ({self.created_at:%Y-%m-%d})"
