# CASI EHPK Proxy Frontend (v1.1.0)

This project contains the Even Realities frontend interface (EHPK) designed for the CASI architecture.

## Architecture

The CASI architecture separates the Even Realities API bridge from the local Android application.
This frontend Application exclusively polls and interacts with the proxy routing services on `art-infra1.tailb6aa6c.ts.net`.

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
3. **Android Client**: The companion Android application exclusively hosts AI models and processes background jobs.

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
