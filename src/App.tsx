import { useEffect, useState, useRef } from 'react';
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import './index.css';

function App() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const lastModeRef = useRef<string>('idle');
  const lastResponseRef = useRef<string>('');

  useEffect(() => {
    let bridgeInitialized = false;
    
    const initEvenHub = async () => {
      try {
        const bridge = await waitForEvenAppBridge();
        
        const createReq: any = {
          containerTotalNum: 3,
          textObject: [
            {
              xPosition: 40,
              yPosition: 60,
              width: 500,
              height: 120,
              borderWidth: 0,
              containerID: 1,
              containerName: 'prompt-text',
              content: ' ',
              isEventCapture: 1,
              toJson: function() { return this; }
            },
            {
              xPosition: 420,
              yPosition: 20,
              width: 150,
              height: 40,
              borderWidth: 0,
              containerID: 2,
              containerName: 'timer-text',
              content: ' ',
              isEventCapture: 0,
              toJson: function() { return this; }
            },
            {
              xPosition: 40,
              yPosition: 20,
              width: 300,
              height: 40,
              borderWidth: 0,
              containerID: 3,
              containerName: 'status-text',
              content: 'CASI Bridge Connected',
              isEventCapture: 0,
              toJson: function() { return this; }
            }
          ],
          toJson: function() { return this; }
        };

        await bridge.createStartUpPageContainer(createReq);
        bridgeInitialized = true;
        setStatus('connected');

        bridge.onEvenHubEvent(async (event: any) => {
           try {
               let interactionType = null;
               if (event.textEvent && event.textEvent.eventType !== undefined) {
                   interactionType = event.textEvent.eventType;
               } else if (event.sysEvent && event.sysEvent.eventType !== undefined) {
                   interactionType = event.sysEvent.eventType;
               }
               
               if (interactionType !== null) {
                   await fetch("https://art-infra1.tailb6aa6c.ts.net/glasses-interaction", {
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
        const remoteRes = await fetch("https://art-infra1.tailb6aa6c.ts.net/glasses-response").catch(() => null);

        let mergedData = { response: "", mode: "normal", timer_end: 0 };
        
        if (remoteRes && remoteRes.ok) {
           const remoteData = await remoteRes.json();
           mergedData.timer_end = remoteData.timer_end || 0;
           if (remoteData.response) {
               mergedData.response = remoteData.response;
               mergedData.mode = remoteData.mode || "prompter";
           }
        }
        
        if (bridgeInitialized) {
            const bridge = await waitForEvenAppBridge();
            // --- Primary Text Routing ---
            if (mergedData.mode === 'prompter') {
                if (mergedData.response !== lastResponseRef.current) {
                    const upgradeReq: any = {
                       containerID: 1,
                       containerName: 'prompt-text',
                       contentOffset: 0,
                       contentLength: mergedData.response ? mergedData.response.length : 0,
                       content: mergedData.response || "CASI Protocol Ready",
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

            // --- Secondary Timer Routing ---
            if (mergedData.timer_end) {
                const now = Math.floor(Date.now() / 1000);
                const diff = mergedData.timer_end - now;
                let timerStr = "00:00";
                if (diff > 0) {
                    const m = Math.floor(diff / 60).toString().padStart(2, '0');
                    const s = (diff % 60).toString().padStart(2, '0');
                    timerStr = `${m}:${s}`;
                }
                const clockReq: any = {
                   containerID: 2,
                   containerName: 'timer-text',
                   contentOffset: 0,
                   contentLength: timerStr.length,
                   content: timerStr,
                   toJson: function() { return this; }
                };
                await bridge.textContainerUpgrade(clockReq);
            } else {
                const clearClockReq: any = {
                   containerID: 2,
                   containerName: 'timer-text',
                   contentOffset: 0,
                   contentLength: 0,
                   content: " ",
                   toJson: function() { return this; }
                };
                await bridge.textContainerUpgrade(clearClockReq);
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
        <h2 className="title-normal">Protocol Log (v1.0.9)</h2>
        <p className="detail-normal info-text">
          Keep this app open in the Even App to maintain background BLE connectivity with the HUD. It pushes events to art-infra1.
        </p>
      </div>
    </>
  );
}

export default App;
