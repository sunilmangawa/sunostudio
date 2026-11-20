from rest_framework import serializers
from .models import MusicJob, StudioProject


class MusicJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = MusicJob
        fields = ["id", "prompt", "title", "style", "lyrics", "duration", "instrumental", "settings", "status", "provider", "audio_url", "error", "created_at", "updated_at"]
        read_only_fields = ["id", "status", "provider", "audio_url", "error", "created_at", "updated_at"]

    def validate_duration(self, value):
        if not 5 <= value <= 240:
            raise serializers.ValidationError("Duration must be between 5 and 240 seconds.")
        return value


class StudioProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudioProject
        fields = ["id", "name", "bpm", "musical_key", "tracks", "settings", "updated_at"]
        read_only_fields = ["id", "updated_at"]

    def validate_bpm(self, value):
        if not 40 <= value <= 240:
            raise serializers.ValidationError("BPM must be between 40 and 240.")
        return value
