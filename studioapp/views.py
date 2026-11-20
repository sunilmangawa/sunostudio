from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_http_methods
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import MusicJob, StudioProject
from .previews import ensure_preview
from .serializers import MusicJobSerializer, StudioProjectSerializer
from .services import MusicProviderError, poll_generation, provider_info, start_generation


SONGS = {
    "paper-lanterns": {"title": "Paper Lanterns", "artist": "Marisol Vane", "genre": "Indie Pop", "model": "V1", "plays": "12.4K", "art": "c1"},
    "night-bus-home": {"title": "Night Bus Home", "artist": "Kite & Ember", "genre": "Ambient", "model": "V1", "plays": "8.1K", "art": "c2"},
    "static-bloom": {"title": "Static Bloom", "artist": "Noor Halden", "genre": "Dream Pop", "model": "Studio", "plays": "21K", "art": "c3"},
    "half-a-mind": {"title": "Half a Mind", "artist": "The Quiet Hours", "genre": "Folk", "model": "V1", "plays": "4.8K", "art": "c4"},
    "velvet-hours": {"title": "Velvet Hours", "artist": "Sable June", "genre": "Neo Soul", "model": "V1", "plays": "33K", "art": "c5"},
    "slow-signal": {"title": "Slow Signal", "artist": "Idris Vale", "genre": "Downtempo", "model": "V1-Mini", "plays": "6.2K", "art": "c6"},
    "copper-wire": {"title": "Copper Wire", "artist": "Anouk Reeve", "genre": "Art Rock", "model": "V1", "plays": "54K", "art": "c2"},
    "sunday-static": {"title": "Sunday Static", "artist": "Lune Park", "genre": "Lo-fi", "model": "V1", "plays": "17K", "art": "c4"},
    "salt-and-cedar": {"title": "Salt and Cedar", "artist": "Bright Ferry", "genre": "Americana", "model": "V1-Mini", "plays": "9.4K", "art": "c6"},
    "glasshouse": {"title": "Glasshouse", "artist": "Nia Okafor", "genre": "R&B", "model": "V1", "plays": "41K", "art": "c5"},
    "every-little-echo": {"title": "Every Little Echo", "artist": "Halloran", "genre": "Indie Rock", "model": "V1", "plays": "128K", "art": "c1"},
    "low-light-lullaby": {"title": "Low Light Lullaby", "artist": "Miri Sol", "genre": "Ambient Pop", "model": "V1", "plays": "76K", "art": "c3"},
    "tin-roof-choir": {"title": "Tin Roof Choir", "artist": "The Gentlemen's Club", "genre": "Gospel", "model": "Studio", "plays": "39K", "art": "c4"},
    "undertow": {"title": "Undertow", "artist": "Cass Vale", "genre": "Electronic", "model": "V1", "plays": "210K", "art": "c2"},
}


def _cards(*slugs):
    return [{"id": slug, "audio_url": f"/preview/{slug}.wav", **SONGS[slug]} for slug in slugs]


HOME_RAILS = [
    {"id": "for-you", "title": "For You", "songs": _cards("paper-lanterns", "night-bus-home", "static-bloom", "half-a-mind", "velvet-hours", "slow-signal")},
    {"id": "staff-picks", "title": "Staff Picks", "songs": _cards("copper-wire", "sunday-static", "salt-and-cedar", "glasshouse", "undertow")},
    {"id": "best-of", "title": "Best of Cadence", "songs": _cards("every-little-echo", "low-light-lullaby", "tin-roof-choir", "glasshouse", "velvet-hours")},
]

HOME_CONTEXT = {
    "rails": HOME_RAILS,
    "new_albums": [
        {"title": "Slow Weather", "artist": "Nia Okafor", "count": 8, "art": "c5", "id": "slow-weather", "audio_url": "/preview/slow-weather.wav"},
        {"title": "Kitchen Radio", "artist": "The Quiet Hours", "count": 5, "art": "c4", "id": "kitchen-radio", "audio_url": "/preview/kitchen-radio.wav"},
        {"title": "Blue Hour Tapes", "artist": "Kite & Ember", "count": 11, "art": "c2", "id": "blue-hour-tapes", "audio_url": "/preview/blue-hour-tapes.wav"},
        {"title": "Somewhere North", "artist": "Bright Ferry", "count": 7, "art": "c6", "id": "somewhere-north", "audio_url": "/preview/somewhere-north.wav"},
        {"title": "Paper Rooms", "artist": "Marisol Vane", "count": 9, "art": "c1", "id": "paper-rooms", "audio_url": "/preview/paper-rooms.wav"},
        {"title": "Nocturne for Two", "artist": "Sable June", "count": 6, "art": "c3", "id": "nocturne-for-two", "audio_url": "/preview/nocturne-for-two.wav"},
    ],
    "styles": ["Bedroom pop", "Cinematic", "Lo-fi", "Neo soul", "Ambient", "Indie rock", "House", "Folk"],
}


