import { useEffect, useState, useRef } from 'react';
import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import './index.css';

const RELAY_BASE = "https://art-infra1.tailb6aa6c.ts.net";

const ICON_LABELS = ['C', 'A', 'S', 'I'];
const ICON_NAMES  = ['Clear', 'Menu', 'Settings', 'Info'];

const PROTOCOLS = [
  'Alpha', 'Bravo', 'Gamma', 'Delta', 'Epsilon',
  'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa',
  'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron',
  'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon',
];

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

function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string>('Initializing...');
  const lastModeRef = useRef<string>('idle');
  const lastResponseRef = useRef<string>('');
  const lastClockRef = useRef<string>('');
  const isSubmenuRef = useRef<boolean>(false);
  const bridgeRef = useRef<any>(null);
  const selectedIndexRef = useRef<number>(0);
  const bridgeInitRef = useRef<boolean>(false);

  useEffect(() => {
    // ============================================================
    // Main page: text icon bar (no border) + prompt + clock
    // ============================================================
    function mainPageReq(): any {
      return {
        containerTotalNum: 3,
        textObject: [
          {
            // Icon bar — no border, clean look
            xPosition: 16,
            yPosition: 8,
            width: 380,
            height: 36,
            borderWidth: 0,
            containerID: 1,
            containerName: 'icon-bar',
            content: renderIconBar(selectedIndexRef.current),
            isEventCapture: 1,
            toJson: function() { return this; }
          },
          {
            // Main prompt / notifications
            xPosition: 30,
            yPosition: 60,
            width: 516,
            height: 220,
            borderWidth: 0,
            containerID: 2,
            containerName: 'prompt-text',
            content: ' ',
            isEventCapture: 0,
            toJson: function() { return this; }
          },
          {
            // Clock
            xPosition: 430,
            yPosition: 10,
            width: 140,
            height: 30,
            borderWidth: 0,
            containerID: 3,
            containerName: 'clock-text',
            content: '--:--:--',
            isEventCapture: 0,
            toJson: function() { return this; }
          }
        ],
        toJson: function() { return this; }
      };
    }

    // ============================================================
    // Submenu page: protocol list + hint
    // ============================================================
    function submenuPageReq(): any {
      return {
        containerTotalNum: 2,
        listObject: [
          {
            xPosition: 16,
            yPosition: 8,
            width: 544,
            height: 260,
            borderWidth: 1,
            borderColor: 15,
            borderRadius: 6,
            paddingLength: 4,
            containerID: 10,
            containerName: 'proto-list',
            itemContainer: {
              itemCount: PROTOCOLS.length,
              itemWidth: 0,
              isItemSelectBorderEn: 1,
              itemName: PROTOCOLS,
            },
            isEventCapture: 1,
            toJson: function() { return this; }
          }
        ],
        textObject: [
          {
            xPosition: 16,
            yPosition: 272,
            width: 544,
            height: 14,
            borderWidth: 0,
            containerID: 11,
            containerName: 'status-text',
            content: 'DblTap=exec  Swipe=scroll',
            isEventCapture: 0,
            toJson: function() { return this; }
          }
        ],
        toJson: function() { return this; }
      };
    }

    // ============================================================
    // Update icon bar text on glasses
    // ============================================================
    async function updateIconBar() {
      const bridge = bridgeRef.current;
      if (!bridge || isSubmenuRef.current) return;
      const text = renderIconBar(selectedIndexRef.current);
      const req: any = {
        containerID: 1, containerName: 'icon-bar',
        contentOffset: 0, contentLength: text.length, content: text,
        toJson: function() { return this; }
      };
      await bridge.textContainerUpgrade(req);
    }

    // ============================================================
    // Navigate icon bar: advance selection
    // ============================================================
    async function navigateNext() {
      selectedIndexRef.current = (selectedIndexRef.current + 1) % ICON_LABELS.length;
      await updateIconBar();
      setDebugLog(`> ${ICON_NAMES[selectedIndexRef.current]}`);
    }
    async function navigatePrev() {
      selectedIndexRef.current = (selectedIndexRef.current - 1 + ICON_LABELS.length) % ICON_LABELS.length;
      await updateIconBar();
      setDebugLog(`> ${ICON_NAMES[selectedIndexRef.current]}`);
    }

    // ============================================================
    // Execute the currently selected icon action
    // ============================================================
    async function executeSelectedAction() {
      const idx = selectedIndexRef.current;
      const name = ICON_NAMES[idx];
      const bridge = bridgeRef.current;
      if (!bridge) return;

      setDebugLog(`Exec: ${name}`);

      if (name === 'Clear') {
        const clearReq: any = {
          containerID: 2, containerName: 'prompt-text',
          contentOffset: 0, contentLength: 0, content: " ",
          toJson: function() { return this; }
        };
        await bridge.textContainerUpgrade(clearReq);
        lastResponseRef.current = '';
        await fetch(`${RELAY_BASE}/clear-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": "casi-ehpk-9a2f7c04b8" },
        }).catch(() => {});
      } else if (name === 'Menu') {
        await enterSubmenu();
      } else {
        const actionMsg = `Action: ${name}`;
        const actionReq: any = {
          containerID: 2, containerName: 'prompt-text',
          contentOffset: 0, contentLength: actionMsg.length, content: actionMsg,
          toJson: function() { return this; }
        };
        await bridge.textContainerUpgrade(actionReq);
        await fetch(`${RELAY_BASE}/glasses-interaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": "casi-ehpk-9a2f7c04b8" },
          body: JSON.stringify({ type: "ICON_SELECT", value: name, timestamp: Date.now() })
        }).catch(() => {});
      }
    }

    // ============================================================
    // Submenu enter/exit
    // ============================================================
    async function enterSubmenu() {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      isSubmenuRef.current = true;
      setDebugLog('Submenu...');
      try {
        await bridge.rebuildPageContainer(submenuPageReq());
      } catch (e: any) {
        setDebugLog(`Sub ERR: ${e.message || e}`);
      }
    }

    async function exitSubmenu() {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      isSubmenuRef.current = false;
      setDebugLog('Main view');
      try {
        await bridge.rebuildPageContainer(mainPageReq());
      } catch (e: any) {
        setDebugLog(`Main ERR: ${e.message || e}`);
      }
    }

    async function executeProtocol(name: string) {
      const bridge = bridgeRef.current;
      if (!bridge) return;
      const msg = `Executed: ${name}`;
      setDebugLog(msg);
      try {
        const statusReq: any = {
          containerID: 11, containerName: 'status-text',
          contentOffset: 0, contentLength: msg.length, content: msg,
          toJson: function() { return this; }
        };
        await bridge.textContainerUpgrade(statusReq);
      } catch (_) {}
      await fetch(`${RELAY_BASE}/glasses-interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "casi-ehpk-9a2f7c04b8" },
        body: JSON.stringify({ type: "PROTOCOL_EXEC", value: name, timestamp: Date.now() })
      }).catch(() => {});
      setTimeout(() => exitSubmenu(), 1200);
    }

    // ============================================================
    // Dispatch any event (regardless of source: textEvent or sysEvent)
    // ============================================================
    function dispatchEvent(eventType: number | string) {
      const evtNum = typeof eventType === 'string' ? parseInt(eventType, 10) : eventType;

      if (isSubmenuRef.current) {
        // In submenu: double-tap goes back
        if (evtNum === 3) { exitSubmenu(); }
        return;
      }

      // Main view icon bar navigation
      switch (evtNum) {
        case 1: // SCROLL_TOP — previous
          navigatePrev();
          break;
        case 2: // SCROLL_BOTTOM — next
          navigateNext();
          break;
        case 3: // DOUBLE_CLICK — execute selected action
          executeSelectedAction();
          break;
        case 0: // CLICK — also try to navigate forward (since single tap may work sometimes)
          navigateNext();
          break;
        default:
          break;
      }
    }

    // ============================================================
    // Initialize bridge
    // ============================================================
    const initEvenHub = async () => {
      try {
        const bridge = await waitForEvenAppBridge();
        bridgeRef.current = bridge;

        const result = await bridge.createStartUpPageContainer(mainPageReq());

        if (result === 0) {
          bridgeInitRef.current = true;
          setStatus('connected');
          setDebugLog('v1.1.40 ready. Swipe=nav, DblTap=select.');
        } else {
          setDebugLog(`Startup FAILED: result=${result}`);
          setStatus('error');
          return;
        }

        // --- Unified event handler ---
        bridge.onEvenHubEvent(async (event: any) => {
          try {
            // LIST EVENTS (submenu): double-tap to execute protocol
            if (event.listEvent) {
              const le = event.listEvent;
              const evtType = le.eventType;
              if (evtType === OsEventTypeList.DOUBLE_CLICK_EVENT || evtType === 3) {
                if (isSubmenuRef.current) {
                  const protoName = le.currentSelectItemName || PROTOCOLS[le.currentSelectItemIndex] || '?';
                  await executeProtocol(protoName);
                }
              }
              return;
            }

            // TEXT EVENTS (main view icon bar)
            if (event.textEvent) {
              dispatchEvent(event.textEvent.eventType);
              return;
            }

            // SYS EVENTS (fallback: firmware may route gestures here)
            if (event.sysEvent) {
              const se = event.sysEvent;
              if (se.imuData) return;
              dispatchEvent(se.eventType);
              return;
            }

            if (event.audioEvent) return;
          } catch (err: any) {
            setDebugLog(`EVT_ERR: ${err.message || err}`);
          }
        });

        await bridge.audioControl(true);
      } catch (err: any) {
        setDebugLog(`INIT_ERR: ${err.message || err}`);
        setStatus('error');
      }
    };

    initEvenHub();

    // === Polling loop (paused during submenu) ===
    const interval = setInterval(async () => {
      if (!bridgeInitRef.current || isSubmenuRef.current) return;

      try {
        const remoteRes = await fetch(`${RELAY_BASE}/glasses-response`, {
          headers: { "X-API-Key": "casi-ehpk-9a2f7c04b8" }
        }).catch(() => null);

        let mergedData = {
          response: "", mode: "normal", timer_end: 0, server_time: 0, misc_notification: "",
        };

        if (remoteRes && remoteRes.ok) {
          const remoteData = await remoteRes.json();
          mergedData.timer_end = remoteData.timer_end || 0;
          mergedData.server_time = remoteData.server_time || 0;
          mergedData.misc_notification = remoteData.misc_notification || "";
          if (remoteData.response) {
            mergedData.response = remoteData.response;
            mergedData.mode = remoteData.mode || "prompter";
          }
        }

        const bridge = bridgeRef.current;
        if (!bridge) return;

        if (mergedData.mode === 'prompter') {
          if (mergedData.response !== lastResponseRef.current) {
            const upgradeReq: any = {
              containerID: 2, containerName: 'prompt-text', contentOffset: 0,
              contentLength: mergedData.response ? mergedData.response.length : 0,
              content: mergedData.response || " ", toJson: function() { return this; }
            };
            await bridge.textContainerUpgrade(upgradeReq);
            lastResponseRef.current = mergedData.response;
          }
        } else if (lastModeRef.current === 'prompter' && mergedData.mode === 'normal') {
          const clearReq: any = {
            containerID: 2, containerName: 'prompt-text', contentOffset: 0,
            contentLength: 0, content: " ", toJson: function() { return this; }
          };
          await bridge.textContainerUpgrade(clearReq);
          lastResponseRef.current = '';
        }

        if (mergedData.server_time) {
          const clockStr = formatClock(mergedData.server_time);
          if (clockStr !== lastClockRef.current) {
            const clockReq: any = {
              containerID: 3, containerName: 'clock-text', contentOffset: 0,
              contentLength: clockStr.length, content: clockStr, toJson: function() { return this; }
            };
            await bridge.textContainerUpgrade(clockReq);
            lastClockRef.current = clockStr;
          }
        }

        lastModeRef.current = mergedData.mode;
        setStatus('connected');
      } catch (e: any) {
        setStatus('error');
        setErrorDetails(e && e.message ? e.message : e.toString());
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="logo-header">
        <img src="/logo.png" alt="CASI Logo" className="logo" />
        <div className="flex-col">
          <h1 className="title-very-large">CASI Bridge</h1>
          <p className="subtitle-normal">Even Hub Companion</p>
        </div>
      </div>

      <div className="even-card even-card-section">
        <h2 className="title-normal">Connection Status</h2>
        <div className="status-badge">
          <div className={`status-indicator ${status}`}></div>
          <span className="subtitle-normal">{status === 'connecting' ? 'Initializing Bridge...' : status === 'connected' ? 'Securely Connected' : (errorDetails ? `Unreachable (${errorDetails})` : 'CASI Host Unreachable')}</span>
        </div>
      </div>

      <div className="even-card">
        <h2 className="title-normal">Protocol Log (v1.1.40)</h2>
        <p className="detail-normal info-text">
          Swipe=navigate, DblTap=select. [C]=Clear, [A]=Actions, [S]=Settings, [I]=Info.
        </p>
        <div className="detail-normal" style={{marginTop: '8px', padding: '8px', background: '#1a1a1a', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', color: '#4fc3f7'}}>
          {debugLog}
        </div>
      </div>
    </>
  );
}

export default App;
