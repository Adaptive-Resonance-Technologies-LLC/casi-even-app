# CASI EHPK Proxy Frontend (v1.3.2)

This project contains the Even Realities frontend interface (EHPK) designed for the CASI architecture.

## Architecture

The CASI architecture separates the Even Realities API bridge from the local Android application.
This frontend Application exclusively polls and interacts with the proxy routing services on `art-infra1.tailb6aa6c.ts.net`.

### Operating Mode (v1.3.2 — Headless ASR)

As of v1.3.2, the EHPK operates in a **"start-and-forget" headless** mode:
- **No visible transcription** — the ASR transcript overlay on the HUD has been removed
- **Silent audio streaming** — microphone audio continues to relay silently to both the Android Vosk engine and the Trixie2 Hailo NPU
- **Automatic dual-persistence** — both raw audio and transcripts are automatically persisted to `lb-supabase` whenever the mic is active

The phone dashboard shows only:
1. Connection status (bridge link)
2. Mic stream status (active/inactive)

### HUD Layout (576 × 288 canvas)

```
┌──────────────────────────────────────────────────────────┐
│ CASI:       [misc notification]            HH:MM:SS     │  ← top bar (y=20)
│ (ID 3)          (ID 4)                      (ID 2)      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         Main Notification / Prompter Text          │  │  ← body (ID 1, y=65)
│  │              Double-tap to dismiss                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

| Container | ID | Position | Size | Content |
|---|---|---|---|---|
| Status | 3 | x=10, y=20 | 140×40 | `"CASI:"` (static label) |
| Misc | 4 | x=160, y=20 | 250×40 | Short notifications from relay |
| Clock | 2 | x=440, y=20 | 136×40 | `HH:MM:SS` EST from art-infra1 |
| Main | 1 | x=30, y=65 | 516×210 | Notification text (double-tap clears) |

### Communication Flow
1. **Frontend**: The React application polls `https://art-infra1.tailb6aa6c.ts.net/glasses-response` every 1 second for text, clock, and notification data.
2. **Backend Relay**: The Python FastAPI server on `art-infra1:8923` handles state management and CORS.
3. **Android Client**: The companion Android application hosts the Vosk ASR engine, buffers raw audio, and pushes both transcripts and audio chunks to `lb-supabase` automatically.
4. **Trixie2 (Hailo NPU)**: Audio is also relayed to the Hailo-8 NPU for Whisper-based ASR transcription, writing to the same Supabase tables with engine tag `HAILO_NPU`.

### Data Persistence (v1.3.2)

| Destination | Data | Engine Tag |
|---|---|---|
| Supabase `asr_sessions` | Session metadata (start/end, status) | `VOSK_ON_DEVICE` |
| Supabase `asr_transcripts` | Final transcript segments | `VOSK_ON_DEVICE` / `HAILO_NPU` |
| Supabase `asr_audio_chunks` | Raw PCM audio (30s chunks, hex-encoded BYTEA) | `VOSK_ON_DEVICE` |
| SilverBullet Wiki | Incremental session transcript (markdown) | N/A |

### Relay API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/glasses-response` | Poll: returns `response`, `server_time`, `misc_notification`, `mode`, `timer_end` |
| `POST` | `/inject-markdown` | Inject main notification text (`{"response": "..."}`) |
| `POST` | `/inject-misc` | Inject short misc notification (`{"text": "..."}`) |
| `POST` | `/inject-timer` | Set countdown timer (`{"duration_seconds": N}`) |
| `POST` | `/clear-notification` | Clear main notification (called on double-tap dismiss) |
| `POST` | `/glasses-interaction` | Report glasses input events |
| `GET` | `/glasses-interaction` | Dequeue next interaction event |

### Interactions
- **Double-tap**: Clears the main notification (container 1) and resets server-side state via `POST /clear-notification`
- **Other events**: Forwarded to relay via `POST /glasses-interaction`

## Version History

| Version | Changes |
|---|---|
| 1.3.7 | Shifted active UI container IDs to 21/23 and forced rendering of empty containers for IDs 1-10 to reliably clear stuck legacy UI elements from the glasses cache. |
| 1.3.6 | Explicitly initialize and clear legacy UI containers (like transcripts) to purge them from glasses cache. |
| 1.3.5 | Fixed versioning sync issue and ensured headless ASR is properly deployed. |
| 1.3.2 | Headless ASR — removed HUD transcription, added Supabase dual-persistence (transcripts + raw audio) |
| 1.3.1 | Bug fixes for bridge initialization and appMenu launch handling |
| 1.3.0 | Added on-device Vosk ASR with real-time HUD transcription and SilverBullet sync |
| 1.1.0 | Initial Even Hub proxy frontend with notification display |

## Deployment Notes

To upload a new version:
1. Bump version locally in `package.json` and `app.json`
2. `npm run build:ehpk`
3. Send `.ehpk` directly to Google Drive `For Upload to sb1`
4. Commit to `casi-even-app` repository on GitHub

### CORS Configuration
When setting up new relay servers for the EHPK frontend, verify the relay explicitly allows Cross-Origin requests. `fetch()` requests executed from the embedded WebView engine inside the Even Realities companion app will fail completely and block rendering if the target server does not output standard `Access-Control-Allow-Origin: *` headers.

### Tailscale Serve Configuration
The relay must be proxied via `tailscale serve --set-path / http://localhost:8923` on `art-infra1`. The serve routing targets port **8923** specifically — if this is misconfigured (e.g., pointing to 8924), external requests will return 502 Bad Gateway while the relay responds fine locally.

