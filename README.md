# ComBox App Vue

![banner](.github/assets/banner.png)

[English](./README.md) | [Русский](./README.ru.md)

Vue 3 frontend for ComBox. It provides the main messenger UI: auth flow, chat workspace, groups/topics, media viewers, settings in sidebar, emoji/GIF picker, and realtime client integration through `combox-api`.

## Powered by

[![Vue](https://img.shields.io/badge/Vue-3.5-42B883?style=for-the-badge&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)](https://router.vuejs.org)
[![Vuetify](https://img.shields.io/badge/Vuetify-4_alpha-1867C0?style=for-the-badge&logo=vuetify&logoColor=white)](https://vuetifyjs.com)
[![Webpack](https://img.shields.io/badge/Webpack-5-8DD6F9?style=for-the-badge&logo=webpack&logoColor=black)](https://webpack.js.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

## What it does

- auth flow for register/login/profile bootstrap
- main chat layout with sidebar, conversation area, info panel, overlays
- groups, channels/topics, topic sidebar flow
- message list, reactions, context menus, media previews/viewers
- sidebar settings/profile UI
- emoji/GIF picker with recent emoji and GIF search
- i18n dictionaries
- integration with `combox-api` for HTTP + realtime flows

## Architecture (high level)

```text
          Browser
             |
             v
      [ ComBox App Vue ]
             |
   +---------+-------------------------+
   |                                   |
   v                                   v
 Vue Router                      Chat workspace runtime
 /auth / /settings              sidebar, messages, overlays,
                                info panel, composer, media
             |
             v
         combox-api
             |
             v
   backend REST + WebSocket endpoints
```

## Stack notes

- app runtime is Vue 3 SFC
- bundling/dev server is Webpack
- some UI pieces use Vuetify primitives, most chat UI is custom
- package `combox-api` is linked from `../combox-api`

## Scripts

```bash
npm install
npm run dev
```

Main scripts:

- `npm run dev` - webpack dev server on `0.0.0.0:4173`
- `npm run build` - production webpack build + type check
- `npm run check` - TypeScript project build/check
- `npm run lint` - ESLint
- `npm run preview` - serve built `dist/`

## Runtime expectations

By default the app talks to backend through `combox-api` defaults:

- private API base inferred from browser location
- WebSocket base inferred from browser location

Override when needed with env:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`

## Main UI areas

- `src/components/auth/` - auth flow
- `src/components/chat/` - chat workspace, sidebar, composer, info panel, media, pickers
- `src/pages/` - top-level routed pages
- `src/i18n/` - dictionaries and translation helpers
- `src/utils/` - small frontend helpers

## Project layout

- `src/main.ts` - app bootstrap
- `src/router/` - routes
- `src/pages/` - page containers
- `src/components/` - UI components
- `src/i18n/dicts/` - localized strings
- `public/` - static assets, fonts
- `webpack.config.cjs` - bundler config
- `Dockerfile` / `docker-compose*.yml` - containerized run modes

## Development notes

- most chat behavior is driven from `useChatWorkspace.runtime.ts`
- UI text should live in dictionaries, not as hardcoded strings
- avatar fallback and theme tokens should stay visually consistent across sidebar/chat/info/settings
- project memory/docs for recent work live in `../_memory/`

## Edge deployment

The repo includes edge-oriented compose files:

- `docker-compose.edge.yml`
- `docker-compose.edge.dev.yml`

These are meant to run the app behind `combox-edge`, typically without direct public host exposure except through the edge gateway.

## License

<a href="./LICENSE">
  <img src=".github/assets/mit-badge.png" width="70" alt="MIT License">
</a>

## Author

[Ernela](https://github.com/Ernous) - Developer;
[D7TUN6](https://github.com/D7TUN6) - Idea, Developer
