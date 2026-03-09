# ComBox App Vue

![banner](.github/assets/banner.png)
[![Code Quality](https://github.com/combox/combox-app-vue/actions/workflows/security.yml/badge.svg)](https://github.com/combox/combox-app-vue/actions/workflows/security.yml)

[English](./README.md) | [Русский](./README.ru.md)

Фронтенд на Vue 3 для ComBox. Предоставляет основной интерфейс мессенджера: процесс аутентификации, рабочую область чата, группы/темы, просмотрщики медиа, настройки на боковой панели, выбор эмодзи/GIF и интеграцию с клиентом реального времени через `combox-api`.

## На чём основано

[![Vue](https://img.shields.io/badge/Vue-3.5-42B883?style=for-the-badge&logo=vue.js&logoColor=white)](https://vuejs.org)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)](https://router.vuejs.org)
[![Vuetify](https://img.shields.io/badge/Vuetify-4_alpha-1867C0?style=for-the-badge&logo=vuetify&logoColor=white)](https://vuetifyjs.com)
[![Webpack](https://img.shields.io/badge/Webpack-5-8DD6F9?style=for-the-badge&logo=webpack&logoColor=black)](https://webpack.js.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

## Что делает

- поток аутентификации (регистрация / вход / настройка профиля)
- основная компоновка чата с боковой панелью, областью беседы, информационной панелью, наложениями
- группы, каналы/темы, работа с тематической боковой панелью
- список сообщений, реакции, контекстные меню, предпросмотр и просмотр медиа
- настройки / интерфейс профиля на боковой панели
- выбор эмодзи/GIF с недавними эмодзи и поиском GIF
- словари для локализации (i18n)
- интеграция с `combox-api` для HTTP-запросов и взаимодействия в реальном времени

## Архитектура (высокоуровнево)

```text
          Браузер
             |
             v
      [ ComBox App Vue ]
             |
   +---------+-------------------------+
   |                                   |
   v                                   v
 Vue Router                      Среда выполнения чата
 /auth / /settings              боковая панель, сообщения,
                                наложения, информационная
                                панель, поле ввода, медиа
             |
             v
         combox-api
             |
             v
   backend REST + WebSocket endpoints
```

## Заметки о стеке

- приложение работает на Vue 3 (однофайловые компоненты)
- сборка и сервер разработки — Webpack
- некоторые элементы интерфейса используют базовые компоненты Vuetify, но большая часть чата — кастомная
- пакет `combox-api` подключается локально из `../combox-api`

## Скрипты

```bash
npm install
npm run dev
```

Основные скрипты:

- `npm run dev` — запуск dev-сервера Webpack на `0.0.0.0:4173`
- `npm run build` — production-сборка Webpack + проверка типов
- `npm run check` — сборка/проверка TypeScript-проекта
- `npm run lint` — ESLint
- `npm run preview` — предпросмотр собранной `dist/` папки

## Ожидаемое окружение

По умолчанию приложение обращается к бэкенду через настройки `combox-api`:

- базовый URL для private API определяется из адреса браузера
- базовый URL для WebSocket определяется из адреса браузера

При необходимости можно переопределить через переменные окружения:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`

## Основные области интерфейса

- `src/components/auth/` — процесс аутентификации
- `src/components/chat/` — рабочая область чата, боковая панель, поле ввода, информационная панель, медиа, выборщики
- `src/pages/` — корневые страницы по маршрутам
- `src/i18n/` — словари и вспомогательные функции перевода
- `src/utils/` — небольшие фронтенд-утилиты

## Структура проекта

- `src/main.ts` — точка входа приложения
- `src/router/` — маршруты
- `src/pages/` — контейнеры страниц
- `src/components/` — UI-компоненты
- `src/i18n/dicts/` — локализованные строки
- `public/` — статические файлы, шрифты
- `webpack.config.cjs` — конфигурация сборщика
- `Dockerfile` / `docker-compose*.yml` — режимы запуска в контейнерах

## Заметки для разработки

- большая часть поведения чата управляется из `useChatWorkspace.runtime.ts`
- тексты интерфейса должны храниться в словарях, а не быть жёстко прописаны в коде
- заглушки аватаров и токены темы должны оставаться визуально согласованными во всей боковой панели, чате, информационной панели и настройках
- память проекта и документация по последним изменениям находятся в `../_memory/`
- CI и security workflows чекаутят публичный `combox-api` рядом с приложением, потому что зависимость объявлена как `file:../combox-api`

## Развёртывание на периферии (edge)

В репозитории есть файлы compose, ориентированные на периферийное развертывание:

- `docker-compose.edge.yml`
- `docker-compose.edge.dev.yml`

Они предназначены для запуска приложения за `combox-edge`, обычно без прямого доступа к публичному хосту, кроме как через шлюз.

## Лицензия

<a href="./LICENSE">
  <img src=".github/assets/mit-badge.png" width="70" alt="Лицензия MIT">
</a>

## Авторы

[Ernela](https://github.com/Ernous) — разработчица;  
[D7TUN6](https://github.com/D7TUN6) — идея, разработчик
