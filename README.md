# Agrune Studio

Agrune Studio CLI MVP for creating, validating, editing, and printing Agrune manifest JSON files.

This project intentionally does not import `@agrune/manifest`. It keeps a small local schema and validator so it can grow into the broader Agrune Studio app later.

## Install

```sh
npm install
npm run build
```

During local development you can run the compiled CLI directly:

```sh
node dist/cli.js --help
```

If linked globally, the binary name is:

```sh
agrune-studio --help
```

## Commands

Create an empty manifest:

```sh
agrune-studio init --out agrune.manifest.json
```

Validate manifest JSON shape and selector policy:

```sh
agrune-studio validate agrune.manifest.json
```

Add or update a target:

```sh
agrune-studio add-target agrune.manifest.json \
  --group login \
  --target submit \
  --action click \
  --role button \
  --text "Sign in" \
  --css 'button[type="submit"]'
```

Print a human-readable target table:

```sh
agrune-studio print agrune.manifest.json
```

## Validation Rules

- `version` must be `3`.
- `groups` must be an array.
- Each group needs `groupId` and `targets`.
- Each target needs `targetId`, at least one `actionKinds` entry, and a `selector`.
- A selector must include at least one of `role`, `text`, `testId`, `attr`, or `css`.
- `sensitive: false` is rejected. Omit the field or use `sensitive: true`.
- Hash-like CSS classes such as `.a1b2c3d4` are rejected in `css` and `attr`.
- `:nth-child(...)` is rejected in `css` and `attr`.

## Test

```sh
npm test
```
