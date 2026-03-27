# GraphCaster UI

SPA-редактор: Vite, React 18, TypeScript. Полотно **@xyflow/react**; стартовый документ — пример из **`@schemas/`**; **Открыть** / **Сохранить** (в **`graphs/`** после **привязки папки проекта** в Chromium, иначе скачивание `.json`) / **Новый**; инспектор ноды/ребра, консоль-заглушка — см. `doc/DEVELOPMENT_PLAN.md`.

## Команды

```bash
npm install
npm run dev          # окно приложения (Tauri) + Vite на 127.0.0.1:5173; нужен Rust (см. tauri.app)
npm run dev:web      # только Vite, без автозапуска браузера
npm run build        # SPA → dist/
npm run build:desktop  # tauri build: .exe + MSI/NSIS в src-tauri/target/release/bundle/
npm run preview:web  # превью dist/ на 127.0.0.1:4173
npm test
```

Сборка пишет артефакты в **`dist/`** (в git не коммитится — см. корневой `.gitignore`).

### Распространение для пользователей без сборки

После **`npm run build:desktop`** отдайте конечным пользователям **`…/bundle/nsis/*-setup.exe`** (мастер установки). Им не нужны Node, Rust и Dev-пакеты Windows; при отсутствии WebView2 установщик может поставить его автоматически. В монорепозитории тот же артефикт можно получить из GitHub Actions: workflow **GraphCaster desktop (Windows installer)** → **Artifacts**.

## Стек

- **Vite** + **React** + **TypeScript**
- **@xyflow/react** (React Flow 12) + **i18next** — **en** / **ru**
- **graphs/:** File System Access API (привязка корня → каталог **`graphs/`**, скан, автосохранение с debounce)

## Встраивание

Статическая сборка из `dist/` для WebView / iframe; обмен с Python-runner по плану продукта (WebSocket / `postMessage` / Tauri). Для ежедневной работы в отдельном окне используйте **`npm run dev`** (оболочка Tauri в `src-tauri/`).
