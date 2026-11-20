"""Deterministic local preview audio.

Renders short instrumental loops to real WAV files. These are synth sketches
produced on this machine: they exist so the library, the playbar, and imported
studio audio all play real sound without an external service. They are never
presented as AI-generated songs; the UI labels them "Local preview".
"""

import hashlib
import math
import os
import random
import re
import wave
from pathlib import Path

from django.conf import settings

SAMPLE_RATE = 16000
DEFAULT_SECONDS = 14
MAX_SECONDS = 30
TABLE_SIZE = 2048

_TIMBRES = {
    "pad": {1: 1.0, 2: 0.32, 3: 0.16, 5: 0.05},
    "pluck": {1: 1.0, 2: 0.5, 3: 0.25, 4: 0.12},
    "bass": {1: 1.0, 2: 0.22, 3: 0.1},
    "lead": {1: 1.0, 3: 0.2, 5: 0.08},
}
_TABLES = {}


def _table(timbre):
    if timbre not in _TABLES:
        partials = _TIMBRES[timbre]
        total = sum(abs(weight) for weight in partials.values()) or 1.0
        _TABLES[timbre] = [
            sum(weight * math.sin(2 * math.pi * harmonic * index / TABLE_SIZE) for harmonic, weight in partials.items()) / total
            for index in range(TABLE_SIZE)
        ]
    return _TABLES[timbre]


def seed_for(text):
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


def _frequency(midi):
    return 440.0 * (2 ** ((midi - 69) / 12))


def _tone(buffer, start, duration, frequency, amplitude, timbre="pad", attack=0.01, release=0.08):
    """Add one synthesised note into a float buffer."""
    begin = int(start * SAMPLE_RATE)
    length = min(len(buffer) - begin, int(duration * SAMPLE_RATE))
    if begin >= len(buffer) or length <= 0:
        return
    table = _table(timbre)
    step = frequency * TABLE_SIZE / SAMPLE_RATE
    attack_samples = max(1, int(attack * SAMPLE_RATE))
    release_samples = max(1, int(release * SAMPLE_RATE))
    phase = 0.0
    for index in range(length):
        envelope = 1.0
        if index < attack_samples:
            envelope = index / attack_samples
        tail = length - index
        if tail < release_samples:
            envelope *= tail / release_samples
        buffer[begin + index] += amplitude * envelope * table[int(phase) % TABLE_SIZE]
        phase += step


def _noise(buffer, start, duration, amplitude, decay, rng):
    begin = int(start * SAMPLE_RATE)
    length = min(len(buffer) - begin, int(duration * SAMPLE_RATE))
    if begin >= len(buffer) or length <= 0:
        return
    for index in range(length):
        envelope = (1 - index / length) ** decay
        buffer[begin + index] += amplitude * envelope * (rng.random() * 2 - 1)


def _kick(buffer, start, amplitude=0.5):
    begin = int(start * SAMPLE_RATE)
    length = min(len(buffer) - begin, int(0.22 * SAMPLE_RATE))
    if begin >= len(buffer) or length <= 0:
        return
    phase = 0.0
    for index in range(length):
        progress = index / length
        frequency = 120 - 78 * progress
        phase += 2 * math.pi * frequency / SAMPLE_RATE
        envelope = (1 - progress) ** 2.4
        buffer[begin + index] += amplitude * envelope * math.sin(phase)


def render(seed_text, seconds=DEFAULT_SECONDS):
    """Return raw 16-bit mono PCM bytes for a deterministic loop."""
    seconds = max(4, min(MAX_SECONDS, int(seconds or DEFAULT_SECONDS)))
    rng = random.Random(seed_for(seed_text))
    total = int(seconds * SAMPLE_RATE)
    buffer = [0.0] * total

    root = rng.choice([43, 45, 46, 48, 50, 51, 52, 53])
    scale = [0, 2, 3, 5, 7, 8, 10] if rng.random() < 0.78 else [0, 2, 4, 5, 7, 9, 11]
    bpm = rng.choice([72, 78, 84, 90, 96, 104, 112])
    beat = 60.0 / bpm
    bar = beat * 4
    progression = rng.choice([[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3], [0, 6, 3, 4]])
    bars = max(1, math.ceil(seconds / bar))

    def chord_notes(degree):
        notes = []
        for step in (0, 2, 4, 6):
            index = degree + step
            octave = 12 * (index // len(scale))
            notes.append(root + 12 + scale[index % len(scale)] + octave)
        return notes

    for bar_index in range(bars):
        start = bar_index * bar
        if start >= seconds:
            break
        notes = chord_notes(progression[bar_index % len(progression)])

        # Sustained pad across the bar.
        for offset, midi in enumerate(notes[:3]):
            _tone(buffer, start, min(bar, seconds - start), _frequency(midi), 0.11,
                  "pad", attack=0.25, release=min(0.6, bar / 3))
        # Bass on beats one and three.
        for beat_index in (0, 2):
            _tone(buffer, start + beat_index * beat, beat * 1.7, _frequency(notes[0] - 12), 0.26,
                  "bass", attack=0.01, release=0.16)
        # Arpeggio in eighths.
        pattern = [0, 1, 2, 3, 2, 1, 3, 1]
        for eighth in range(8):
            note = notes[pattern[eighth] % len(notes)] + 12
            _tone(buffer, start + eighth * beat / 2, beat * 0.75, _frequency(note), 0.075,
                  "pluck", attack=0.004, release=0.12)

    # Percussion from the second bar onward so the intro breathes.
    for bar_index in range(1, bars):
        start = bar_index * bar
        if start >= seconds:
            break
        for beat_index in range(4):
            at = start + beat_index * beat
            if at >= seconds:
                break
            if beat_index in (0, 2):
                _kick(buffer, at, 0.42)
            if beat_index in (1, 3):
                _noise(buffer, at, 0.16, 0.13, 2.4, rng)
            _noise(buffer, at + beat / 2, 0.05, 0.045, 3.0, rng)

    peak = max((abs(value) for value in buffer), default=0.0) or 1.0
    gain = 0.86 / peak
    fade_in = int(0.06 * SAMPLE_RATE)
    fade_out = int(0.35 * SAMPLE_RATE)
    frames = bytearray()
    for index, value in enumerate(buffer):
        sample = value * gain
        if index < fade_in:
            sample *= index / fade_in
        tail = total - index
        if tail < fade_out:
            sample *= tail / fade_out
        # Soft clip keeps dense chords from clicking.
        sample = math.tanh(sample * 1.15)
        frames += int(max(-1.0, min(1.0, sample)) * 32767).to_bytes(2, "little", signed=True)
    return bytes(frames)


def _file_name(name):
    cleaned = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:64] or "preview"
    return f"{cleaned}-{seed_for(name) % 100000:05d}.wav"


def ensure_preview(name, seconds=DEFAULT_SECONDS):
    """Render (once) and return the path of a preview WAV for a name."""
    directory = Path(settings.MEDIA_ROOT) / "previews"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / _file_name(name)
    if path.exists() and path.stat().st_size > 44:
        return path
    temporary = path.with_suffix(".tmp")
    with wave.open(str(temporary), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(render(name, seconds))
    os.replace(temporary, path)
    return path
