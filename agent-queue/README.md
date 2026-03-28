<!-- Copyright Aura. All Rights Reserved. -->

# `agent-queue` (Cursor Agent CLI)

Очередь промптов для headless-запуска `agent`: см. **`agent-queue.ps1 -Help`**.

## Текущая реализация (зафиксирована)

Используется **один** скрипт — **`agent-queue.ps1`**. Режим **stream-json** (по умолчанию): вывод CLI обрабатывается **конвейером PowerShell** (`& … 2>&1 | ForEach-Object` + разбор NDJSON в консоли), без отдельного async-pump на `System.Diagnostics.Process`. Длинный промпт (лимит командной строки Windows): **UTF-8** во временный файл, предпочтительно **node.exe + index.js** со **stdin**, иначе вспомогательный **PowerShell**-скрипт (`Get-Content | agent`). Опционально **`-StreamJsonInheritConsole`** — наследование консоли без перехвата stdout в скрипте.

**Не входят в эту реализацию** (в документации и инструментах на них не ориентироваться): отдельный **`agent-queue-2.ps1`**, NDJSON **CLI deep log** (`agent-queue-cli-deep-*.log`), **`-AgentQueueDebug`**, **`AGENT_QUEUE_DEBUG`**, **`AGENT_QUEUE_CLI_DEEP_*`**, отдельный **`agent-queue-watchdog-*.log`**, параметры **`-StreamFirstLineHeartbeatSeconds`** / **`-MaxMinutesWithoutFirstStdout`** и автоматическое «восстановление» по отсутствию stdout.

**После правок `agent-queue.ps1`:** см. [AUTOTESTS_CATALOG.md](../../docs/AUTOTESTS_CATALOG.md) §4.5.1 (smoke) и §4.5.2; обязательный ручной прогон с реальным **`agent`** — **`_diag-run-agent-queue-step.ps1`** (нужны CLI и сессия).

**Корень для Cursor (`-Workspace`, `--workspace`):** по умолчанию это каталог **рядом с `agent-queue/`**, в котором есть **`python/`** и **`ui/`** (корень **graph-caster**), а не «два уровня вверх» от `agent-queue` (иначе из `third_party/graph-caster/agent-queue` получался бы неверный `third_party`). Устаревшая схема **`scripts/agent-queue`**: если родитель папки `agent-queue` называется **`scripts`**, умолчание — **на два уровня вверх** (корень монорепозитория). Монитор выставляет то же правило в поле workspace.

**Относительные пути:** **`-PromptFile`**: не найден — пробуются `agent-queue/<path>`, `agent-queue/prompts/<path>`, `<workspace>/<path>`, `<workspace>/agent-queue/prompts/<path>`. **`-Superpower*Path`**: каталог скрипта, затем workspace.

**Новый пользователь (Windows):** один раз запустите **`monitor/build-monitor.bat`** в [папке монитора](monitor/) — установит Cursor CLI (официальный установщик), запишет пути и проверки в `monitor/CLI_SETUP.generated.txt` (локальный файл, в git не попадает) и соберёт GUI. После успешной сборки рядом с батником создаётся ярлык **`Agent Queue Monitor.lnk`** (тоже не коммитится). Сообщения в `.bat` на **английском** (только ASCII), чтобы `cmd.exe` на русской Windows не ломал разбор из‑за кодировки.

Если **`agent login`** в PowerShell падает с **PSSecurityException / running scripts is disabled**, запустите из `monitor/` **`cursor-agent-login.bat`** (один раз обходит политику для этого процесса, `RemoteSigned` для профиля не обязателен).

Пример пост-задачи (после фичи): см. [FEATURE_VERIFICATION_TEST_PROJECT.md §14](../../docs/FEATURE_VERIFICATION_TEST_PROJECT.md).

## Папка `prompts/`

Здесь только **действующие** файлы очереди — те, что выбираются как `-PromptFile` / из меню `run-agent-queue.bat` (файлы `*.txt`). Локальный оверрайд без коммита: **`agent-queue/agent-queue.prompts.local.txt`** рядом с `agent-queue.ps1`.

Сценарии совместной работы с Git (fetch/merge/push/проверка) **встроены** в **`prompts/agent-queue.pipeline.prompts.txt`**, **`prompts/agent-queue.autotests.pipeline.prompts.txt`** и **`prompts/agent-queue.general.pipeline.prompts.txt`**: в шапке файлов обычно только строка copyright (`#`); шаги merge/push/commit — **в теле** соответствующих блоков (разделитель **`---`**). Формат сообщений коммита и роли документов — [.cursor/rules/development-workflow.mdc](../../.cursor/rules/development-workflow.mdc); ссылки на спеки автотестов и матрицу **`AT-xxx`** — вводный абзац [AUTOTESTS_CATALOG.md](../../docs/AUTOTESTS_CATALOG.md) и [FEATURE_VERIFICATION_TEST_PROJECT.md](../../docs/FEATURE_VERIFICATION_TEST_PROJECT.md) §**15**.

