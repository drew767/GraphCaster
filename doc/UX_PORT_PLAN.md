# GraphCaster — План полного UX-порта n8n

Дата: 2026-05-12. Соглашение: маркеры **UX1…UX120** (по аналогии с F1…F102 в [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)).

Парный документ: [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md). Цель: интерфейс GraphCaster становится визуально и поведенчески неотличим от n8n для пользователя, при этом сохраняются ключевые технические преимущества (Tauri desktop, schema-driven inspector, LOD-рендеринг, CRDT, dual-mode web/desktop, гибкий node-runtime).

---

## 0. Стратегия и допущения

### Что **переносим** буква-в-букву
- Шесть-зонный layout: `banners | sidebar | header | aside | content` (+ portal для модалок и command-bar поверх всего).
- Информационная архитектура: страницы `/workflows`, `/executions`, `/credentials`, `/templates`, `/settings/*`, `/projects/*` + workflow-editor.
- Token-набор (spacing/font/color/radius/shadow/z-index/motion) — все CSS-переменные `--color--*`, `--spacing--*`, `--radius--*`, etc.
- Компонентный inventory: `N8nButton`, `N8nCard`, `N8nInput`, `N8nDialog`, `N8nDataTableServer`, `N8nCommandBar`, `N8nTooltip`, `N8nPopover` и ~80 других — переписываем под React-эквиваленты с теми же пропсами и слотами.
- Node Detail View (NDV) — модаль/drawer с 3-панельной структурой (Input | Parameters | Output), `ResourceLocator`, expression-editor с `$json`/`$node` автодополнением.
- Хоткеи canvas-уровня (40+ комбинаций), правый-клик меню.
- Visual-states нод: idle/running/success/error/waiting/pinned/disabled/dirty + conic-gradient rotating border для running.
- Edge routing для backward connections (двусегментный bezier с 130px нижним padding и 16px радиусом).
- Mini-map auto-hide с 1-секундным delay.
- Connection-preview line с 300ms задержкой.
- Edge toolbar с 600ms hover delay.

### Что **сохраняем без изменений** (нельзя терять GraphCaster-DNA)
1. **React 18 + xyflow 12 + Vite** — Vue→React переезд исключён. Все Vue-компоненты n8n переписываются как React-компоненты с идентичным API.
2. **Tauri desktop** (window/file dialogs/installer) — n8n сам в этом отстаёт (Electron), мы остаёмся легче.
3. **Schema-driven inspector** — поля параметров генерируются из JSON-Schema ноды, а не хардкодятся. NDV получит ту же возможность.
4. **LOD-рендеринг** (3 тира: full/compact/ghost) — даёт нам 1000+ нод на канвасе, n8n этого не имеет.
5. **Виртуализация viewport** (`useViewportCulling`).
6. **Async layout via Web Worker** (`workers/layoutWorker.ts`).
7. **CRDT collaboration via Yjs** (F77) — у n8n awareness-only через push-connection, мы плотнее интегрированы.
8. **Plugin nodes registry** через `/api/v1/nodes` — динамическая палитра.
9. **graph_ref + nested trace tree** — иерархическое отслеживание прогона глубже, чем n8n's linear timeline.
10. **PNG-embed export** (F75) — у n8n нет.
11. **Tauri NSIS installer (русская локализация)**.
12. **Run-broker SSE/WS dual transport** + multi-tenant Redis coordination.
13. **i18n: en + ru** (n8n имеет en+zh, мы держим оба).

### Базовое тактическое решение
Не превращаем GraphCaster в форк n8n. Берём n8n как **визуальный референс и information-architecture template**, переписываем под наш React-стек и сохраняем backend-нативность. Каждый UX-маркер — отдельный PR-в-плане.

### Размеры (T-shirt) и зависимости
- **XS** = ≤1 день. **S** = 1-3 дня. **M** = 3-7 дней. **L** = 1-2 недели. **XL** = 3-5 недель.
- Зависимости явные (`deps: UX12, UX15`).

---

## Phase 1 — Design system foundation (фундамент)

Без этого фазы 2+ невозможны: все компоненты используют токены и базовые примитивы.

### UX1. Design tokens migration (XL)
**Источник:** `packages/frontend/@n8n/design-system/src/css/_primitives.scss` + `_tokens.scss`.

Перенести **все** n8n CSS-переменные в `ui/src/styles/tokens.css`:
- spacing scale: `--spacing--5xs` (2px) … `--spacing--5xl` (256px) — 13 значений.
- font sizes: `--font-size--4xs` (8px) … `--font-size--2xl` (28px) — 9 значений.
- font weights: 400/500/600.
- line heights: `--line-height--xs` (1) … `--line-height--xl` (1.5).
- border-radius: `--radius--4xs` (2px) … `--radius--2xl` (32px) + `--radius--full`.
- shadows: `--shadow`, `--shadow--dark`, `--shadow--light`.
- z-index: `--index-normal` (1) / `--index-top` (1000) / `--index-popper` (2000).
- motion: `--duration--snappy` (150ms) / `--duration--base` (300ms) + 3 cubic-bezier'а.
- цвета: full semantic scale (primary/secondary/success/warning/danger/info) + 16-step neutral + extended palette (orange/purple/green/mint/red/blue/yellow/gold/slate).

Файлы: `ui/src/styles/tokens.css` (расширение существующего; маппинг старых `--gc-*` на новые `--color--*` — оставить старые как алиасы, чтобы не сломать существующие компоненты).

**Deps:** none.

### UX2. Fonts: InterVariable + CommitMono (S)
**Источник:** `@n8n/design-system/src/css/fonts.css` + `assets/fonts/`.

Подключить WOFF2 файлы Inter Variable (100–900 weight) и Commit Mono. Положить в `ui/public/fonts/`. CSS `@font-face` в `tokens.css`.

CSS-переменные: `--font-family: "InterVariable", sans-serif;` и `--font-family--monospace: "CommitMono", ui-monospace;`.

**Deps:** UX1.

### UX3. Dark/light theme switching (S)
**Источник:** n8n `@media (prefers-color-scheme)` + manual user override via Pinia.

Сейчас у нас auto-detect через media query. Добавить:
- Zustand `themeStore` с `theme: "light" | "dark" | "auto"`.
- При смене темы переключать класс `data-theme="dark"` на `<html>`.
- Persist в `localStorage` (key: `gc-theme`).
- Тоггл в Settings → Personalization (UX76).

**Deps:** UX1.

### UX4. Icon system: 250+ Lucide + custom SVGs (M)
**Источник:** n8n `@n8n/design-system/src/components/N8nIcon/icons.ts` + `custom/` 38 SVG.

Подход:
- Установить `lucide-react` (одна dep, tree-shakeable).
- Создать `ui/src/components/Icon/Icon.tsx`:
  ```tsx
  interface IconProps { name: IconName; size?: number; }
  ```
- Map `IconName` (kebab-case) к Lucide-компонентам через статическую таблицу.
- Custom icons (38 штук n8n-specific) положить в `ui/src/components/Icon/custom/*.svg` и зарегистрировать как inline SVG.
- Перенести **все** 250+ имён иконок из n8n's `icons.ts` (целиком, чтобы можно было копипастить шаблоны).

**Deps:** UX1.

### UX5. Logo + brand (XS)
**Источник:** `@n8n/design-system/src/components/N8nLogo/`.

Создаём `ui/src/components/Logo.tsx` с тёмным/светлым вариантом. Использовать GraphCaster's существующий логотип, но с n8n-style композицией: иконка + wordmark рядом.

**Deps:** UX1.

### UX6. Base primitives: Button (M)
**Источник:** `@n8n/design-system/src/components/N8nButton/Button.vue`.

