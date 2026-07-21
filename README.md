# Agrune Studio

Desktop control room for Agrune's manifest-driven Playwright engine.

The app owns one real `BrowserSession` in Electron's main process and streams the exact tested page into the UI. There is no localhost Studio server and no second webview pretending to be the tested browser.

## Run locally

```bash
pnpm install
pnpm browser:install
pnpm dev
```

The built-in scenarios target the sibling demo at `http://127.0.0.1:4178`:

```bash
pnpm --dir ../demo dev --host 127.0.0.1 --port 4178
```

## Verify and package

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm make
```

`pnpm package` installs a hermetic Chromium headless shell under `playwright-core/.local-browsers` and copies it into the packaged application's resources so the browser engine does not depend on a separate system install.

## Architecture

```text
React renderer
  ↕ narrow contextBridge API
Electron main
  └─ StudioController
      └─ Agrune BrowserSession
          └─ Playwright Chromium page
              ├─ preview frames
              ├─ manifest targets
              ├─ console signals
              └─ network signals
```

See [PRODUCT.md](./PRODUCT.md) for the product and design decisions.
