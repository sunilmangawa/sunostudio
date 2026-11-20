"""Audio provider boundary.

Two providers are supported:

* ``wavespeed`` — real AI song generation through WaveSpeedAI. Enabled when
  ``WAVESPEED_API_KEY`` is set. Songs with lyrics use SongGeneration; prompts
  without lyrics use Sonilo Text-to-Music.
* ``local`` — a deterministic instrumental preview rendered on this machine.
  It always works, so the app has playable audio with no account, and it is
  labelled as a preview in the UI rather than as an AI song.

Submission is asynchronous: the WaveSpeedAI task id is stored on the job and
the API polls it when the client asks for the job.
"""

import json
import os
import urllib.error
import urllib.request

from django.conf import settings

from .previews import ensure_preview

BASE_URL = "https://api.wavespeed.ai/api/v3"
SONG_MODEL = os.environ.get("WAVESPEED_MUSIC_MODEL", "wavespeed-ai/song-generation").strip() or "wavespeed-ai/song-generation"
INSTRUMENTAL_MODEL = os.environ.get("WAVESPEED_INSTRUMENTAL_MODEL", "sonilo/text-to-music").strip() or "sonilo/text-to-music"

TERMINAL_FAILURES = {"failed", "cancelled", "timeout", "deleted"}

_TAG_MAP = {
    "intro": "intro-medium", "intro 1": "intro-medium", "intro-short": "intro-short", "intro-medium": "intro-medium",
    "outro": "outro-medium", "outro 1": "outro-medium", "outro-short": "outro-short", "outro-medium": "outro-medium",
    "verse": "verse", "verse 1": "verse", "verse 2": "verse", "verse 3": "verse",
    "chorus": "chorus", "chorus 1": "chorus", "chorus 2": "chorus", "pre-chorus": "verse", "prechorus": "verse",
    "bridge": "bridge", "hook": "chorus", "refrain": "chorus", "break": "inst-medium", "inst": "inst-medium",
    "instrumental": "inst-medium", "interlude": "inst-medium", "solo": "inst-medium",
}


class MusicProviderError(Exception):
    """A provider problem that should be shown to the person using the app."""


def api_key():
    return os.environ.get("WAVESPEED_API_KEY", "").strip()


def provider_info():
    if api_key():
        return {
            "provider": "wavespeed",
            "label": "WaveSpeedAI",
            "ai": True,
            "configured": True,
            "model": SONG_MODEL,
            "detail": "Songs with lyrics render through SongGeneration; instrumental ideas render through Sonilo Text-to-Music.",
        }
    return {
        "provider": "local",
        "label": "Local preview engine",
        "ai": False,
        "configured": True,
        "model": "cadence-preview",
        "detail": "Playable instrumental previews are rendered on this machine. Add WAVESPEED_API_KEY to generate AI songs with vocals.",
    }