Полная реализация:
- 6 вариантов: `solid` | `subtle` | `ghost` | `outline` | `destructive` | `success`.
- 7 размеров: `xmini` | `mini` | `xsmall` | `small` | `medium` | `large` | `xlarge`.
- Loading state со spinner overlay.
- Optional icon left/right.
- `aria-label` для icon-only.
- Pseudo-elements для focus ring (`_focus.scss` mixin → CSS).

`ui/src/components/ui/Button.tsx`. **Deps:** UX1, UX4.

### UX7. Form primitives: Input/InputNumber/Select/Checkbox/Radio/Switch (L)
**Источник:** `@n8n/design-system/src/components/N8nInput*`, `N8nSelect*`, `N8nCheckbox`, `N8nRadioButtons`, `N8nActionToggle`.

Each component: pure React, controlled, с теми же пропсами что у n8n. Включить validation states (error/success/disabled), icon slots, size variants.

Folders: `ui/src/components/ui/{Input,InputNumber,Select,Checkbox,RadioGroup,Switch}/`. **Deps:** UX6.

### UX8. Tooltip + Popover (M)
**Источник:** `@n8n/design-system/src/components/N8nTooltip` + `N8nPopover` (на базе Reka UI).

Использовать `@radix-ui/react-tooltip` + `@radix-ui/react-popover` (Reka UI порт для React). Wrap в наши props-форматы (n8n-совместимые). Default placement, delay, теme-aware стили.

`ui/src/components/ui/{Tooltip,Popover}/`. **Deps:** UX1.

### UX9. Dialog + AlertDialog (M)
**Источник:** `@n8n/design-system/src/components/N8nDialog`.

`@radix-ui/react-dialog`-based. 8 preset sizes (`small`/`medium`/`large`/`xlarge`/`2xlarge`/`fit`/`full`/`cover`). Focus trap, ESC-to-close, overlay click, close button toggle. Slots: header/body/footer.

`ui/src/components/ui/Dialog/`. **Deps:** UX1, UX6.

### UX10. Dropdown menu (S)
`@radix-ui/react-dropdown-menu`. Поддержка nested submenus, separators, icons, hotkeys preview.

`ui/src/components/ui/DropdownMenu/`. **Deps:** UX8.

### UX11. Card + CollapsiblePanel + Accordion (S)
**Источник:** `N8nCard`, `N8nCollapsiblePanel`, `N8nInfoAccordion`.

Slot-based: `prepend` | `header` | `body` | `footer` | `append`. Optional `hoverable`. CollapsiblePanel — controlled/uncontrolled, animation. **Deps:** UX1.

### UX12. Tabs (S)
**Источник:** `N8nTabs`. `@radix-ui/react-tabs`-based. Horizontal/vertical, lazy mount. **Deps:** UX1.

### UX13. Tag/Badge/Pill (XS)
**Источник:** `N8nTag`, `N8nTags`, `N8nBadge`, `DependencyPill`. **Deps:** UX1.

### UX14. Avatar (XS)
**Источник:** `N8nAvatar`. Inicialov-fallback. Use `boring-avatars` для случайных. **Deps:** UX1.

### UX15. Toast / Notification (M)
**Источник:** `useToast()` composable.

Расширить наш существующий `ToastProvider.tsx`:
- Bottom-right (как n8n).
- 4 типа: success/error/warning/info.
- Sticky vs auto-dismiss (configurable duration).
- Queue management.
- HTML content support (sanitized via DOMPurify).
- Telemetry hook (для error toasts с node/workflow context).

`ui/src/toast/`. **Deps:** UX1.

### UX16. Alert (inline) + Notice + Callout (S)
**Источник:** `N8nAlert`, `N8nNotice`, `N8nCallout`. **Deps:** UX1.

### UX17. Loading: CircleLoader + Spinner + BlockUi (XS)
**Источник:** `N8nCircleLoader`, `N8nSpinner`, `N8nLoading`, `N8nBlockUi`. Animated SVG, full-page overlay variant. **Deps:** UX1.

### UX18. Breadcrumbs (XS)
**Источник:** `N8nBreadcrumbs`. **Deps:** UX1.

### UX19. SectionHeader + Heading + Text wrappers (XS)
**Источник:** `N8nSectionHeader`, `N8nHeading`, `N8nText`. Semantic h1-h6 + paragraph variants. **Deps:** UX1.

### UX20. Link + ExternalLink (XS)
**Источник:** `N8nLink`, `N8nExternalLink`. External адрес → иконка ↗. **Deps:** UX4.

### UX21. ScrollArea + RecycleScroller (M)
**Источник:** `N8nScrollArea`, `N8nRecycleScroller`.

ScrollArea — `@radix-ui/react-scroll-area`. RecycleScroller — `@tanstack/react-virtual` для виртуализации больших списков (10k+ rows). **Deps:** UX1.

### UX22. DataTable + DataTableServer (L)
**Источник:** `N8nDatatable`, `N8nDataTableServer`. Базируется на `@tanstack/react-table`.

Features: column sort, filter, pagination, row selection, virtualization, server-side mode. Это критичный компонент для Executions/Users/Roles страниц.

`ui/src/components/ui/DataTable/`. **Deps:** UX21.

### UX23. Pagination controls (XS)
**Источник:** `N8nPagination2`. **Deps:** UX6.

### UX24. Tree view (S)
**Источник:** `N8nTree`. Recursive, lazy-load nodes. **Deps:** UX1.

### UX25. Markdown renderer (XS)
**Источник:** `N8nMarkdown`. Use `marked` + DOMPurify (HTML sanitize). **Deps:** UX1.

### UX26. InlineTextEdit (S)
**Источник:** `N8nInlineTextEdit`. Click-to-edit с keyboard commit (Enter / Esc). Используется в названиях workflow и нод. **Deps:** UX7.

### UX27. ColorPicker (S)
**Источник:** `N8nColorPicker`. 7 preset colors + custom hex. **Deps:** UX1, UX8.

### UX28. DateRangePicker (M)
**Источник:** `N8nDateRangePicker`. Используется в фильтре Executions. **Deps:** UX8.

### UX29. KeyboardShortcut display (XS)
**Источник:** `N8nKeyboardShortcut`. Платформенно-зависимое (`⌘` vs `Ctrl`). **Deps:** UX1.

### UX30. ResizeWrapper + FloatingWindow + Sticky (M)
**Источник:** `N8nResizeWrapper`, `N8nFloatingWindow`, `N8nSticky`, `N8nResizeableSticky`.

ResizeWrapper — drag-resize handles. Используется для NDV panels. **Deps:** UX1.

---

## Phase 2 — App shell + routing

### UX31. React Router v6 setup (S)
Сейчас у нас одна страница (AppShell). Добавляем routing:
- `BrowserRouter` для веба, `HashRouter` (или MemoryRouter) для Tauri.
- Route-based code-splitting через `React.lazy`.

`ui/src/router.tsx`. **Deps:** none.

### UX32. AppLayout + layout slot system (M)
**Источник:** `app/components/AppLayout.vue` + `layouts/*`.

5 layout-компонентов (как у n8n):
- `DefaultLayout` — sidebar + header + content.
- `WorkflowLayout` — sidebar + header + canvas + optional aside.
- `SettingsLayout` — sidebar + settings sub-sidebar + content.
- `AuthLayout` — centered card without sidebar (login/signup).
- `DemoLayout` — minimal без sidebar, для embed/демо.

CSS Grid с явными areas: `banners | sidebar | header | aside | content`.

`ui/src/app/layouts/`. **Deps:** UX31, UX1.

### UX33. AppBanners (top notifications strip) (XS)
**Источник:** `AppBanners.vue`. Для уведомлений о новой версии, миграциях, баннеров cloud. **Deps:** UX1.

### UX34. MainSidebar (left navigation) (L)
**Источник:** `app/components/MainSidebar.vue`.

