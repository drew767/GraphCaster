# GraphCaster UI

SPA-редактор: Vite, React 18, TypeScript. Полотно **@xyflow/react**; стартовый документ — пример из **`@schemas/`**; **Открыть** / **Сохранить** (в **`graphs/`** после **привязки папки проекта** в Chromium, иначе скачивание `.json`) / **Новый**; инспектор ноды/ребра, консоль-заглушка — см. `doc/DEVELOPMENT_PLAN.md`.

## Команды

```bash
npm install
npm run dev
npm run build
npm run preview
```

Сборка пишет артефакты в **`dist/`** (в git не коммитится — см. корневой `.gitignore`).

## Стек

- **Vite** + **React** + **TypeScript**
- **@xyflow/react** (React Flow 12) + **i18next** — **en** / **ru**
- **graphs/:** File System Access API (привязка корня → каталог **`graphs/`**, скан, автосохранение с debounce)

## Встраивание

Статическая сборка из `dist/` для WebView / iframe; обмен с Python-runner по плану продукта (WebSocket / `postMessage` / Tauri).