def _request(url, payload=None, timeout=45):
    headers = {"Authorization": f"Bearer {api_key()}", "Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = json.load(error).get("message", "")
        except Exception:
            detail = error.read().decode("utf-8", "replace")[:200]
        raise MusicProviderError(f"WaveSpeedAI returned {error.code}. {detail}".strip()) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise MusicProviderError("Could not reach WaveSpeedAI. Check the connection and try again.") from error
    except json.JSONDecodeError as error:
        raise MusicProviderError("WaveSpeedAI returned an unreadable response.") from error


def normalize_lyrics(text):
    """Convert free-form lyrics into the section-tagged format the model expects."""
    text = (text or "").strip()
    if not text:
        return ""
    sections = []
    if "[" in text:
        current = None
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if line.startswith("[") and line.endswith("]"):
                name = line.strip("[]").strip().lower()
                current = [_TAG_MAP.get(name, "verse"), []]
                sections.append(current)
            elif line and current is not None:
                current[1].append(line)
            elif line:
                current = ["verse", [line]]
                sections.append(current)
        blocks = []
        for tag, lines in sections:
            body = "\n".join(lines)
            blocks.append(f"[{tag}]\n{body}".rstrip())
    else:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        blocks = ["[intro-medium]"]
        chunk = []
        tag = "verse"
        for line in lines:
            chunk.append(line)
            if len(chunk) == 4:
                blocks.append(f"[{tag}]\n" + "\n".join(chunk))
                tag = "chorus" if tag == "verse" else "verse"
                chunk = []
        if chunk:
            blocks.append(f"[{tag}]\n" + "\n".join(chunk))
        blocks.append("[outro-medium]")
    return "\n\n".join(block for block in blocks if block.strip())


def _description(job):
    parts = []
    style = (job.style or "").strip()
    if style:
        parts.append(style)
    gender = (job.settings or {}).get("vocalGender")
    if gender in ("male", "female"):
        parts.append(gender)
    if job.instrumental:
        parts.append("instrumental, no vocals")
    prompt = (job.prompt or "").strip()
    if prompt and prompt.lower() not in style.lower():
        parts.append(prompt[:220])
    parts.append("studio quality, wide stereo image")
    seen, ordered = set(), []
    for part in parts:
        key = part.lower()
        if key not in seen:
            seen.add(key)
            ordered.append(part)
    return ", ".join(ordered)[:900]


def _submission(job):
    lyrics = "" if job.instrumental else normalize_lyrics(job.lyrics)
    if lyrics and lyrics.replace("[", "").replace("]", "").strip():
        return SONG_MODEL, {
            "lyrics": lyrics[:4800],
            "description": _description(job),
            "genre": "Auto",
            "guidance_scale": 1.5,
            "temperature": 0.9,
            "top_k": 50,
        }
    prompt = _description(job) or job.prompt or "A warm instrumental sketch"
    if "no vocals" not in prompt.lower():
        prompt = f"{prompt}, instrumental, no vocals"
    return INSTRUMENTAL_MODEL, {"prompt": prompt[:1900], "duration": max(5, min(360, int(job.duration or 30)))}


def _extract_audio(data):
    outputs = data.get("outputs") or []
    for output in outputs:
        if isinstance(output, str) and output.startswith("http"):
            return output
        if isinstance(output, dict):
            for key in ("url", "audio", "audio_url", "output"):
                value = output.get(key)
                if isinstance(value, str) and value.startswith("http"):
                    return value
                if isinstance(value, list):
                    for item in value:
                        if isinstance(item, str) and item.startswith("http"):
                            return item
    return ""


def _submit(model, payload):
    body = _request(f"{BASE_URL}/{model}", payload)
    if isinstance(body, dict) and body.get("code") not in (None, 200):
        raise MusicProviderError(body.get("message") or "WaveSpeedAI rejected the request.")
    data = body.get("data", body) if isinstance(body, dict) else {}
    task_id = data.get("id")
    if not task_id:
        raise MusicProviderError("WaveSpeedAI did not return a task id.")
    return task_id


def _local_preview(job):
    seconds = max(6, min(24, int(job.duration or 14)))
    path = ensure_preview(f"clip-{job.id}", seconds=seconds)
    relative = path.relative_to(settings.MEDIA_ROOT).as_posix()
    return f"{settings.MEDIA_URL}{relative}"


def start_generation(job):
    """Submit a job to the active provider and store its state on the job."""
    if (job.settings or {}).get("format") == "speech":
        raise MusicProviderError("Speech needs a voice model, which is not connected. Create a song instead, or switch to Songs.")
    if not api_key():
        job.audio_url = _local_preview(job)
        job.provider = "local"
        job.provider_task_id = ""
        job.status = job.Status.COMPLETE
        job.error = ""
        job.save(update_fields=["audio_url", "provider", "provider_task_id", "status", "error", "updated_at"])
        return job
    model, payload = _submission(job)
    task_id = _submit(model, payload)
    job.audio_url = ""
    job.provider = "wavespeed"
    job.provider_task_id = task_id
    job.status = job.Status.RUNNING
    job.error = ""
    job.save(update_fields=["audio_url", "provider", "provider_task_id", "status", "error", "updated_at"])
    return job


def poll_generation(job):
    """Refresh a running WaveSpeedAI task. Safe to call repeatedly."""
    if job.provider != "wavespeed" or not job.provider_task_id:
        return job
    if job.status not in (job.Status.QUEUED, job.Status.RUNNING):
        return job
    data = _request(f"{BASE_URL}/predictions/{job.provider_task_id}/result")
    result = data.get("data", data) if isinstance(data, dict) else {}
    state = (result.get("status") or "").lower()
    if state == "completed":
        audio = _extract_audio(result)
        if not audio:
            job.status = job.Status.FAILED
            job.error = "WaveSpeedAI finished without returning an audio file."
        else:
            job.audio_url = audio
            job.status = job.Status.COMPLETE
            job.error = ""
    elif state in TERMINAL_FAILURES:
        job.status = job.Status.FAILED
        job.error = (result.get("error") or f"Generation {state}.")[:240]
    job.save(update_fields=["audio_url", "status", "error", "updated_at"])
    return job