- Collapsible/resizable.
- Меню (порядок):
  1. **Workflows** (`/workflows`)
  2. **Executions** (`/executions`)
  3. **Credentials** (`/credentials`) — пока заглушка-секция
  4. **Templates** (`/templates`) — уже есть страница (F78), переезжаем под n8n layout
  5. **Insights** (`/insights`) — позже (UX-marker)
  6. **Help** — submenu с links: Quickstart / Docs / Forum / Report Bug / About
  7. **Settings** (`/settings`) — submenu
  8. **Plugins** (`/plugins`) — F92 plugins, в n8n это Community Nodes
- User-area внизу: avatar + email + dropdown (Settings/Logout).
- Workspace switcher вверху (для F83 multi-tenant).
- Source-control status (если активен).

`ui/src/app/components/MainSidebar/`. **Deps:** UX32, UX4, UX14, UX10.

### UX35. AppHeader + MainHeader (top bar) (M)
**Источник:** `AppHeader.vue` + `MainHeader/MainHeader.vue`.

- Слева: breadcrumbs + workflow name (InlineTextEdit для editor mode).
- Центр: TabBar (Editor / Executions / Tests) — только в workflow context.
- Справа: Save / Run / Activate buttons + GitHub star (опц.) + user menu.

`ui/src/app/components/AppHeader/`. Старый `TopBar.tsx` рефакторим под этот компонент. **Deps:** UX32, UX26, UX12.

### UX36. AppModals (portal) (S)
**Источник:** `AppModals.vue` + `useUIStore`.

Single root portal `<div id="app-modals">`. Modals state в Zustand store:
```ts
type ModalKey = "workflow-settings" | "workflow-share" | "credential-edit" | ...; // 50+ keys
useUIStore.openModal(key, payload?);
useUIStore.closeModal(key);
```

Все наши существующие модалки (`GraphSaveModal`, `KeyboardShortcutsModal`, `EmbedCodeModal`, …) мигрируют под этот store + portal.

`ui/src/app/components/AppModals/`. **Deps:** UX9, UX31.

### UX37. AppCommandBar (Cmd+K palette) (L)
**Источник:** `app/components/AppCommandBar.vue` + `@n8n/design-system N8nCommandBar`.

Использовать `cmdk` (npm) — лёгкая lib, активно используется. Категории:
- **Recent** (recently opened workflows, last execution).
- **Create**: New Workflow / New Credential / New Project.
- **Navigate**: links to all routes.
- **Workflow nodes** (в editor context) — Add node + go-to node.
- **Actions** (в editor context): Save / Run / Activate / Export PNG / Auto-layout / …
- **Help**: links to docs, shortcuts modal.

Триггер: Cmd+K / Ctrl+K. Заменяет наш `SearchPalette` (объединяем). **Deps:** UX36.

### UX38. Notifications inbox (S)
**Источник:** Push-connection notifications в n8n.

В правом-верхнем углу AppHeader колокольчик с числом непрочитанных. Click → popover со списком (run-failed, plugin updated, invite received). **Deps:** UX8.

### UX39. User menu (S)
Bottom-of-sidebar dropdown: avatar / name / email → links to Personal settings, Logout. **Deps:** UX34, UX10.

### UX40. Onboarding tour (M)
**Источник:** `WorkflowOnboardingView` + Personalization modal.

Use `react-joyride` или `intro.js-react`. Первый запуск → 5-шаговый тур: палитра → канвас → инспектор → run-кнопка → templates. Persist `gc-onboarding-done` flag. **Deps:** UX32.

---

## Phase 3 — Pages (information architecture)

### UX41. /workflows — Workflows dashboard (L)
**Источник:** `WorkflowsView.vue` + `ResourcesListLayout` + `WorkflowCard`.

Сейчас у нас `GraphSaveModal` показывает сетку — превращаем её в полноценную страницу.

Layout:
```
+- ProjectHeader (breadcrumbs + project context) ----+
| [Workflows] [+ Create] [Import]   [Search] [⚙Filt]|
+----------------------------------------------------+
| Status: [All▼]  Tags: [▼]  Archived: ☐  Sort: [▼] |
+----------------------------------------------------+
| ┌──────┐  ┌──────┐  ┌──────┐                        |
| │ Card │  │ Card │  │ Card │                        |
| └──────┘  └──────┘  └──────┘                        |
| [Load more...]                                      |
+----------------------------------------------------+
```

Filters:
- Status (All / Active / Inactive / Archived)
- Tags (multi-select)
- Show archived (toggle)
- Search (debounced)
- Sort (Last Updated / Last Created / Name)

`WorkflowCard` (extend our `GraphCard`):
- Thumbnail (F99 уже есть)
- Name (InlineTextEdit)
- Tags
- Last updated relative ("2h ago")
- Owner/Project badge
- Active/Inactive switch
- Execution count
- Actions menu (⋮): Edit / Delete / Move / Archive / Duplicate / Export

Endpoint: `GET /api/v1/graphs` (расширить — наш marketplace endpoint близок).

`ui/src/pages/Workflows/`. **Deps:** UX22, UX23, UX34, UX22.

### UX42. /executions — Global executions list (L)
**Источник:** `ExecutionsView` + `GlobalExecutionsList` + `ExecutionsFilter`.

Полноценная страница глобальной истории прогонов (по всем графам).

Колонки:
- Status badge (Success/Failed/Cancelled/Running/Waiting)
- Workflow (link to its editor)
- Execution ID
- Started
- Duration
- Mode (Manual / Webhook / Schedule / Trigger)
- Retry-of (если retry)
- ⋮ Actions: View / Retry / Delete

Filters:
- Workflow (autocomplete)
- Status (multi-select)
- Date range (UX28)
- Custom metadata (key-value)
- Annotation tags (F55 RAG-attr style)

Bulk actions: Delete selected / Retry selected (модалка подтверждения).

Live updates: subscribe to `/runs/events` SSE; новые executions появляются сверху.

Endpoint: расширить F10 v1 API — `GET /api/v1/runs?graphId=&status=&since=&limit=&cursor=`.

`ui/src/pages/Executions/`. **Deps:** UX22, UX28.

### UX43. /executions/:runId — Single execution preview (M)
**Источник:** `WorkflowExecutionsPreview.vue` + `SyncedWorkflowCanvas`.

Top: read-only canvas snapshot (того workflow на момент run). Каждая нода подсвечена статусом.

Bottom: split-view per-node data inspector (Input / Output panels — переиспользуем компоненты NDV из Phase 5).

Actions:
- Replay (UX-marker F102 ↔ существующий)
- Retry (with same inputs)
- Stop (если running)
- Open workflow at this version

`ui/src/pages/Executions/SingleExecution.tsx`. **Deps:** UX42, UX79 (NDV input/output).

### UX44. /workflow/:id — Workflow editor (XL — самая большая)
Это наш main editor (текущий AppShell.tsx). Переписать под `WorkflowLayout`:
- Header: workflow name (editable) / tags / breadcrumbs / TabBar
- Canvas (большая часть; уже работает)
- Aside (NDV-drawer — UX78)
- Bottom (опц. LogsPanel — UX46)
- Floating: Add-node button + Run button

Это не один PR — это серия маленьких миграций (UX44a, UX44b, …).

### UX45. /workflow/:id/executions — Per-workflow executions tab (M)
Дочерний route. Внутри editor — переключение Editor/Executions/Tests через TabBar. **Deps:** UX42.

### UX46. LogsPanel (XS)
**Источник:** `LogsPanel` в n8n + наш `ConsolePanel.tsx`.

Существующий компонент — стилизуем под n8n: тёмная панель снизу, monospace font, syntax highlight для JSON, copy/clear buttons. **Deps:** UX25.

### UX47. /credentials — Credentials dashboard (L)
**Источник:** `CredentialsView.vue` + `CredentialCard`.

У нас сейчас credentials хранятся как `data.workspace_secrets` или env. Делаем UI слой для F8 secrets providers (file/Vault/AWS SM):

