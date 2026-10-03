from django.contrib import admin

from .models import Trip


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ("id", "current_location", "pickup_location", "dropoff_location",
                    "current_cycle_used", "total_distance_miles", "log_days", "created_at")
    list_filter = ("created_at",)
    search_fields = ("current_location", "pickup_location", "dropoff_location")
    readonly_fields = ("created_at", "result")
