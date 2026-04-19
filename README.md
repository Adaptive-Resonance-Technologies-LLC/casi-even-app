# CASI Even Hub Mini-App (EHPK)

This is the standalone Vue/React (Vite) Web Application designed to be packaged as a developer **Even Hub** `.ehpk` app. It serves as the dedicated CASI bridge between your physical Even Realities G2 glasses and the native CASI Android App running on your phone.

## Aesthetic & Design 

This application uses the strict layout paradigms extracted directly from the official **Even Realities Design Guidelines Figma**:
- Typography utilizes strict negative letter-spacing (`-0.15px` to `-0.72px`) across an `Inter` fallback font (mapping the proprietary FK font requirements).
- Layout geometry perfectly conforms to the Even companion app logic: `16px` margins on screens, `12px` inner card padding, and hierarchical cross-element spacing (`12px` vs `24px`).
- Deep monochrome colors rather than generic glassmorphism, ensuring visual consistency with the host ecosystem.

## How It Works
1. **The SDK**: It leverages `@evenrealities/even_hub_sdk` to send commands directly to the glasses over the official BLE tunnel.
2. **The Data Tunnel ("The Smuggling Connector")**: It silently polls the `localhost:8923` HTTP server running inside your native CASI app. When the background CASI app gets a request to push a markdown file to the glasses, it sends it via this local server. Our mini-app catches that payload and renders it directly onto the HUD using the Even SDK `textContainerUpgrade` pipeline.

## Usage & Development

### Local Testing
To test the UI or make changes without building for production:
```bash
npm run dev
```

### Packaging the `.ehpk`
To build the application for sideloading into the Even App Developer Portal:
```bash
npm run build:ehpk
```
This command runs Vite's build process into `dist/`, and then compresses the distribution files into a top-level `casi-app.ehpk` ZIP archive.

### Deploying to Even Hub
1. Transfer the compiled `casi-app.ehpk` file to your mobile device or desktop.
2. Open the Even App's developer settings.
3. Import the `.ehpk` file directly into your developer library.
4. The CASI Icon will now appear natively inside your HUD menus and companion app!

## Configuration Notes
- If the port of the CASI Android `GlassesAudioBridgeService` changes from `8923`, remember to update `src/App.tsx`.
- Keep the `createStartUpPageContainer` strictly limited to initialization as per SDK rules. Dynamic visual updates are exclusively handled via `textContainerUpgrade`.