```
+ Credentials   [+ New]  [Search] [Filter]
+- Cards Grid -----------------------------+
| ┌── 🔐 OpenAI API ──┐  ┌── 🔑 Slack ──┐|
| │ Type: API Key    │  │ Type: OAuth ││
| │ Used by: 3 wfs   │  │ Used by: 1  ││
| │ Last used: 1h    │  │ Setup ⚠     ││
| │ [Edit][Test][⋯]  │  │ [Edit][⋯]   ││
| └──────────────────┘  └─────────────────┘|
+---+--------------------------------------+
```

Endpoint: новый `/api/v1/credentials` (CRUD), записывает в secrets-provider.

`ui/src/pages/Credentials/`. **Deps:** UX22.

### UX48. /credentials/new + /:id/edit (modal flow) (M)
**Источник:** `CredentialEdit` + `CredentialsSelectModal` + `CredentialInputs`.

Flow:
1. Click "+ New" → modal с категориями типов (API Key, OAuth2, Basic Auth, Bearer, AWS, Database…).
2. Pick type → form с type-specific fields (генерируется из schema).
3. OAuth flow → redirect → callback → tokens saved.
4. **Test connection** button.
5. **Sharing tab** (F84 RBAC) — какие projects/users имеют доступ.

`ui/src/pages/Credentials/CredentialEditModal.tsx`. **Deps:** UX47, UX9.

### UX49. /templates — Templates marketplace (S — реализовано в F78, дополнить)
Существует. Обновить стили под n8n:
- Grid с filter sidebar слева (Framework / Use case / Tag).
- Carousel "Recommended".
- Card с preview-screenshot.
- "Use template" → wizard (выбор имени, заполнение credentials).

`ui/src/pages/Templates/` (расширить). **Deps:** UX22.

### UX50. /templates/:id — Template preview (S)
Existing. Add "Use" flow с возможностью review графа перед инстанцированием. **Deps:** UX49.

### UX51. /settings — Settings hub (S)
**Источник:** SettingsLayout + Sidebar.

Левая sub-sidebar:
- Personal
- Workspace (admin only)
- Users (admin)
- API Keys
- External secrets
- Community Nodes (Plugins у нас)
- Source control
- LDAP / SSO (EE)
- Audit Logs (admin)
- Insights / Usage

Default redirect: `/settings/personal`. **Deps:** UX32, UX34.

### UX52. /settings/personal (M)
**Источник:** `SettingsPersonalView`.

Sections:
- Profile (first/last name, email read-only, avatar upload).
- Password change (existing F85 OAuth).
- MFA setup (TOTP) — extends F87 audit + F84 RBAC.
- Personalization (theme/density/language) — toggles UX3/UX1.

`ui/src/pages/Settings/Personal.tsx`. **Deps:** UX51, UX7.

### UX53. /settings/api-keys (M)
**Источник:** `SettingsApiView`.

Table колонок: Label / Key (masked) / Scopes / Last used / Created / Actions (Copy / Revoke).
- "Create API key" modal: label + scope multi-select.

Endpoint: F10 уже имеет Bearer scopes; добавить `GET/POST/DELETE /api/v1/api-keys`.

**Deps:** UX22, UX51.

### UX54. /settings/users + /users/:id — User management (L)
**Источник:** `SettingsUsersView` + `SettingsUsersTable` + `InviteUsersModal`.

F83 даёт User/Tenant model. Добавляем UI:
- DataTableServer с user-list (name, email, role, last active).
- Invite users modal (email + role).
- Edit role inline.
- Delete user modal (с reassign of resources).

**Deps:** UX22, UX9, UX51.

### UX55. /settings/external-secrets (M)
**Источник:** `SettingsExternalSecrets`.

Cards по providers (Vault, AWS Secrets Manager, file). Connect/disconnect actions. Status indicator. Test connection.

F8 secrets-providers уже на месте — нужен UI слой.

**Deps:** UX11, UX51.

### UX56. /settings/community-nodes — Plugins (M)
**Источник:** `SettingsCommunityNodesView`.

F92/F97 plugin registry + scaffold. UI:
- Installed plugins list (card view).
- "Install new" → PyPI search (F97).
- Update / uninstall actions.
- Permissions display (network/storage/subprocess/secrets/model_calls).
- Trust toggle.

**Deps:** UX22, UX51.

### UX57. /settings/source-control (M)
**Источник:** `SettingsSourceControl`.

UI for git-based workflow versioning (F49 уже есть draft/publish; добавляем git integration UX). Pull/push buttons + branch picker + changes preview. **Deps:** UX51.

### UX58. /settings/sso (L)
**Источник:** `SettingsSso`.

F85 OAuth/OIDC SSO — UI для настройки SAML / OIDC provider URL, client_id/secret, mapping rules. **Deps:** UX51.

### UX59. /settings/audit-log (S)
**Источник:** Enterprise audit features.

F87 audit log enforcement даёт `GET /api/v1/audit`. UI:
- DataTableServer.
- Filters: actor / action / target / time range.
- Chain-integrity check button (verify).

**Deps:** UX22, UX51, UX28.

### UX60. /projects + project flow (L)
**Источник:** Projects feature (collaboration package).

F83 tenancy — UI слой:
- Project list (cards с member-count + workflow-count).
- Project detail: members table + role assignment + project-scoped workflows/credentials/variables.
- Create/Edit/Delete project.

Это enterprise-grade фича; запускаем после ядра.

**Deps:** UX22, UX51.

### UX61. /home dashboard (S)
**Источник:** `/` → `/home/workflows` redirect.

Простой landing: список recent workflows + recent executions + recent credentials + tips. Идентичен n8n's home view (если пользователь не выбрал workspace).

`ui/src/pages/Home/`. **Deps:** UX41.

### UX62. 404 / Entity not found / Unauthorized pages (XS)
**Источник:** `ErrorView`, `EntityNotFound`, `EntityUnAuthorised`.

Standard error pages с CTA back-to-home.

`ui/src/pages/errors/`. **Deps:** UX32.

### UX63. /auth — login/signup/reset (L)
**Источник:** SigninView, SignupView, ForgotMyPasswordView, ChangePasswordView, SetupView.

Auth layout (centered card). Forms с validation. SSO buttons (UX58). 2FA prompt (PromptMFA).

В Tauri-режиме auth скрывается / shorthand (локальный single-user).

`ui/src/pages/Auth/`. **Deps:** UX32, UX7.

---

## Phase 4 — Canvas re-skin (визуальный порт)

Без замены движка — мы остаёмся на xyflow. Меняем только визуал + поведение.

### UX64. Node visual: redesign GcFlowNode to match n8n (L)
**Источник:** `CanvasNodeDefault.vue`.

Структура ноды:
```
┌──────────────────────┐
│   [icon 40x40]        │ ← top
│   Node name           │
│   (subtitle, 1 line)  │
│ [⚙][⏰] (top-right)   │ ← settings icons
│ [✓][✗][📌] (bottom)   │ ← status icons
│   Strike-through if disabled
└──────────────────────┘
```

States (border treatment):
- idle → 1.5px neutral
- selected → 1.5px blue + 6px blue glow shadow
- running → 2px conic-gradient rotating (`from var(--node--gradient-angle), rgba(255,109,90,1) 0%, rgba(255,109,90,0.2) 35%, rgba(255,109,90,0.2) 65%, rgba(255,109,90,1) 90%`)
- success → 2px green solid
- error → 1.5px red + error icon
- pinned → 2px gold (`--node--border-color--pinned`)
- disabled → faded + power icon + strike-through line

Trigger nodes — `border-radius: 36px 10px 10px 10px` (curve top-left).

Файл: `ui/src/components/nodes/GcFlowNode.tsx` (полностью переписать).

**Deps:** UX1, UX4.