def home(request: HttpRequest) -> HttpResponse:
    return render(request, "home.html", HOME_CONTEXT)


def create(request: HttpRequest) -> HttpResponse:
    return render(request, "create.html", {"styles": HOME_CONTEXT["styles"], "provider": provider_info()})


def studio(request: HttpRequest) -> HttpResponse:
    return render(request, "studio.html", {"provider": provider_info()})


@require_GET
def provider_status(request: HttpRequest) -> JsonResponse:
    """Public description of the audio provider, so the UI never guesses."""
    return JsonResponse({"provider": provider_info()})


@require_GET
def preview_audio(request: HttpRequest, name: str) -> FileResponse:
    """Serve a cached, locally rendered preview WAV."""
    path = ensure_preview(f"preview-{name}")
    response = FileResponse(open(path, "rb"), content_type="audio/wav")
    response["Cache-Control"] = "public, max-age=86400"
    return response


@require_http_methods(["GET", "POST"])
def register_view(request):
    if request.method == "GET":
        return render(request, "auth.html", {"mode": "Create your account"})
    username = request.POST.get("username", "").strip()
    password = request.POST.get("password", "")
    if len(username) < 3 or len(password) < 8:
        messages.error(request, "Use a username with at least 3 characters and a password with at least 8.")
        return render(request, "auth.html", {"mode": "Create your account"}, status=400)
    if User.objects.filter(username=username).exists():
        messages.error(request, "That username is already taken.")
        return render(request, "auth.html", {"mode": "Create your account"}, status=400)
    user = User.objects.create_user(username=username, password=password)
    login(request, user)
    return redirect("studio")


@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.method == "GET":
        return render(request, "auth.html", {"mode": "Welcome back"})
    user = authenticate(request, username=request.POST.get("username", ""), password=request.POST.get("password", ""))
    if user is None:
        messages.error(request, "Those sign-in details were not recognized.")
        return render(request, "auth.html", {"mode": "Welcome back"}, status=400)
    login(request, user)
    return redirect("studio")


@require_http_methods(["POST"])
def logout_view(request):
    logout(request)
    return redirect("home")


class MusicJobViewSet(viewsets.ModelViewSet):
    serializer_class = MusicJobSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return MusicJob.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        job = serializer.save(user=self.request.user, status=MusicJob.Status.QUEUED)
        try:
            start_generation(job)
        except MusicProviderError as exc:
            job.status = MusicJob.Status.FAILED
            job.error = str(exc)[:240]
            job.save(update_fields=["status", "error", "updated_at"])

    def retrieve(self, request, *args, **kwargs):
        job = self.get_object()
        if job.status in (MusicJob.Status.QUEUED, MusicJob.Status.RUNNING):
            try:
                poll_generation(job)
            except MusicProviderError as exc:
                job.error = str(exc)[:240]
                job.save(update_fields=["error", "updated_at"])
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"])
    def refine(self, request, pk=None):
        job = self.get_object()
        refinement = request.data.get("instruction", "").strip()
        if not refinement:
            return Response({"instruction": "This field is required."}, status=status.HTTP_400_BAD_REQUEST)
        job.prompt = f"{job.prompt}\n\nRefinement: {refinement}"
        job.status = MusicJob.Status.QUEUED
        job.error = ""
        job.provider_task_id = ""
        job.audio_url = ""
        job.save(update_fields=["prompt", "status", "error", "provider_task_id", "audio_url", "updated_at"])
        try:
            start_generation(job)
        except MusicProviderError as exc:
            job.status = MusicJob.Status.FAILED
            job.error = str(exc)[:240]
            job.save(update_fields=["status", "error", "updated_at"])
        serializer = self.get_serializer(job)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)


class StudioProjectViewSet(viewsets.ModelViewSet):
    serializer_class = StudioProjectSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return StudioProject.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