**`run-agent-queue.bat` без аргументов** показывает нумерованный список всех `*.txt` из `prompts/`, затем запрашивает число циклов и **cycles per chat** (`-CyclesPerChat`), после чего запускает непрерывное выполнение до конца всех циклов.

### Git: синхронизация с remote перед коммитом

Канонический текст для агента — блок **«Синхронизация с remote перед коммитом»** внутри pipeline-файлов в `prompts/` (перед блоком коммита). В **`agent-queue.pipeline.prompts.txt`** шаги **1–6**; в **autotests** и **general** блок короче (без отдельного шага **6**) — при выравнивании правьте `prompts/` **только** с префиксом из [.cursor/rules/development-workflow.mdc](../../.cursor/rules/development-workflow.mdc) (**`РЕДАКТИРОВАНИЕ АВТОМТИЧЕСКИХ ЗАПРОСОВ`**). Ниже — полная логика для людей и поиска; при расхождении с `prompts/*.txt` для людей ориентир — **этот подраздел README**.

Синхронизация с remote перед коммитом (совместная работа с другим разработчиком).

Merge/rebase и конфликты реши самостоятельно; находи максимально рациональное и безопасное решение — не опрашивай пользователя. Выбери самый безопасный и соответствующий политике ветки вариант; при неоднозначности предпочитай merge без force на общих ветках.

1) `git status` — в коммит попадает только задуманное; нет лишних файлов.  
2) `git fetch` (обычно `origin`).  
3) Влей изменения с отслеживаемой веткой: `git merge origin/<текущая-ветка>` или подходящий `rebase` по истории ветки и политике; базу смотри в `git branch -vv`.  
4) Конфликты: для каждого файла с маркерами смотри механику через `git diff` / рабочее дерево; смысл изменений с каждой стороны — через `git log`, `git show`; объедини смысл своих и чужих правок, не откатывай чужой фикс без причины; в отчёте — кратко, без полного пересказа истории; затем `git add` только по разрешённым файлам (без лишнего scope).  
5) После успешного слияния и до push — минимальная проверка (релевантный smoke: скрипт, compose validate, или указанный в изменениях шаг), чтобы не переносить дальше сломанное разрешение. Опционально после push — смотреть CI/политику команды; это не замена проверке до push.  
6) **`git push --force`** на **общих** ветках не использовать. Push на этом шаге не выполняй — только синхронизация и готовность к следующему блоку (коммит). Если безопасно влить нельзя — зафиксируй в отчёте шаги для ручного вмешательства. Если force-push допустим только по политике ветки — зафиксируй причину в сообщении коммита или в принятом у команды трекере; не применяй `--force` без оснований из политики репозитория (см. [.cursor/rules/development-workflow.mdc](../../.cursor/rules/development-workflow.mdc)).

Сообщение коммита и теги — [.cursor/rules/development-workflow.mdc](../../.cursor/rules/development-workflow.mdc).

## Файлы pipeline (встроенный порядок шагов)

Для **трёх** имён файлов в `prompts/` `agent-queue.ps1` по умолчанию включает тот же режим, что и для основного pipeline (минимум **3** блока `---`; см. справку):

| Файл | Назначение |
|------|------------|
| `prompts/agent-queue.pipeline.prompts.txt` | Итерации по разработке фичи (brainstorming → **writing-plans** → **executing-plans** → ревью → коммит → следующая задача). Инъекция скиллов: `superpowers/*.md` при префиксах `/brainstorming`, `/writing-plans`, `/executing-plans`, `/requesting-code-review` (`agent-queue.ps1 -Help`). |
| `prompts/agent-queue.autotests.pipeline.prompts.txt` | Итерации по автотестам: приоритет AT-xxx, ревью тестов, коммит, следующий шаг (см. заголовок файла). |
| `prompts/agent-queue.general.pipeline.prompts.txt` | Сквозная автоматизация разработки репозитория: инфраструктура, DX, CI, скрипты, документация для разработчиков (не привязка к одной фиче сервиса). |

Пример (автотесты, `N` циклов):

```text
.\agent-queue\agent-queue.ps1 -PromptFile .\agent-queue\prompts\agent-queue.autotests.pipeline.prompts.txt -Cycles N -Mode agent
```

