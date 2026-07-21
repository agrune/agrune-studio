# Agrune Studio — product direction

## Product sentence

Agrune Studio is a local desktop control room where developers can run, observe, pause, and diagnose manifest-driven browser tests without leaving the browser session the bot actually controls.

## Principles

1. **The browser is the product.** The largest surface is always the exact Playwright page under test.
2. **No split reality.** Preview, bot actions, manual takeover, console, and network signals come from one `BrowserSession`.
3. **Progress is legible.** A run must always expose its current step, target, elapsed time, and terminal result.
4. **Human intervention is first-class.** Pause, step, resume, stop, and direct control are core controls, not debug extras.
5. **Local by default.** The Electron main process owns browser state and filesystem authority; the renderer receives a narrow typed API.
6. **Manifest truth stays in Agrune.** Studio orchestrates and visualizes the engine. It does not duplicate resolution or action logic.

## Information architecture

- **Rail:** product modes — Runs, Recorder, Manifests, Artifacts.
- **Scenario library:** workspace context, scenario selection, manifest coverage.
- **Browser stage:** navigation, live preview, target focus, direct takeover.
- **Run dock:** progress and the controls that change execution state.
- **Inspector:** scenario intent, ordered steps, activity, console, network.

## V1 boundary

This baseline intentionally implements the complete vertical slice before widening the product:

- packaged Electron application;
- directly embedded Agrune `BrowserSession`;
- exact-page screenshot stream;
- manifest target highlighting;
- runnable example scenarios;
- pause, resume, single-step, stop;
- manual pointer and keyboard takeover;
- console and network diagnostics.

Recorder, manifest editing, project discovery, persistent run history, trace viewer integration, and signed distribution follow after this slice is proven stable.