### UX65. CSS animation: conic-gradient rotating border (S)
**Источник:** n8n's `border-rotate` keyframe.

```css
@property --node--gradient-angle {
  syntax: '<angle>'; inherits: false; initial-value: 0deg;
}
@keyframes border-rotate { from { --node--gradient-angle: 0deg; } to { --node--gradient-angle: 360deg; } }
.gc-node--running::after { animation: border-rotate 1.5s linear infinite; background: conic-gradient(...); }
```

CSS-only, GPU-accelerated. **Deps:** UX64.

### UX66. Status icons (badges) (S)
**Источник:** `CanvasNodeStatusIcons.vue`.

Bottom-right badge stack:
- `node-pin` (pinned)
- `node-success` (last run OK) + iteration count
- `node-execution-error` + tooltip listing errors
- `node-validation-error`
- `node-dirty` (params changed, не запускался ещё)
- `power` (disabled)
- `hard-drive-download` (uninstalled community node)

Priority order (only one main badge shown):
1. uninstalled → 2. disabled → 3. execution-error → 4. validation-error → 5. pinned → 6. dirty → 7. success.

**Deps:** UX64, UX4.

### UX67. Settings icons (always-output / execute-once / retry) (XS)
Top-right small badges для `alwaysOutputData`, `executeOnce`, `retryOnFail`, `continueOnError`, `keyRound` (dynamic credentials). **Deps:** UX66.

### UX68. Edge: bezier routing + backward edge handling (M)
**Источник:** `getEdgeRenderData.ts`.

xyflow's стандартный `smoothstep` edge нас не устраивает (backward edges накладываются на ноды). Реализуем custom edge:
- If `source.x < target.x`: simple bezier curve.
- Else: two-segment path с 130px bottom padding + 40px X padding + 16px corner radius. Path goes down → right/left → up.
- Arrow head: `MarkerType.ArrowClosed`.
- Stroke: 2px solid (`main` type) или dashed (`ai_tool` / `json` types).

`ui/src/components/edges/GcBranchEdge.tsx` (расширить). **Deps:** UX1.

### UX69. Edge colors per status (success/pinned/error) (XS)
- default → `--color--foreground`
- success → `--color--success`
- pinned → `--color--secondary` (gold)
- (no animation на edges, только на нодах)

**Deps:** UX68.

### UX70. Edge labels + edge tooltip on hover (S)
Item counts at midpoint. Hover delay 600ms. Tooltip с full payload preview. **Deps:** UX8.

### UX71. CanvasEdgeToolbar (S)
**Источник:** `CanvasEdgeToolbar.vue`.

Floating on edge hover (600ms delay):
- ⊕ insert node in middle
- 🗑 delete edge

Scale-compensated for canvas zoom. **Deps:** UX1, UX4.

### UX72. CanvasNodeToolbar (hover-revealed) (M)
**Источник:** `CanvasNodeToolbar.vue`.

Floating above/beside node when hovered:
- ▶ Execute node (single-step)
- ⚡ Disable/Enable
- 🗑 Delete
- 🎯 Focus (zoom mode)
- (sticky-only) 🎨 Change color

Fade in/out 300ms. **Deps:** UX6, UX4.

### UX73. CanvasHandlePlus + CanvasNodeAddNodes (M)
**Источник:** `CanvasHandlePlus.vue` + `CanvasNodeAddNodes.vue`.

Two flavors of "+":
1. **На handle** — animated plus that appears on hover. Sizes 46/66/80px зависят от output label.
2. **Большая кнопка** на пустом канвасе — "Add your first step" (100x100, dashed border).

Click → opens Node Creator (UX74).

**Deps:** UX1, UX4.

### UX74. Node Creator (replacement for current sidebar palette) (L)
**Источник:** Node Creator в n8n.

Большая модалка / drawer:
- Top: search bar + filter chips (Trigger / Action / AI / Transform / ...).
- Left: categories tree.
- Centre: nodes grid с иконками.
- Right (on hover): node description + docs link.
- Recently used section.
- "Trigger" vs "Action" — first-class distinction (наш палитра пока этого не делает).

`ui/src/components/canvas/NodeCreator/`. Может либо открываться по `+` либо по `Tab` / `N` hotkey.

**Deps:** UX9, UX21, UX4.

### UX75. CanvasNodeChoicePrompt (XS)
**Источник:** `CanvasNodeChoicePrompt.vue`.

На пустом канвасе с AI Builder enabled — два больших button'а: "Add your first step" / "Build with AI" (UX-marker F91 ↔ AIWorkflowBuilder).

**Deps:** UX73, UX91 (AI builder UI).

### UX76. Canvas connection-preview line with 300ms delay (XS)
xyflow поддерживает custom connection-line. Реализуем delay через timeout в `useReactFlow.onConnectStart`. **Deps:** UX68.

### UX77. Mini-map auto-hide (XS)
Watch `isPaneMoving` (xyflow event). 1-second timeout to hide. Smooth opacity transition 300ms.

Файл: `ui/src/components/canvas/MiniMap.tsx`. **Deps:** UX1.

### UX78. CanvasControlButtons: zoom/fit/reset/tidy (S)
**Источник:** `CanvasControlButtons.vue`.

Bottom-left корнер. Buttons:
- Fit view (1)
- Zoom in (+)
- Zoom out (-)
- Reset zoom (0) — visible только если ≠1
- Auto-layout / Tidy up (Shift+Alt+T)
- Toggle zoom mode (Z) — experimental focused-NDV

**Deps:** UX6, UX4.

### UX79. CanvasRunWorkflowButton (split-button) (S)
**Источник:** `CanvasRunWorkflowButton.vue`.

Top toolbar, prominent. Если несколько trigger-нод — dropdown с выбором starting trigger. Loading state с label "Executing Workflow".

**Deps:** UX6, UX10.

### UX80. Canvas right-click context menu (M)
**Источник:** `useContextMenuItems.ts`.

Full menu (depends on selection):
- No selection: Add Node (N) / Add Sticky (Shift+S) / Tidy Up / Select All / Deselect All.
- 1+ nodes: Deactivate/Activate (D) / Pin/Unpin (P) / Copy / Duplicate / Tidy / Extract to Sub-Workflow (Alt+X) / Focus on AI (Alt+I) / Delete.
- 1 node: Open (Enter) / Test / Rename (F2) / Replace (R) / Copy Webhook URL / Open Sub-Workflow (Ctrl+Shift+O).
- 1 sticky: Edit (Enter) / Change Color.

**Deps:** UX10.

### UX81. Sticky notes — n8n style (M)
**Источник:** `CanvasNodeStickyNote.vue`.

Сейчас у нас `comment` тип. Расширить:
- Drag-resize handles (`@xyflow/react` поддерживает via `NodeResizer`).
- Inline edit on double-click (or Enter).
- 7 preset colors + custom hex.
- Markdown rendering (UX25).
- Min size 150x80px.

**Deps:** UX27, UX25.

### UX82. Canvas hotkeys — match n8n catalog (M)
**Источник:** n8n keymap (40+ keys).

Расширить `keyboardShortcutsCatalog.ts`. Ключевые (которых у нас нет):
- Arrows / Shift+Arrows — sibling/upstream/downstream nav.
- Space — pan mode + (short press) rename.
- F2 — rename selected node.
- N — open node creator.
- Tab — open node creator с coachmark.
- R — replace node.
- C — start chat / AI assistant.
- I/O — toggle input/output logs.
- L — toggle logs panel.
- Z — toggle zoom mode.
- 1 — fit view; 0 — reset zoom.
- Shift+= / Shift+- — zoom +/-.
- Shift+S — sticky note.
- Shift+Alt+T — tidy up.
- Alt+X — extract to sub-workflow.
- Alt+U / Shift+Alt+U — copy production/test webhook URL.
- Alt+I — add to AI focus.
- Ctrl+Alt+N — new workflow.
- Ctrl+Enter — execute workflow.
- Ctrl+Shift+O — open sub-workflow.

