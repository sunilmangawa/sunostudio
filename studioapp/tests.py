import tempfile
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase
from rest_framework import status
from .models import MusicJob, StudioProject
from .services import normalize_lyrics

TEST_MEDIA = tempfile.mkdtemp(prefix="cadence-test-media-")


class PageRouteTests(TestCase):
    def test_public_pages_render_with_their_own_tools(self):
        for url, markers in (
            ("/", ["Hear your idea", "For You", "New Albums"]),
            ("/create", ["Your clips", "More Options", "Help me start a draft"]),
            ("/studio", ["Your arrangement", "Creative companion", "ask me to add a part"]),
        ):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                for marker in markers:
                    self.assertContains(response, marker)

    def test_each_page_links_to_the_other_routes(self):
        for url in ("/", "/create", "/studio"):
            with self.subTest(url=url):
                body = self.client.get(url).content.decode()
                for href in ('href="/"', 'href="/create"', 'href="/studio"'):
                    self.assertIn(href, body)


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class StudioApiIsolationTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", password="correct-horse-battery")
        self.other = User.objects.create_user(username="other", password="correct-horse-battery")
        self.project = StudioProject.objects.create(user=self.owner, name="Private arrangement")
        self.job = MusicJob.objects.create(user=self.owner, prompt="A quiet, hazy piano sketch")

    def test_jobs_and_projects_require_authentication(self):
        for endpoint in ("/api/jobs/", "/api/projects/"):
            with self.subTest(endpoint=endpoint):
                self.client.logout()
                response = self.client.get(endpoint)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_users_only_list_their_own_records(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/jobs/").data, [])
        self.assertEqual(self.client.get("/api/projects/").data, [])

    def test_users_cannot_read_or_mutate_foreign_records(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"/api/jobs/{self.job.pk}/").status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.patch(f"/api/projects/{self.project.pk}/", {"name": "stolen"}).status_code, status.HTTP_404_NOT_FOUND)
        self.project.refresh_from_db()
        self.assertEqual(self.project.name, "Private arrangement")

    def test_authenticated_user_can_save_a_project(self):
        self.client.force_authenticate(self.other)
        response = self.client.post("/api/projects/", {"name": "New work", "bpm": 100, "musical_key": "A min", "tracks": [], "settings": {}}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(StudioProject.objects.get(pk=response.data["id"]).user, self.other)

    def test_local_provider_returns_a_playable_audio_file(self):
        self.client.force_authenticate(self.other)
        response = self.client.post("/api/jobs/", {"prompt": "A warm piano idea", "duration": 16, "instrumental": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["provider"], "local")
        self.assertEqual(response.data["status"], "complete")
        self.assertTrue(response.data["audio_url"].startswith(settings.MEDIA_URL))
        relative = response.data["audio_url"].removeprefix(settings.MEDIA_URL)
        self.assertTrue((Path(settings.MEDIA_ROOT) / relative).exists())

    def test_speech_is_rejected_without_a_voice_provider(self):
        self.client.force_authenticate(self.other)
        response = self.client.post(
            "/api/jobs/",
            {"prompt": "Read this aloud", "duration": 16, "settings": {"format": "speech"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], "failed")
        self.assertEqual(response.data["audio_url"], "")
        self.assertIn("voice model", response.data["error"])

    def test_provider_status_is_public_and_names_the_active_provider(self):
        self.client.logout()
        response = self.client.get("/api/provider/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(response.json()["provider"]["provider"], {"local", "wavespeed"})
        self.assertTrue(response.json()["provider"]["configured"])

    def test_preview_route_serves_a_wav_file(self):
        self.client.logout()
        response = self.client.get("/preview/test-preview.wav")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "audio/wav")
        self.assertEqual(b"".join(response.streaming_content)[:4], b"RIFF")


class LyricFormattingTests(TestCase):
    def test_plain_lyrics_gain_supported_section_tags(self):
        formatted = normalize_lyrics("First line\nSecond line\nThird line\nFourth line")
        self.assertIn("[intro-medium]", formatted)
        self.assertIn("[verse]", formatted)
        self.assertIn("[outro-medium]", formatted)
        self.assertIn("First line\nSecond line", formatted)

    def test_existing_suno_style_tags_are_mapped(self):
        formatted = normalize_lyrics("[Verse 1]\nHello there\n\n[Chorus]\nSing it back")
        self.assertIn("[verse]\nHello there", formatted)
        self.assertIn("[chorus]\nSing it back", formatted)
        self.assertNotIn("Verse 1", formatted)


@override_settings(MEDIA_ROOT=TEST_MEDIA)
@mock.patch.dict("os.environ", {"WAVESPEED_API_KEY": "test-key"})
class WaveSpeedProviderTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="provider", password="correct-horse-battery")
        self.client.force_authenticate(self.user)

    def test_song_submission_stores_the_task_and_stays_running(self):
        with mock.patch("studioapp.services._request", return_value={"code": 200, "data": {"id": "pred-123", "status": "created"}}) as request:
            response = self.client.post("/api/jobs/", {
                "prompt": "A late night drive",
                "lyrics": "Streetlights flicker\nWe drive until the morning\nThe radio is low\nAnd the city keeps turning",
                "style": "dream pop, female vocal",
                "duration": 30,
            }, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["provider"], "wavespeed")
        self.assertEqual(response.data["status"], "running")
        self.assertEqual(response.data["audio_url"], "")
        job = MusicJob.objects.get(pk=response.data["id"])
        self.assertEqual(job.provider_task_id, "pred-123")
        payload = request.call_args.args[1]
        self.assertIn("[verse]", payload["lyrics"])
        self.assertIn("dream pop", payload["description"])

    def test_instrumental_prompt_uses_the_text_to_music_model(self):
        with mock.patch("studioapp.services._request", return_value={"data": {"id": "pred-456"}}) as request:
            self.client.post("/api/jobs/", {
                "prompt": "Drifting analog synth loop", "duration": 20, "instrumental": True,
            }, format="json")
        url = request.call_args.args[0]
        payload = request.call_args.args[1]
        self.assertIn("sonilo/text-to-music", url)
        self.assertEqual(payload["duration"], 20)
        self.assertIn("no vocals", payload["prompt"])

    def test_retrieving_a_running_job_polls_the_result(self):
        job = MusicJob.objects.create(
            user=self.user, prompt="A finished song", provider="wavespeed",
            provider_task_id="pred-789", status=MusicJob.Status.RUNNING,
        )
        result = {"data": {"id": "pred-789", "status": "completed", "outputs": ["https://cdn.example/song.mp3"]}}
        with mock.patch("studioapp.services._request", return_value=result) as request:
            response = self.client.get(f"/api/jobs/{job.pk}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "complete")
        self.assertEqual(response.data["audio_url"], "https://cdn.example/song.mp3")
        self.assertIn("/predictions/pred-789/result", request.call_args.args[0])
