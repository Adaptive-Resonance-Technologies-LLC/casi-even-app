import { useEffect, useState, useRef } from 'react';
import {
  waitForEvenAppBridge,
  EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import './index.css';

const RELAY_BASE = "https://art-infra1.tailb6aa6c.ts.net";
const API_KEY = "casi-ehpk-9a2f7c04b8";

// CASI Android app local HTTP server (GlassesLocalServer)
const CASI_LOCAL_URL = "http://localhost:8080";

// Audio buffering: accumulate PCM before forwarding to relay.
// Glasses deliver 16kHz 16-bit mono → 32000 bytes/second.
// We batch into ~1.5-second windows (48 KB) to reduce HTTP overhead
// while keeping latency acceptable for real-time ASR.
const AUDIO_FLUSH_SIZE = 48000;  // bytes before flush (~1.5s of 16kHz 16-bit)
const AUDIO_FLUSH_MS   = 2000;  // max hold time before force-flush (ms)

// ASR chunk size: smaller chunks sent to Vosk for lower latency
// ~0.5s of audio at 16kHz 16-bit mono = 16000 bytes
const ASR_CHUNK_SIZE = 16000;

const ICON_LABELS = ['C', 'A', 'S', 'I'];
const ICON_NAMES  = ['Clear', 'Listen', 'Settings', 'Info'];

function formatClock(epochSeconds: number): string {
  const estOffset = -4 * 3600;
  const d = new Date((epochSeconds + estOffset) * 1000);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function renderIconBar(selectedIndex: number): string {
  return ICON_LABELS.map((label, i) =>
    i === selectedIndex ? `[${label}]` : ` ${label} `
  ).join('  ');
}

// Helper: wrap a promise with a timeout
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Helper: Uint8Array to base64 (without spread to avoid stack overflow on large arrays)
function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const lastResponseRef = useRef<string>('');
  const lastClockRef = useRef<string>('');
  const bridgeRef = useRef<EvenAppBridge | null>(null);
  const selectedIndexRef = useRef<number>(0);
  const bridgeInitRef = useRef<boolean>(false);

  // Mic activity state
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const isReceivingAudioRef = useRef<boolean>(false);
  const audioActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio buffering state (relay forwarding)
  const audioChunksRef = useRef<Uint8Array[]>([]);
  const audioTotalLengthRef = useRef<number>(0);
  const audioFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioSendingRef = useRef<boolean>(false);

  // ASR state (headless — no HUD display, streaming continues in background)
  const asrListeningRef = useRef<boolean>(true);  // always-on, no toggle

  // ASR chunk buffer (sent more frequently than relay for low latency)
  const asrChunksRef = useRef<Uint8Array[]>([]);
  const asrTotalRef = useRef<number>(0);
  const asrSendingRef = useRef<boolean>(false);

  useEffect(() => {
    // ============================================================
    // Audio forwarding: buffer PCM from glasses → relay → trixie2
    // ============================================================
    function flushAudioBuffer() {
      if (audioSendingRef.current || audioTotalLengthRef.current === 0) return;
      audioSendingRef.current = true;

      const payload = new Uint8Array(audioTotalLengthRef.current);
      let offset = 0;
      for (const chunk of audioChunksRef.current) {
        payload.set(chunk, offset);
        offset += chunk.length;
      }
      
      audioChunksRef.current = [];
      audioTotalLengthRef.current = 0;

      // Fire-and-forget POST to relay
      fetch(`${RELAY_BASE}/glasses-audio`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY, "Content-Type": "application/octet-stream" },
        body: payload,
      })
        .catch(() => {}) // relay down → silently drop; trixie2 will just have a gap
        .finally(() => { audioSendingRef.current = false; });
    }

    // ============================================================
    // ASR forwarding: smaller PCM chunks → CASI Android → Vosk
    // Uses Base64 JSON transport for binary-safe delivery
    // ============================================================
    function flushAsrBuffer() {
      if (asrSendingRef.current || asrTotalRef.current === 0 || !asrListeningRef.current) return;
      asrSendingRef.current = true;

      const payload = new Uint8Array(asrTotalRef.current);
      let offset = 0;
      for (const chunk of asrChunksRef.current) {
        payload.set(chunk, offset);
        offset += chunk.length;
      }

      asrChunksRef.current = [];
      asrTotalRef.current = 0;

      const base64 = uint8ToBase64(payload);

      fetch(`${CASI_LOCAL_URL}/asr-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64 }),
      })
        .catch(() => {})  // ASR offline — silently drop
        .finally(() => { asrSendingRef.current = false; });
    }

    function handleAudioEvent(audioEvent: { audioPcm?: Uint8Array }) {
      if (!audioEvent?.audioPcm) return;

      setIsReceivingAudio(true);
      isReceivingAudioRef.current = true;
      if (audioActiveTimerRef.current) clearTimeout(audioActiveTimerRef.current);
      audioActiveTimerRef.current = setTimeout(() => {
        setIsReceivingAudio(false);
        isReceivingAudioRef.current = false;
      }, 1000);

      // audioPcm is Uint8Array of raw PCM bytes from the SDK
      const pcm = audioEvent.audioPcm;

      // === Relay buffer (large batches for trixie2) ===
      audioChunksRef.current.push(pcm);
      audioTotalLengthRef.current += pcm.length;
      if (audioTotalLengthRef.current >= AUDIO_FLUSH_SIZE) {
        flushAudioBuffer();
      }
      if (audioFlushTimerRef.current) clearTimeout(audioFlushTimerRef.current);
      audioFlushTimerRef.current = setTimeout(flushAudioBuffer, AUDIO_FLUSH_MS);

      // === ASR buffer (smaller chunks for low-latency Vosk) ===
      if (asrListeningRef.current) {
        asrChunksRef.current.push(pcm);
        asrTotalRef.current += pcm.length;
        if (asrTotalRef.current >= ASR_CHUNK_SIZE) {
          flushAsrBuffer();
        }
      }
    }

    // ============================================================
    // Main page: text icon bar + prompt + clock
    // Uses proper SDK classes for correct serialization
    // ============================================================
    function buildMainPage(): CreateStartUpPageContainer {
      return new CreateStartUpPageContainer({
        containerTotalNum: 12,
        textObject: [
          new TextContainerProperty({
            xPosition: 16, yPosition: 8, width: 380, height: 36,
            borderWidth: 0, borderColor: 0, paddingLength: 0,
            containerID: 21, containerName: 'icon-bar',
            content: renderIconBar(selectedIndexRef.current),
            isEventCapture: 1,
          }),
          new TextContainerProperty({
            xPosition: 430, yPosition: 10, width: 140, height: 30,
            borderWidth: 0, borderColor: 0, paddingLength: 0,
            containerID: 23, containerName: 'clock-text',
            content: '--:--:--',
            isEventCapture: 0,
          }),
          ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id => new TextContainerProperty({
            xPosition: 0, yPosition: 0, width: 1, height: 1,
            borderWidth: 0, borderColor: 0, paddingLength: 0,
            containerID: id, containerName: `clear-${id}`,
            content: ' ',
            isEventCapture: 0,
          })),
        ],
      });
    }



    // ============================================================
    // Update icon bar text on glasses
    // ============================================================
    async function updateIconBar() {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      const text = renderIconBar(selectedIndexRef.current);
      const req = new TextContainerUpgrade({
        containerID: 21, containerName: 'icon-bar',
        contentOffset: 0, contentLength: text.length, content: text,
      });
      await bridge.textContainerUpgrade(req);
    }

    // ============================================================
    // Navigate icon bar
    // ============================================================
    async function navigateNext() {
      selectedIndexRef.current = (selectedIndexRef.current + 1) % ICON_LABELS.length;
      await updateIconBar();
      console.log(`> ${ICON_NAMES[selectedIndexRef.current]}`);
    }
    async function navigatePrev() {
      selectedIndexRef.current = (selectedIndexRef.current - 1 + ICON_LABELS.length) % ICON_LABELS.length;
      await updateIconBar();
      console.log(`> ${ICON_NAMES[selectedIndexRef.current]}`);
    }

    // ============================================================
    // Execute the currently selected icon action
    // ============================================================
    async function executeSelectedAction() {
      const idx = selectedIndexRef.current;
      const name = ICON_NAMES[idx];
      const bridge = bridgeRef.current;
      if (!bridge) return;

      console.log(`Exec: ${name}`);

      if (name === 'Clear') {
        lastResponseRef.current = '';
        // Clear ASR on CASI side
        fetch(`${CASI_LOCAL_URL}/asr-clear`, { method: "POST" }).catch(() => {});
        // Clear relay notification
        await fetch(`${RELAY_BASE}/clear-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        }).catch(() => {});
      } else {
        // All other actions (Listen, Settings, Info) — relay interaction event
        await fetch(`${RELAY_BASE}/glasses-interaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
          body: JSON.stringify({ type: "ICON_SELECT", value: name, timestamp: Date.now() })
        }).catch(() => {});
      }
    }

    // ============================================================
    // Dispatch events
    // ============================================================
    function dispatchEvent(eventType: number | string) {
      console.log(`dispatchEvent: ${eventType}`);
      const evtNum = typeof eventType === 'string' ? parseInt(eventType, 10) : eventType;

      switch (evtNum) {
        case 1: navigatePrev(); break;
        case 2: navigateNext(); break;
        case 3: executeSelectedAction(); break;
        case 0: navigateNext(); break;
        default: break;
      }
    }

    // ============================================================
    // Initialize bridge with timeout + retry
    // ============================================================
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const initEvenHub = async () => {
      retryCount++;
      console.log(`Init attempt ${retryCount}/${MAX_RETRIES}...`);
      console.log(`Init attempt ${retryCount}/${MAX_RETRIES}...`);

      try {
        // Phase 1: Acquire bridge with 15s timeout
        const bridge = await withTimeout(
          waitForEvenAppBridge(),
          15000,
          'Bridge acquisition'
        );
        bridgeRef.current = bridge;
        console.log('Bridge acquired. Waiting for launch source...');
        console.log('Bridge acquired. Waiting for launch source...');

        // Wrap initialization in onLaunchSource to prevent bridge desync
        bridge.onLaunchSource(async (source) => {
          if (source !== 'glassesMenu' && source !== 'appMenu') {
            console.log(`Launched from ${source}. Ignoring UI setup.`);
            return;
          }

          try {
            // Phase 2: Create startup page with 10s timeout
            // Uses proper SDK class instances for correct proto serialization
            const result = await withTimeout(
              bridge.createStartUpPageContainer(buildMainPage()),
              10000,
              'Page creation'
            );

            if (result === 0) {
              bridgeInitRef.current = true;
              setStatus('connected');
              console.log('v1.3.7 ready.');
            } else {
              console.log(`Startup FAILED: result=${result}`);
              console.log(`Startup FAILED: result=${result}`);
              setStatus('error');
              return;
            }

            // --- Unified event handler including AUDIO forwarding ---
            bridge.onEvenHubEvent(async (event: EvenHubEvent) => {
              try {
                if (event.textEvent) {
                  if (event.textEvent.eventType !== undefined) dispatchEvent(event.textEvent.eventType);
                  return;
                }

                if (event.sysEvent) {
                  const se = event.sysEvent;
                  if (se.imuData) return;
                  if (se.eventType !== undefined) dispatchEvent(se.eventType);
                  return;
                }

                // AUDIO: buffer and forward to relay + CASI ASR
                if (event.audioEvent) {
                  handleAudioEvent(event.audioEvent);
                  return;
                }
              } catch (err: unknown) {
                console.log(`EVT_ERR: ${err instanceof Error ? err.message : String(err)}`);
              }
            });

            // Phase 3: Enable microphone AFTER page is stable
            try {
              await bridge.audioControl(true);
              console.log('v1.3.7 — Mic ON.');
            } catch {
              // Audio enable failure is non-fatal — UI still works
              console.log('v1.3.7 ready (mic failed).');
            }

            // Emit the ready marker AFTER all handlers and bridge configurations are fully attached
            console.log('READY: createStartUpPageContainer');
          } catch (initErr: unknown) {
            console.log(`Sub-init err: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
          }
        });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`INIT_ERR: ${msg}`);

        if (retryCount < MAX_RETRIES) {
          console.log(`Retrying in 3s... (${retryCount}/${MAX_RETRIES})`);
          setTimeout(initEvenHub, 3000);
        } else {
          setStatus('error');
          console.log(`FAILED after ${MAX_RETRIES} attempts: ${msg}`);
        }
      }
    };

    initEvenHub();

    // === Polling loop: clock only (no transcript/prompt display) ===
    const interval = setInterval(async () => {
      if (!bridgeInitRef.current) return;

      try {
        const remoteRes = await fetch(`${RELAY_BASE}/glasses-response`, {
          headers: { "X-API-Key": API_KEY }
        }).catch(() => null);

        let serverTime = 0;
        if (remoteRes && remoteRes.ok) {
          const remoteData = await remoteRes.json();
          serverTime = remoteData.server_time || 0;
        }

        const bridge = bridgeRef.current;
        if (!bridge) return;

        if (serverTime) {
          const clockStr = (isReceivingAudioRef.current ? "MIC " : "") + formatClock(serverTime);
          if (clockStr !== lastClockRef.current) {
            const clockReq = new TextContainerUpgrade({
              containerID: 23, containerName: 'clock-text', contentOffset: 0,
              contentLength: clockStr.length, content: clockStr,
            });
            await bridge.textContainerUpgrade(clockReq);
            lastClockRef.current = clockStr;
          }
        }

        setStatus('connected');
      } catch (e: unknown) {
        setStatus('error');
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      if (audioFlushTimerRef.current) clearTimeout(audioFlushTimerRef.current);
      // Flush remaining audio on cleanup
      flushAudioBuffer();
      flushAsrBuffer();
    };
  }, []);

  return (
    <>
      <div className="logo-header">
        <img src="/logo.png" alt="CASI Logo" className="logo" />
        <div className="flex-col">
          <h1 className="title-very-large">CASI Bridge</h1>
          <p className="subtitle-normal">Even Hub Companion — v1.3.7</p>
        </div>
      </div>

      <div className="even-card even-card-section">
        <h2 className="title-normal">Status</h2>
        <div className="status-badge">
          <div className={`status-indicator ${status}`}></div>
          <span className="subtitle-normal">{status === 'connecting' ? 'Initializing...' : status === 'connected' ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="status-badge" style={{ marginTop: '8px' }}>
          <div className={`status-indicator ${isReceivingAudio ? 'connected' : 'error'}`}></div>
          <span className="subtitle-normal">{isReceivingAudio ? 'Mic Active' : 'Mic Idle'}</span>
        </div>
      </div>
    </>
  );
}

export default App;