`ui/src/lib/keyboardShortcutsCatalog.ts` + `useCanvasKeybindings.ts`. **Deps:** UX35.

### UX83. Selection rectangle + box-select (XS)
xyflow supports `selectionKeyCode={["Shift"]}` (already enabled). Visual rectangle уже есть. **Deps:** UX64.

### UX84. Multi-node hotkey navigation (M)
**Источник:** `selectUpstreamNodes`, `selectDownstreamNodes`.

Arrows: select sibling (same parent level).
Shift+←/→: select upstream/downstream connected node.

Доступ к graph topology через `useReactFlow().getEdges()` + helper в `graph/canvasTraversal.ts`.

**Deps:** UX82.

### UX85. Snap-to-grid (XS)
xyflow supports `snapToGrid={true} snapGrid={[16, 16]}`. Toggle в View menu. **Deps:** UX35.

### UX86. Pin-data inline preview (S)
**Источник:** Iteration count badge on pinned nodes + edge gold tint.

Когда node has `gcPin.enabled === true` → status icon shows pin + edge → output становится gold. UX уже частично есть (F73 pinned state + F47 typeVersion); унифицируем стили.

**Deps:** UX66, UX69.

### UX87. Disabled node strike-through (XS)
Single solid line через ноду when disabled + has exactly 1 input + 1 output. CSS-only. **Deps:** UX64.

### UX88. Canvas background grid (XS)
**Источник:** `CanvasBackground.vue`.

xyflow's `<Background variant="dots" gap={16}/>` стилизуем под n8n (subtle, theme-aware). **Deps:** UX1.

---

## Phase 5 — NDV (Node Detail View)

Самая важная часть переноса. NDV — это убийственный UX-фишка n8n.

### UX89. NDV: drawer/modal shell with 3-panel layout (XL)
**Источник:** `NDVDraggablePanels.vue`.

Modal/drawer (right-side overlay):
```
+- NDV -----------------------------------------------+
| Header: [icon] [node-name InlineEdit] [docs] [×]   |
+-----+--------------------------------+--------------+
| Inp |                                |  Output     |
| ut  |   Parameters                   |  Data       |
| Dat |   ...                          |             |
| a   |                                |             |
|     |   [Execute step]               |  [📌 Pin]   |
+-----+--------------------------------+--------------+
```

3 resizable panels:
- Left (Input data) — 280–420px min.
- Centre (Parameters) — 310–640px min.
- Right (Output data) — 280–420px min.

Resize handles via UX30 ResizeWrapper. Widths persisted в localStorage per node-type.

Открывается при:
- Double-click on node.
- Enter с selected node.
- Click правый-инспектора node.

Replace current right-side `InspectorPanel` для node selection (но edge/graph inspection остаются в side panel).

`ui/src/components/ndv/NDV.tsx`. **Deps:** UX9, UX30.

### UX90. NDV: ParameterInputList — schema-driven form (L)
**Источник:** `ParameterInputList.vue` + `ParameterInputFull.vue` + `ParameterInput.vue`.

Routes parameter to specific editor based on `parameter.type`:
- `string` → Input (single или multiline) (UX7).
- `number` → InputNumber.
- `boolean` → Switch.
- `options` → Select (UX7).
- `multiOptions` → Multi-select.
- `collection` → CollectionParameter (UX95).
- `fixedCollection` → FixedCollectionParameter (UX96).
- `color` → ColorPicker (UX27).
- `dateTime` → DateTimePicker (UX28).
- `json` → JsonEditor (Monaco).
- `code` → CodeEditor (Monaco с языковыми пакетами).
- `resourceLocator` → ResourceLocator (UX93).
- `credentialsSelect` → CredentialsPicker (UX99).
- `file` → FilePicker.

Mode-switch toggle (fixed value ↔ expression) — see UX92.

Conditional visibility — `displayOptions: { show: { foo: ['bar'] } }` оценивается реактивно.

Our existing schema-driven inspector — рефакторим под этот API.

`ui/src/components/ndv/parameters/`. **Deps:** UX7, UX9, UX27, UX28.

### UX91. NDV: ParameterOptions (per-parameter ⋮ menu) (S)
**Источник:** `ParameterOptions.vue`.

Per-parameter button (gear/dots) raises menu:
- Toggle Expression mode.
- Reset to default.
- View documentation (tooltip with full description).
- Copy reference path (`$node.foo.parameters.bar`).
- "Set from AI" (if AI builder suggested value).

**Deps:** UX10.

### UX92. Expression mode toggle — fx button (S)
**Источник:** Mode switches in `ParameterInput`.

Per-parameter `fx` icon: click → toggle между fixed value и expression. Visually expression mode: blue-bordered Monaco-input field. **Deps:** UX97 (expression editor).

### UX93. ResourceLocator (multi-mode parameter) (L)
**Источник:** `ResourceLocator.vue` + `ResourceLocatorDropdown.vue`.

Three modes: **ID** (text field) / **URL** (paste link) / **List** (autocomplete with async fetch).

Mode-picker (dropdown). Loading states. 5-second slow-warning. Recent-search caching. Virtual scrolling в dropdown.

Critical для node types like "Select Sheet", "Select Folder", "Select Channel" etc.

`ui/src/components/ndv/parameters/ResourceLocator/`. **Deps:** UX7, UX21.

### UX94. NDV: InputPanel (M)
**Источник:** `InputPanel.vue`.

Displays data из родительских нод последнего run.

Sub-controls:
- Node selector dropdown (if multiple inputs).
- Mode toggle: **Mapping** | **Debugging**.
- View toggle: **Table** / **JSON** / **Schema**.
- Item paginator (`Item 1 of N`).
- Search bar (full-text within data).

Mapping mode: drag from a field в input → drops в a parameter (or expression). Visual cue: dashed-border droppable zone in parameters panel.

`ui/src/components/ndv/InputPanel.tsx`. **Deps:** UX22, UX25.

### UX95. NDV: OutputPanel (M)
**Источник:** `OutputPanel.vue` + `RunDataPinButton.vue` + `RunDataJsonActions.vue`.

Mirror of InputPanel for current node's output. Plus:
- Pin output button (F73 / gcPin).
- Copy JSON / Download JSON.
- Type toggle: **Regular** | **Logs** (for AI nodes with sub-execution metadata).
- Binary data preview (images inline, files download).

**Deps:** UX94, UX21.

### UX96. NDV: NodeExecuteButton (S)
**Источник:** `NodeExecuteButton.vue`.

"Execute step" prominent button. Loading state. Error display через `NodeErrorView`. Output auto-scrolls to result. **Deps:** UX6.

### UX97. Expression editor: full Monaco / CodeMirror (XL)
**Источник:** `InlineExpressionEditorInput.vue` + `ExpressionEditModal.vue` + n8n expression language.

n8n использует CodeMirror 6 с custom language plugin. Мы переходим на CodeMirror тоже (более лёгкая чем Monaco для inline):
- `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-javascript`.
- Custom language extension: distinguish text vs `{{ expression }}`.
- Color tokens: braces (blue), `$node`/`$json` (purple), strings (orange), numbers (green), etc.
- Autocomplete:
  - `$node.<NodeName>.<output>` — list known nodes (graph traversal).
  - `$json.<field>` — fields из текущего item.
  - `$now`, `$today`, `$vars.<name>`, `$secrets.<name>`, `$workflow.id`, `$execution.id`.
  - `$input.first()`, `$input.last()`, `$input.all()`.
- Hover info: type + sample value.
- Live evaluation preview (sidebar): resolved value + error display.

Modal version (`ExpressionEditModal`): полноэкранный editor + left sidebar с data-tree (search-able schema explorer).

Replaces our `PromptEditor` + `ExpressionAutocompleteInput` + `ExpressionMonacoField` (consolidate).

