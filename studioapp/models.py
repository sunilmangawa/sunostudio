import uuid
from django.conf import settings
from django.db import models


class MusicJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        COMPLETE = "complete", "Complete"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="music_jobs")
    prompt = models.TextField()
    title = models.CharField(max_length=120, blank=True)
    style = models.CharField(max_length=160, blank=True)
    lyrics = models.TextField(blank=True)
    duration = models.PositiveSmallIntegerField(default=30)
    instrumental = models.BooleanField(default=False)
    settings = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    provider = models.CharField(max_length=80, default="local")
    provider_task_id = models.CharField(max_length=120, blank=True)
    audio_url = models.URLField(max_length=500, blank=True)
    error = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title or self.prompt[:48]


class StudioProject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="studio_projects")
    name = models.CharField(max_length=120)
    bpm = models.PositiveSmallIntegerField(default=112)
    musical_key = models.CharField(max_length=12, default="C min")
    tracks = models.JSONField(default=list, blank=True)
    settings = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name
