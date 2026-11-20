# Cadence Studio

An original Django music-creation app inspired by the workflow of a hosted AI music service. It has three surfaces, each at its own URL:

| Route | Surface | What it does |
| --- | --- | --- |
| `/` | Home | Discover feed: prompt hero that hands off to Create, artist spotlight carousel, For You / Staff Picks / Best of Cadence rails, style cloud, New Albums grid, global playbar |
| `/create` | Create | Songs/Speech and Simple/Advanced composer, Audio/Voice/Inspo tools, lyrics editor with named drafts and a local draft writer, styles with saved prompts, More Options (vocal gender, duration, Max Mode, weirdness, style influence, variety, personalize), your clip library with search, filters, sort, list/grid view and pagination |
| `/studio` | Studio | Multitrack timeline with draggable clips, transport and playhead, per-track mute/solo/volume, track rename/remove, zoom, import, BPM and master level, studio prompt bar for arrangement directions, creative companion panel, project list, JSON export |

The brand, copy, layout, colors, and interface are distinct from the site that inspired the workflow.

## Run locally

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Visit http://127.0.0.1:8000/, then http://127.0.0.1:8000/create and http://127.0.0.1:8000/studio. Use the account control to register or sign in; passwords must contain at least eight characters. Before deployment, set a random `DJANGO_SECRET_KEY`, use `DJANGO_DEBUG=0`, configure `DJANGO_ALLOWED_HOSTS`, serve `/media/` from your web server, and use a production database and HTTPS. The included SQLite configuration is intended for local development, not a multi-process production deployment.

Django caches templates in this configuration, so restart the development server after editing a template.

## Audio

Two providers share one playback path, so the playbar, clip library, and studio all play real audio files:

| Provider | When it is active | What you hear |
| --- | --- | --- |
| Local preview engine | Default, no account needed | A deterministic instrumental loop rendered as a WAV on this machine. Labelled "Local preview" in the UI. |
| WaveSpeedAI | `WAVESPEED_API_KEY` is set | A generated song. Lyrics use [SongGeneration](https://wavespeed.ai/models/wavespeed-ai/song-generation); prompts without lyrics use [Sonilo Text-to-Music](https://wavespeed.ai/models/sonilo/text-to-music). |

To enable AI songs, copy `.env.example` to `.env` and set `WAVESPEED_API_KEY` (create one at https://wavespeed.ai). `.env` is git-ignored and read by `cadence/settings.py`; the key is only used by the Django server and never reaches the browser. Restart the server after changing it, then check the provider chip at the top of `/create`: it switches from "Local preview engine" to "WaveSpeedAI".

Generation is asynchronous on WaveSpeedAI. `POST /api/jobs/` returns a running job, and `GET /api/jobs/{id}/` polls the provider, stores `audio_url` when the task completes, and reports failures in `error`. The Create page polls newly submitted clips and updates the badge when they are ready. A submitted task is never retried automatically, because a retry can create a second billed task.

Curated cards on Home play locally rendered previews; their titles and artists are original sample content, not a real catalogue. Studio clips play their own preview until you import audio or open a generated clip, at which point the real file is used. Imported files use a session-only object URL and are not uploaded.

Speech needs a voice model and is not connected; submitting the Speech tab reports that plainly instead of fabricating audio. Reference audio and the "Help me start a draft" writer remain local-only.

## Saving

- **Signed in:** Create writes clips to `/api/jobs/`; Studio autosaves the current arrangement to `/api/projects/` and lists saved projects in the sidebar. Both are filtered to the signed-in user on the server.
- **Guest:** composer settings, lyric drafts, saved styles, and clips are kept in `localStorage` for that browser only. Guest clips do not render audio because generation requires a server account.

## REST API

Session-authenticated DRF endpoints under `/api/`:

- `POST /api/auth/register/`, `POST /api/auth/login/`, `POST /api/auth/logout/`
- `GET /api/provider/` — public description of the active audio provider
- `GET|POST /api/projects/`; `GET|PATCH|DELETE /api/projects/{uuid}/`
- `GET|POST /api/jobs/`; `GET|PATCH|DELETE /api/jobs/{uuid}/`
- `POST /api/jobs/{uuid}/refine/` with `{ "instruction": "more space around the keys" }`
- `GET /preview/{name}.wav` — cached local preview audio

Projects and jobs are filtered by the authenticated user on every request. Django session auth enforces CSRF checks on unsafe requests.

## Checks

```bash
python manage.py check
python manage.py test studioapp
node --check static/app.js
node --check static/home.js
node --check static/create.js
node --check static/studio.js
```