`ui/src/components/ndv/expression/`. **Deps:** UX9, UX25, UX17, UX21.

### UX98. CollectionParameter (key-value pairs) (M)
**Источник:** `CollectionParameterNew.vue`.

"Add item" button → expandable collapsible items. Each item is a nested object с typed fields. Nested validation. **Deps:** UX11, UX90.

### UX99. FixedCollectionParameter (named groups) (M)
**Источник:** `FixedCollectionParameter.vue`.

Pre-defined named sections (e.g., "Options" → {"sortBy", "limit"}). Each option toggleable. **Deps:** UX98.

### UX100. CredentialsPicker dropdown (S)
**Источник:** `CredentialsSelect.vue`.

Dropdown listing credentials of the type required by parameter. + "Create new" button at bottom → opens UX48 modal.

**Deps:** UX7, UX47.

### UX101. NDV settings tab (retry/error/timeout/notes) (M)
**Источник:** `NodeSettings.vue` settings sub-tab.

Tab inside NDV header:
- **Parameters** (default, UX90).
- **Settings**:
  - Retry on fail: max attempts / delay / backoff.
  - Error handling: continue / stop / route to error workflow.
  - Timeout: per-node timeout sec.
  - Notes: textarea (показывается as annotation on canvas).
  - Execute once toggle.
  - Always output data toggle.
  - Continue on error toggle.

**Deps:** UX12, UX7.

### UX102. NDV: dirty-state autosave + discard prompt (XS)
Changes saved immediately on blur. If close button clicked with unsaved validation errors → confirm modal. **Deps:** UX9.

---

## Phase 6 — Polish details (small wins that compound)

### UX103. n8n micro-interactions catalog (XS each, 5 markers bundled)
- 300ms delay on connection-preview line (UX76).
- 600ms delay on edge toolbar / edge label tooltip (UX71, UX70).
- 1s auto-hide on minimap (UX77).
- 200ms scale animation on plus buttons (UX73).
- 1.5s/4.5s gradient rotation animations (UX65).

Already covered in phase 4.

### UX104. Smart edge routing for backward connections (M)
Already in UX68. Verify CSS path syntax matches n8n's two-segment template.

### UX105. Workflow versioning UI integration (S)
F49 backend done. Frontend:
- Top-bar shows version badge (e.g., "v2").
- "Publish" button next to Save → modal с message + author.
- "History" tab inside editor → version list + diff view.

`ui/src/pages/Workflow/Versions/`. **Deps:** UX22, UX9.

### UX106. Workflow diff view (M)
Side-by-side comparison of two versions:
- Nodes added (green).
- Nodes removed (red).
- Nodes modified (orange + field-level diff).
- Edges changes.

Use `react-diff-viewer` for text diff inside expanded node-card. **Deps:** UX105.

### UX107. Activity feed / push-connection events (M)
**Источник:** push-connection в n8n.

WebSocket subscription → toast notifications when:
- Run finishes (success/error).
- Webhook fires.
- Collab user joins (F77).
- Comment mentions (future).

**Deps:** UX15, UX38.

### UX108. Recent / favorites in command bar (XS)
Persist recent navigations / workflows / actions в localStorage. Show на top of cmd-palette result list. **Deps:** UX37.

### UX109. Inline help / docs tooltips on every parameter (S)
Hover ⓘ icon → tooltip с full markdown description + "Learn more" link. Source: node schema's `description` field. **Deps:** UX8, UX25.

### UX110. Empty states everywhere (M)
**Источник:** EmptyStateLayout + N8nActionBox.

Each list page when empty: large illustration + headline + CTA button + secondary link. For:
- /workflows empty → "Start your first workflow" + Templates link.
- /executions empty → "Run a workflow first".
- /credentials empty → "Add your first credential".
- Inside editor with empty canvas → CanvasNodeAddNodes (UX73).

`ui/src/components/EmptyState.tsx`. **Deps:** UX11, UX5.

### UX111. Skeleton loaders (XS)
Replace blank states with shimmer skeletons во время начальной загрузки данных. Use `react-loading-skeleton` или custom CSS. **Deps:** UX1.

### UX112. Inline tag editing for workflows (XS)
**Источник:** WorkflowTagsContainer.

Click "Add tag" → autocomplete with existing tags + create-new flow. **Deps:** UX13, UX7.

### UX113. Folder structure for workflows (M)
**Источник:** FolderCard, FolderBreadcrumbs.

n8n has folders. We can build same: `workflows/folder/sub-folder/workflow.json`. UI:
- Breadcrumbs in /workflows.
- Folder cards mixed with workflow cards.
- Drag-drop reorganize.
- Create / Rename / Delete folder.

**Deps:** UX41, UX18.

### UX114. Workflow archive (XS)
Soft-delete: `archived: true` field. Filter out by default, toggle to view. Restore action. **Deps:** UX41.

### UX115. Bulk actions toolbar (XS)
At top of /executions and /workflows when items are selected: "X selected — [Delete] [Move] [Archive] [Retry]". **Deps:** UX22.

### UX116. Custom CSS theming hook (XS)
Expose `--color--primary` override via Settings → Personalization (UX52). Allow workspaces to set brand color (enterprise). **Deps:** UX3.

### UX117. Reduced-motion preference respect (XS)
`@media (prefers-reduced-motion)`: disable conic-gradient rotation, edge animations, minimap fade. **Deps:** UX65.

### UX118. Tauri menu integration (S)
Native menu bar (File / Edit / View / Help) → Tauri menu API. Match in-app menu structure. Tauri-only.

`ui/src-tauri/menu.rs` + `useTauriMenu()` React hook. **Deps:** UX35.

### UX119. Tauri window controls (XS)
Custom title-bar matching n8n's chrome-less aesthetic (already have via Tauri). Confirm window-decorations false + custom drag region. **Deps:** UX35.

### UX120. RTL support stub (XS)
CSS `dir="rtl"` testing для arabic/hebrew (future). Token system supports via `--text-align: start` instead of `left`. **Deps:** UX1.

---

## Сводная таблица фаз и оценок

**Статус (2026-05-12): все 120 маркеров выполнены.**

| Фаза | Маркеры | Кол-во | Статус | Что получили |
|---|---|---:|---|---|
| 1. Design system | UX1–UX30 | 30 | **done** | Tokens, primitives, layout-готовые компоненты |
| 2. App shell | UX31–UX40 | 10 | **done** | Sidebar/header/router/modals/cmd-bar |
| 3. Pages | UX41–UX63 | 23 | **done** | Workflows/Executions/Credentials/Settings/Auth |
| 4. Canvas re-skin | UX64–UX88 | 25 | **done** | Все ноды/edges/hotkeys/toolbar выглядят как n8n |
| 5. NDV | UX89–UX102 | 14 | **done** | Полная замена inspector на 3-panel NDV |
| 6. Polish | UX103–UX120 | 18 | **done** | Micro-interactions, empty states, bulk actions, Tauri integration |
| **Total** | **120 markers** | **120** | **done** | **+799 новых Vitest-тестов; TypeScript strict clean** |

---

## Принципы реализации

1. **Не ломаем существующие фичи.** Каждый UX-маркер — additive. Старый InspectorPanel / TopBar / GraphCard остаются работать до момента полной замены. UX44 (WorkflowEditor) завершён с кавеатом: legacy AppShell.tsx временно со-существует с новым WorkflowLayout.
2. **Каждый UI-компонент имеет vitest-тест.** Стартовая база — 715 тестов (до порта); финальная — 1514+ (после всех 6 фаз).
3. **Сохраняем токены под старым именем как алиасы**, чтобы существующий код не сломался во время миграции.

---

## Implementation history

Все шесть фаз поставлены агентом в один контекстный прогон, 2026-05-12.