Пример (общая автоматизация репозитория, `N` циклов):

```text
.\agent-queue\agent-queue.ps1 -PromptFile .\agent-queue\prompts\agent-queue.general.pipeline.prompts.txt -Cycles N -Mode agent
```

(В монорепозитории Aura путь к скрипту может быть `.\third_party\graph-caster\agent-queue\...` — укажите свой префикс относительно **`-Workspace`**.)

Линейный порядок блоков **без** встроенного pipeline-шаблона: **`-Sequential -PromptFile ...`** (см. `-Help`).

## GUI: `monitor/` (Agent Queue Monitor)

Windows-приложение (**`dotnet run`** или сборка в `monitor/bin/`) запускает `agent-queue.ps1` **в отдельном окне консоли** (вывод Cursor Agent — там, без перенаправления stdout). В мониторе — краткий статус из `agent-queue.monitor-status.json` (между шагами) и таймер с последнего обновления этого файла.

- **Стоп** — принудительно завершает процесс `pwsh` + дочерний `agent`.
- **После цикла** — создаётся файл **`agent-queue.finish-after-cycle.flag`** рядом с `agent-queue.ps1`. После полного завершения текущего **цикла** pipeline (или **раунда** в sequential) скрипт удаляет файл и **выходит** до следующего цикла/раунда.
- **Начинать в новом чате** (галочка по умолчанию включена) — если снять, первый промпт запускается с **`agent-queue.ps1 -ContinueFirstPrompt`** (первый вызов с `--continue`: продолжить последний чат Cursor для workspace). Если включена — как раньше, первый промпт без `--continue`.
- **Таймер автоперезапуска, с** — по умолчанию **800**. Монитор всегда передаёт **`-StallRestartSeconds T`** и **`AGENT_QUEUE_STALL_RESTART_SECONDS`**. Пока идёт **текущий шаг**, автоперезапуск (флаг, как у кнопки), когда **возраст последней записи** **`agent-queue.monitor-status.json`** **строго больше T секунд**. Завершается **только** процесс агента, шаг запускается снова. **0** — только ручной перезапуск. В CLI **`agent-queue.ps1`** тот же дефолт **800** (для таймера только по минутам: **`-StallRestartSeconds 0 -StallRestartMinutes M`**, иначе минуты не применяются). Раньше было **«пауза + простой»**; сейчас в UI одно число — **полная длительность таймера** в секундах.
- Аргумент **`-StallRestartGraceSeconds`** в CLI **на перезапуск по таймеру не влияет** (оставлен для совместимости скрипта).
- Монитор всегда передаёт **`-StallAllowManualRetry`** (и **`AGENT_QUEUE_STALL_ALLOW_MANUAL=1`**) — чтобы работала кнопка **«Перезапустить шаг сейчас»**: создаётся файл **`agent-queue.manual-stall-retry.flag`** рядом со скриптом; при следующем опросе завершается только текущий вызов CLI и **шаг перезапускается**. Без **`-StallAllowManualRetry`** и при **T = 0** ручной флаг из консоли не обрабатывается (нужен хотя бы автоматический таймер или явный **`-StallAllowManualRetry`**).
- Галочки **«Скрыть размышление»** и **«Стримить текст по частям»** в мониторе задаются через **`AGENT_QUEUE_HIDE_THINKING`** и **`AGENT_QUEUE_ASSISTANT_STREAM_DELTA`** (`0` или `1`), а не через аргументы вида **`-HideThinking:$false`** — так надёжнее для запуска `pwsh -File` из GUI. В `agent-queue.ps1` значения **`1`/`0`** переопределяют параметры **`-HideThinking`** / **`-AssistantStreamDelta`**, если переменные заданы.

## Backlog (отложено после ревью)

| Задача | Причина откладывания |
|--------|----------------------|
| **DRY:** вычисление `cycleInSession` / метки сессии в одном месте с `Get-PipelineOrderForGlobalCycle` | Рефакторинг границ функций; сейчас дублирование синхронизировано вручную, риск рассинхрона при будущих правках. |
| **Регрессии:** smoke-проверки или таблица ожидаемых последовательностей индексов для N∈{3,4,7} и сценариев `Cycles` / `CyclesPerChat` | Нужен отдельный скрипт/тесты или фиксация в доке; без изменения поведения `agent-queue.ps1`. |
| **Внешние ссылки на пути** | Wiki/чеклисты вне репозитория со старым путём к `*.prompts.txt` **без** `prompts/` — обновить при обнаружении (после переноса шаблонов в `prompts/`). |
