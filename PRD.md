# Product Requirements Document: CASI Even G2 Hub App

## Problem Statement

Human executives need a highly accessible, low-friction mechanism to receive critical alerts, review Agentic DAG workflows, and trigger pre-planned operational protocols. Without a heads-up display (HUD), interacting with the HitL (Human-in-the-Loop) Inbox requires constantly checking a phone or dashboard, creating latency in the review process and pulling the executive out of their workflow.

## Solution

The CASI Even G2 Hub App is a wearable HUD application built for the Even G2 glasses using LVGL and the Even Hub SDK (packaged as an `.ehpk`). It serves as the primary notification and low-stakes command interface within the edge control plane. It displays HitL alerts, DAG visualizer summaries, and provides an "A" menu for selecting and initiating pre-planned operational protocols. However, it delegates all capital-allocating cryptographic approvals to the Android CASI app.

## User Stories

1. As a human executive, I want to receive real-time HitL notifications directly on my Even G2 glasses, so that I am instantly aware when an agent requires my approval without looking at my phone.
2. As a human executive, I want to use the glasses' "A" menu to select and execute pre-planned protocols (e.g., stopping non-critical agent flows or querying status), so that I can manage standard operations frictionlessly.
3. As a platform security officer, I want the glasses to be strictly incapable of finalizing capital-allocation decisions, so that a stolen pair of unlocked glasses cannot be used to execute trades.
4. As an Even Hub app developer, I want to manage the app's Lifecycle State reliably, so that notifications and menu selections persist seamlessly when the app goes into the background.
5. As an automated testing agent, I want the Headless Simulator to mock device interactions (Input Injection) and expose the visual output (Framebuffer), so that I can automatically test the app without physical glasses.
6. As a human executive, if an alert requires HitL authorization, I want the glasses to instruct me to open the Android CASI app for biometric confirmation, so that the workflow is securely handed off.

## Implementation Decisions

- **Framework:** Written in TypeScript using the Even Hub SDK, generating an `.ehpk` deployment bundle.
- **Rendering:** LVGL is used for the underlying graphical components (menus, text, containers).
- **Control Interface:** The "A" menu on the device will serve as the primary navigation and selection mechanism for triggering pre-planned protocols.
- **Security Boundary:** The app functions as an alerting and protocol-triggering layer but is intentionally decoupled from final cryptographic authorization for HitL trade approvals.
- **Testing:** Headless Simulator automation is mandatory to prevent regressions on the "A" menu logic and background persistence (`GTK_USE_PORTAL=0` required for headless stability).

## Testing Decisions

- **Headless E2E:** Automated workflows using the simulator to inject double-taps and swipes, verifying the Framebuffer outputs the correct "A" menu states.
- **Lifecycle Testing:** Simulating app suspension and resumption to verify background state persistence.
- **Handoff Verification:** Ensuring that capital-allocation triggers correctly display a "Please confirm on Android" prompt rather than attempting execution.

## Out of Scope

- Direct input of complex text or queries (interactions are limited to pre-planned protocol selections via the "A" menu).
- Final `BiometricPrompt` authorization (handled by `casi-android`).

## Further Notes

- Must adhere to the terminology in `UBIQUITOUS_LANGUAGE.md` (e.g., EHPK, Framebuffer, Lifecycle State).
