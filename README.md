# ComBox App Vue

[![Code Quality](https://github.com/combox/combox-app-vue/actions/workflows/security.yml/badge.svg)](https://github.com/combox/combox-app-vue/actions/workflows/security.yml)

[English](./README.md) | [Русский](./README.ru.md)

Vue 3 frontend for ComBox. This repo contains the messenger UI, auth flow, chat workspace, settings sidebar, media viewers, and realtime integration through the local `combox-api` package.

## Requirements

- Node.js 22+
- npm 10+
- sibling checkout of `../combox-api`

## Install

```bash
npm install
```

## Scripts

- `npm run dev` - webpack dev server on `0.0.0.0:4173`
- `npm run lint` - ESLint
- `npm run check` - TypeScript project check
- `npm run build` - production build + type check
- `npm run preview` - serve `dist/`

## Environment

The app uses URL inference from `combox-api` by default.

Optional overrides:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`

## Project Layout

- `src/components/auth/` - auth UI
- `src/components/chat/` - chat workspace, sidebar, composer, media, overlays
- `src/pages/` - routed pages
- `src/i18n/` - dictionaries and translation helpers
- `public/` - static assets
- `webpack.config.cjs` - bundler config

## CI And PR Flow

- GitHub Actions validates lint, type checks, and production build on pull requests
- Dependabot opens update PRs for `npm` and `github-actions`
- `make commit branch=feature/name message="your message"` creates or switches to a non-`main` branch, commits, and pushes it
- merge to `main` should happen only through PR after green checks and approval

Important:

- actual merge protection and required approvals must be enabled in GitHub branch protection / rulesets
- this repo expects `combox-api` to be checked out next to it because of `file:../combox-api`
- CI and security workflows check out the public `combox-api` repo next to this app because the dependency is declared as `file:../combox-api`

## License

<a href="./LICENSE">
  <img src=".github/assets/mit-badge.png" width="70" alt="MIT License">
</a>

## Author

[Ernela](https://github.com/Ernous) - Developer;
[D7TUN6](https://github.com/D7TUN6) - Idea, Developer