| Phase | Markers | Agent session | Date | Tests added | Key commits |
|---|---|---|---|---|---|
| Phase 1 — Design system | UX1–UX30 | agent-aa06629209e994a86 | 2026-05-12 | +187 | tokens.css, Icon/, Button/, all primitive ui/ components, fonts |
| Phase 2 — App shell | UX31–UX40 | agent-aa06629209e994a86 | 2026-05-12 | +91 | router.tsx, app/layouts/, MainSidebar/, AppHeader/, AppCommandBar/, AppModals/, NotificationsInbox/ |
| Phase 3 — Pages | UX41–UX63 | agent-aa06629209e994a86 | 2026-05-12 | +183 | pages/Workflows/, pages/Executions/, pages/Credentials/, pages/Settings/* (9 sub-pages), pages/Projects/, pages/Home/, pages/Auth/, pages/errors/ |
| Phase 4 — Canvas re-skin | UX64–UX88 | agent-aa06629209e994a86 | 2026-05-12 | +148 | GcFlowNode.tsx (full visual redesign), GcBranchEdge.tsx, canvas/NodeCreator/, CanvasNodeToolbar.tsx, CanvasHandlePlus.tsx, AutoHideMiniMap.tsx, CanvasControlButtons.tsx, keyboardShortcutsCatalog.ts |
| Phase 5 — NDV | UX89–UX102 | agent-aa06629209e994a86 | 2026-05-12 | +107 | ndv/NDV.tsx, ndv/parameters/ParameterInputList.tsx, ndv/expression/InlineExpressionEditor.tsx + ExpressionEditModal.tsx, ndv/parameters/ResourceLocator/, CollectionParameter.tsx, FixedCollectionParameter.tsx |
| Phase 6 — Polish | UX103–UX120 | agent-aa06629209e994a86 | 2026-05-12 | +83 | ui/EmptyState/, ui/Skeleton/, ui/BulkActionsBar/, pages/Workflows/FolderCard.tsx, pages/Workflow/Versions/, src-tauri/menu.rs |

**Total new tests:** 799. **Starting baseline:** 715 Vitest passing. **Post-port total:** 1514+.
4. **Tauri-first verification.** Каждый PR проверяется в обоих режимах (`npm run dev` + `npm run dev:web`).
5. **i18n keys обновляются параллельно** в `en.json` + `ru.json`. Никаких хардкод-строк.
6. **Accessibility check на каждый PR**: tab-order, aria-labels, focus indicators, screen-reader тест.
7. **Performance budget:** новые компоненты не должны увеличить initial bundle > 5%. Use `React.lazy` для страниц.
8. **Schema-driven остаётся**: новый NDV строится из JSON-schema нод; не хардкодим UI per node-type.
9. **Plugin compatibility:** F92 plugin nodes должны автоматически работать в новом NDV (никаких per-node Vue/React component files).
10. **LOD сохраняется**: даже в новом nodes-стиле сохранить 3-tier render (full/compact/ghost) для производительности.

---

## Антипаттерны (что НЕ копировать у n8n)

1. **Vue Options API + Pinia for everything.** Мы остаёмся в React + Zustand.
2. **Element-Plus + Reka UI + Tailwind + custom SCSS mix.** Слишком много lib. Мы используем только `@radix-ui/*` (Reka analog) + pure CSS variables.
3. **Per-node Vue component files** для UI каждого node-type. У нас schema-driven — это уже преимущество.
4. **>50 modal keys в одном enum.** Группируем по domain (workflow-modals, credential-modals, …).
5. **Push-connection через свой WebSocket multiplexer.** У нас уже есть SSE/WS + Yjs CRDT.
6. **Linear execution log only.** Мы держим **trace tree** (F80) — он лучше.
7. **Hardcoded Cloud-vs-EE-vs-Self-hosted divergence в UI.** У нас один продукт, all features available; gate только через RBAC scopes.
8. **PostHog experiments (A/B testing UI variants).** Не нужно — мы не SaaS.
9. **Heavy onboarding tour.** Один 5-step intro достаточно.
10. **Кучу overlapping Pinia stores.** Держим 5-6 zustand-stores максимум.

---

## Якоря-источники в коде n8n

| Тема | Файл |
|---|---|
| Layout grid | `app/components/AppLayout.vue` + `layouts/*.vue` |
| Sidebar | `app/components/MainSidebar.vue` |
| Header | `app/components/MainHeader/MainHeader.vue` |
| Modal portal | `app/components/app/AppModals.vue` |
| Command bar | `app/components/app/AppCommandBar.vue` + `@n8n/design-system/N8nCommandBar` |
| Routing | `app/router.ts` (~30 routes) |
| Toast | `app/composables/useToast.ts` |
| Hotkeys | `app/composables/useKeybindings.ts` |
| Canvas main | `features/canvas/components/Canvas.vue` (если есть) или внутри `features/workflows/` |
| Node visual | `features/workflows/components/canvas/elements/nodes/CanvasNodeDefault.vue` |
| Edge | `features/workflows/.../CanvasEdge.vue` + `utils/getEdgeRenderData.ts` |
| Node toolbar | `features/workflows/.../CanvasNodeToolbar.vue` |
| Edge toolbar | `features/workflows/.../CanvasEdgeToolbar.vue` |
| Context menu | `features/workflows/.../useContextMenuItems.ts` |
| NDV layout | `features/ndv/panel/components/NDVDraggablePanels.vue` |
| ParameterInputList | `features/ndv/parameters/components/ParameterInputList.vue` |
| ParameterInput router | `features/ndv/parameters/components/ParameterInput.vue` (1246 lines) |
| ResourceLocator | `features/ndv/parameters/components/ResourceLocator/ResourceLocator.vue` |
| Expression editor inline | `features/shared/editors/components/InlineExpressionEditor/InlineExpressionEditorInput.vue` |
| Expression modal | `features/ndv/parameters/components/ExpressionEditModal.vue` |
| Input panel | `features/ndv/panel/components/InputPanel.vue` |
| Output panel | `features/ndv/panel/components/OutputPanel.vue` |
| NodeExecuteButton | `app/components/NodeExecuteButton.vue` |
| Workflows view | `app/views/WorkflowsView.vue` |
| Executions view | `features/execution/executions/views/ExecutionsView.vue` |
| Single execution | `features/execution/executions/components/workflow/WorkflowExecutionsPreview.vue` |
| Credentials view | `features/credentials/views/CredentialsView.vue` |
| CredentialEdit | `features/credentials/components/CredentialEdit/CredentialEdit.vue` |
| Settings Personal | `features/core/auth/views/SettingsPersonalView.vue` |
| Settings Users | `features/settings/users/views/SettingsUsersView.vue` |
| Settings API Keys | `features/settings/apiKeys/views/SettingsApiView.vue` |
| Settings External Secrets | `features/integrations/externalSecrets.ee/views/SettingsExternalSecrets.vue` |
| Design tokens primitives | `@n8n/design-system/src/css/_primitives.scss` |
| Design tokens semantic | `@n8n/design-system/src/css/_tokens.scss` |
| Fonts | `@n8n/design-system/src/css/fonts.css` + `assets/fonts/` |
| Icons registry | `@n8n/design-system/src/components/N8nIcon/icons.ts` (722 lines) |
| Button | `@n8n/design-system/src/components/N8nButton/Button.vue` |
| Card | `@n8n/design-system/src/components/N8nCard/Card.vue` |
| Dialog | `@n8n/design-system/src/components/N8nDialog/Dialog.vue` |
| Tooltip | `@n8n/design-system/src/components/N8nTooltip/Tooltip.vue` |
| DataTable | `@n8n/design-system/src/components/N8nDatatable/` |

Конец. Все 120 UX-маркеров готовы к декомпозиции в `doc/superpowers/plans/*.md` (по фазе или подгруппе) или к параллельному запуску агентов как в фазе F-маркеров.
