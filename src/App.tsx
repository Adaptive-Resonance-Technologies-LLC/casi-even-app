import { useEffect, useState, useRef } from 'react';
import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import './index.css';

const RELAY_BASE = "https://art-infra1.tailb6aa6c.ts.net";

function formatClock(epochSeconds: number): string {
  // EST = UTC − 4h
  const estOffset = -4 * 3600;
  const d = new Date((epochSeconds + estOffset) * 1000);
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const s = d.getUTCSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const lastModeRef = useRef<string>('idle');
  const lastResponseRef = useRef<string>('');
  const lastClockRef = useRef<string>('');
  const lastMiscRef = useRef<string>('');

  useEffect(() => {
    let bridgeInitialized = false;
    
    const initEvenHub = async () => {
      try {
        const bridge = await waitForEvenAppBridge();
        
        const createReq: any = {
          containerTotalNum: 4,
          textObject: [
            {
              // Container 1: Main notification / prompter (bottom area)
              xPosition: 30,
              yPosition: 65,
              width: 516,
              height: 210,
              borderWidth: 0,
              containerID: 1,
              containerName: 'prompt-text',
              content: ' ',
              isEventCapture: 1,
              toJson: function() { return this; }
            },
            {
              // Container 2: Infrastructure clock (top right)
              xPosition: 440,
              yPosition: 20,
              width: 136,
              height: 40,
              borderWidth: 0,
              containerID: 2,
              containerName: 'clock-text',
              content: '--:--:--',
              isEventCapture: 0,
              toJson: function() { return this; }
            },
            {
              // Container 3: Status label (top left)
              xPosition: 10,
              yPosition: 20,
              width: 140,
              height: 40,
              borderWidth: 0,
              containerID: 3,
              containerName: 'status-text',
              content: 'CASI:',
              isEventCapture: 0,
              toJson: function() { return this; }
            },
            {
              // Container 4: Misc short notifications (top center)
              xPosition: 160,
              yPosition: 20,
              width: 250,
              height: 40,
              borderWidth: 0,
              containerID: 4,
              containerName: 'misc-text',
              content: ' ',
              isEventCapture: 0,
              toJson: function() { return this; }
            }
          ],
          toJson: function() { return this; }
        };

        await bridge.createStartUpPageContainer(createReq);
        bridgeInitialized = true;
        setStatus('connected');

        // --- Event handler: interactions + double-tap dismiss ---
        bridge.onEvenHubEvent(async (event: any) => {
           try {
               let interactionType = null;

               if (event.textEvent && event.textEvent.eventType !== undefined) {
                   interactionType = event.textEvent.eventType;
               } else if (event.sysEvent && event.sysEvent.eventType !== undefined) {
                   interactionType = event.sysEvent.eventType;
               }
               
               // Double-tap dismiss: clear main notification
               if (interactionType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
                   const clearReq: any = {
                      containerID: 1,
                      containerName: 'prompt-text',
                      contentOffset: 0,
                      contentLength: 0,
                      content: " ",
                      toJson: function() { return this; }
                   };
                   await bridge.textContainerUpgrade(clearReq);
                   lastResponseRef.current = '';

                   // Tell relay to clear server-side state
                   await fetch(`${RELAY_BASE}/clear-notification`, {
                       method: "POST",
                       headers: { "Content-Type": "application/json" },
                   }).catch(() => {});
                   return;
               }

               // Forward other interactions to relay
               if (interactionType !== null) {
                   await fetch(`${RELAY_BASE}/glasses-interaction`, {
                       method: "POST",
                       headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ type: interactionType, timestamp: Date.now() })
                   });
               }
           } catch (err) {
               console.error("Interaction push error", err);
           }
        });

        await bridge.audioControl(true);
      } catch (err) {
        console.error("Even Hub Bridge failed to initialize", err);
      }
    };
    
    initEvenHub();

    const interval = setInterval(async () => {
      try {
        const remoteRes = await fetch(`${RELAY_BASE}/glasses-response`).catch(() => null);

        let mergedData = {
          response: "",
          mode: "normal",
          timer_end: 0,
          server_time: 0,
          misc_notification: "",
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
        
        if (bridgeInitialized) {
            const bridge = await waitForEvenAppBridge();

            // --- Primary Text Routing (Container 1: Main notification) ---
            if (mergedData.mode === 'prompter') {
                if (mergedData.response !== lastResponseRef.current) {
                    const upgradeReq: any = {
                       containerID: 1,
                       containerName: 'prompt-text',
                       contentOffset: 0,
                       contentLength: mergedData.response ? mergedData.response.length : 0,
                       content: mergedData.response || " ",
                       toJson: function() { return this; }
                    };
                    await bridge.textContainerUpgrade(upgradeReq);
                    lastResponseRef.current = mergedData.response;
                }
            } else if (lastModeRef.current === 'prompter' && mergedData.mode === 'normal') {
                const clearReq: any = {
                   containerID: 1,
                   containerName: 'prompt-text',
                   contentOffset: 0,
                   contentLength: 0,
                   content: " ",
                   toJson: function() { return this; }
                };
                await bridge.textContainerUpgrade(clearReq);
                lastResponseRef.current = '';
            }

            // --- Clock Routing (Container 2: art-infra1 system clock) ---
            if (mergedData.server_time) {
                const clockStr = formatClock(mergedData.server_time);
                if (clockStr !== lastClockRef.current) {
                    const clockReq: any = {
                       containerID: 2,
                       containerName: 'clock-text',
                       contentOffset: 0,
                       contentLength: clockStr.length,
                       content: clockStr,
                       toJson: function() { return this; }
                    };
                    await bridge.textContainerUpgrade(clockReq);
                    lastClockRef.current = clockStr;
                }
            }

            // --- Misc Notification Routing (Container 4) ---
            const miscText = mergedData.misc_notification || " ";
            if (miscText !== lastMiscRef.current) {
                const miscReq: any = {
                   containerID: 4,
                   containerName: 'misc-text',
                   contentOffset: 0,
                   contentLength: miscText.length,
                   content: miscText,
                   toJson: function() { return this; }
                };
                await bridge.textContainerUpgrade(miscReq);
                lastMiscRef.current = miscText;
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
        <h2 className="title-normal">Protocol Log (v1.1.1)</h2>
        <p className="detail-normal info-text">
          Keep this app open in the Even App to maintain background BLE connectivity with the HUD. Double-tap the glasses to dismiss the active notification.
        </p>
      </div>
    </>
  );
}

export default App;
