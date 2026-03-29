<!-- Copyright GraphCaster. All Rights Reserved. -->

# `agent-queue` (Cursor Agent CLI)

Очередь промптов для headless-запуска `agent`: см. **`agent-queue.ps1 -Help`**.

## Текущая реализация (зафиксирована)

Используется **один** скрипт — **`agent-queue.ps1`**. Режим **stream-json** (по умолчанию): вывод CLI обрабатывается **конвейером PowerShell** (`& … 2>&1 | ForEach-Object` + разбор NDJSON в консоли), без отдельного async-pump на `System.Diagnostics.Process`. Длинный промпт (лимит командной строки Windows): **UTF-8** во временный файл, предпочтительно **node.exe + index.js** со **stdin**, иначе вспомогательный **PowerShell**-скрипт (`Get-Content | agent`). Опционально **`-StreamJsonInheritConsole`** — наследование консоли без перехвата stdout в скрипте.

**Не входят в эту реализацию** (в документации и инструментах на них не ориентироваться): отдельный **`agent-queue-2.ps1`**, NDJSON **CLI deep log** (`agent-queue-cli-deep-*.log`), **`-AgentQueueDebug`**, **`AGENT_QUEUE_DEBUG`**, **`AGENT_QUEUE_CLI_DEEP_*`**, отдельный **`agent-queue-watchdog-*.log`**, параметры **`-StreamFirstLineHeartbeatSeconds`** / **`-MaxMinutesWithoutFirstStdout`** и автоматическое «восстановление» по отсутствию stdout.

**После правок `agent-queue.ps1`:** быстрый smoke без реального **`agent`** — **`agent-queue.ps1 -DryRun`** с однострочным **`-PromptFile`** (в выводе есть **`Would run:`**) и/или **`-AgentQueueSmokeTest -PromptFile .../agent-queue.prompts.example.txt`** (long-prompt path); обязательный ручной прогон с реальным **`agent`** — **`_diag-run-agent-queue-step.ps1`** (нужны CLI и сессия).

**Корень для Cursor (`-Workspace`, `--workspace`):** по умолчанию это каталог **рядом с `agent-queue/`**, в котором есть **`python/`** и **`ui/`** (корень **GraphCaster**), а не «два уровня вверх» от `agent-queue`. Устаревшая схема **`scripts/agent-queue`**: если родитель папки `agent-queue` называется **`scripts`**, умолчание — **на два уровня вверх** (корень внешнего дерева, где лежит этот субкаталог). Монитор выставляет то же правило в поле workspace.

**Относительные пути:** **`-PromptFile`**: не найден — пробуются `agent-queue/<path>`, `agent-queue/prompts/<path>`, `<workspace>/<path>`, `<workspace>/agent-queue/prompts/<path>`. **`-Superpower*Path`**: каталог скрипта, затем workspace.

**Новый пользователь (Windows):** один раз запустите **`monitor/build-monitor.bat`** в [папке монитора](monitor/) — установит Cursor CLI (официальный установщик), запишет пути и проверки в `monitor/CLI_SETUP.generated.txt` (локальный файл, в git не попадает) и соберёт GUI. После успешной сборки рядом с батником создаётся ярлык **`Agent Queue Monitor.lnk`** (тоже не коммитится). Сообщения в `.bat` на **английском** (только ASCII), чтобы `cmd.exe` на русской Windows не ломал разбор из‑за кодировки.

Если **`agent login`** в PowerShell падает с **PSSecurityException / running scripts is disabled**, запустите из `monitor/` **`cursor-agent-login.bat`** (один раз обходит политику для этого процесса, `RemoteSigned` для профиля не обязателен).

Пост-задача и нормы коммита — по правилам **вашей** команды (GraphCaster их не навязывает).

## Папка `prompts/`

Здесь только **действующие** файлы очереди — те, что выбираются как `-PromptFile` / из меню `run-agent-queue.bat` (файлы `*.txt`). Локальный оверрайд без коммита: **`agent-queue/agent-queue.prompts.local.txt`** рядом с `agent-queue.ps1`.

Сценарии совместной работы с Git (fetch/merge/push/проверка) **встроены** в **`prompts/agent-queue.*.pipeline.prompts.txt`** (минимальный поставляемый вариант — **graphcaster**): в шапке файлов обычно только строка copyright (`#`); шаги merge/push/commit — **в теле** соответствующих блоков (разделитель **`---`**). Дополнительные pipeline-файлы с другими именами команда может держать у себя в этом каталоге.

**`run-agent-queue.bat` без аргументов** показывает нумерованный список всех `*.txt` из `prompts/`, затем запрашивает число циклов и **cycles per chat** (`-CyclesPerChat`), после чего запускает непрерывное выполнение до конца всех циклов.

### Git: синхронизация с remote перед коммитом

Краткий ориентир (детали — внутри ваших pipeline-файлов в `prompts/` или в политике команды):

1) `git status` — в коммит только запланированное.  
2) `git fetch` (обычно `origin`).  
3) `git merge origin/<ветка>` или `rebase` — по политике репозитория.  
4) Конфликты: разрешить с сохранением смысла обеих сторон; `git add` только по снятым файлам.  
5) До `push` — минимальный smoke по типу изменений.  
6) На общих ветках не использовать **`git push --force`** без явной политики.

## Файлы pipeline (встроенный порядок шагов)

Для имён вида **`agent-queue.*.pipeline.prompts.txt`** в `prompts/` при явном **`-PromptFile`** `agent-queue.ps1` включает встроенный порядок шагов pipeline (минимум **3** блока `---`; см. `-Help`). **Умалчиваемого файла промптов нет:** если **`-PromptFile` не задан**, подставляются только **`agent-queue.prompts.local.txt`** или **`agent-queue.prompts.txt`** (рядом со скриптом или в `prompts/`).

| Файл | Назначение |
|------|------------|
| `prompts/agent-queue.graphcaster.pipeline.prompts.txt` | Pipeline по умолчанию для работы в дереве **GraphCaster** (см. заголовок и блоки файла). |

Дополнительные `agent-queue.*.pipeline.prompts.txt` команда может добавлять под свои процессы (другой репозиторий, отдельный модуль) — пути в примерах ниже задайте относительно **`-Workspace`**.

Пример (`N` циклов):

```text
.\agent-queue\agent-queue.ps1 -PromptFile .\agent-queue\prompts\agent-queue.graphcaster.pipeline.prompts.txt -Cycles N -Mode agent
```

Линейный порядок блоков **без** встроенного pipeline-шаблона: **`-Sequential -PromptFile ...`** (см. `-Help`).

## GUI: `monitor/` (Agent Queue Monitor)

Windows-приложение (**`dotnet run`** или сборка в `monitor/bin/`) запускает `agent-queue.ps1` **в отдельном окне консоли** (вывод Cursor Agent — там, без перенаправления stdout). В мониторе — краткий статус из `agent-queue.monitor-status.json` (между шагами) и таймер с последнего обновления этого файла.

- **Стоп** — принудительно завершает процесс `pwsh` + дочерний `agent`.
- **После цикла** — создаётся файл **`agent-queue.finish-after-cycle.flag`** рядом с `agent-queue.ps1`. После полного завершения текущего **цикла** pipeline (или **раунда** в sequential) скрипт удаляет файл и **выходит** до следующего цикла/раунда.
- **Начинать в новом чате** (галочка по умолчанию включена) — если снять, первый промпт запускается с **`agent-queue.ps1 -ContinueFirstPrompt`** (первый вызов с `--continue`: продолжить последний чат Cursor для workspace). Если включена — как раньше, первый промпт без `--continue`.
- **Таймер автоперезапуска, с** — по умолчанию **1200**. Монитор всегда передаёт **`-StallRestartSeconds T`** и **`AGENT_QUEUE_STALL_RESTART_SECONDS`**. Пока идёт **текущий шаг**, автоперезапуск (флаг, как у кнопки), когда **возраст последней записи** **`agent-queue.monitor-status.json`** **строго больше T секунд**. Завершается **только** процесс агента, шаг запускается снова. **0** — только ручной перезапуск. В CLI **`agent-queue.ps1`** тот же дефолт **1200** (для таймера только по минутам: **`-StallRestartSeconds 0 -StallRestartMinutes M`**, иначе минуты не применяются). Раньше было **«пауза + простой»**; сейчас в UI одно число — **полная длительность таймера** в секундах.
- Аргумент **`-StallRestartGraceSeconds`** в CLI **на перезапуск по таймеру не влияет** (оставлен для совместимости скрипта).
- Монитор всегда передаёт **`-StallAllowManualRetry`** (и **`AGENT_QUEUE_STALL_ALLOW_MANUAL=1`**) — чтобы работала кнопка **«Перезапустить шаг сейчас»**: создаётся файл **`agent-queue.manual-stall-retry.flag`** рядом со скриптом; при следующем опросе завершается только текущий вызов CLI и **шаг перезапускается**. Без **`-StallAllowManualRetry`** и при **T = 0** ручной флаг из консоли не обрабатывается (нужен хотя бы автоматический таймер или явный **`-StallAllowManualRetry`**).
- В GUI монитора зафиксировано: исполняемый файл CLI **`agent`**, **`-OutputFormat`** не передаётся (в скрипте по умолчанию **stream-json**), **trust/force** без **`-NoTrust`/`-NoForce`**, порядок шагов только **авто** (без **`-PipelineOrder`/`-Sequential`**), **`AGENT_QUEUE_HIDE_THINKING=0`**, стрим дельт включён: **`-AssistantStreamDelta`** и **`AGENT_QUEUE_ASSISTANT_STREAM_DELTA=1`**. **`-StreamBufferIdleMs`** из монитора не передаётся (в скрипте по умолчанию **0**). Остальное (workspace, модель, mode, cycles и т.д.) — поля окна. Для **pipeline/sequential**, другого exe или формата вывода используйте ручной запуск **`agent-queue.ps1`**.

## Backlog (отложено после ревью)

| Задача | Причина откладывания |
|--------|----------------------|
| **DRY:** вычисление `cycleInSession` / метки сессии в одном месте с `Get-PipelineOrderForGlobalCycle` | Рефакторинг границ функций; сейчас дублирование синхронизировано вручную, риск рассинхрона при будущих правках. |
| **Регрессии:** smoke-проверки или таблица ожидаемых последовательностей индексов для N∈{3,4,7} и сценариев `Cycles` / `CyclesPerChat` | Нужен отдельный скрипт/тесты или фиксация в доке; без изменения поведения `agent-queue.ps1`. |
| **Внешние ссылки на пути** | Wiki/чеклисты вне репозитория со старым путём к `*.prompts.txt` **без** `prompts/` — обновить при обнаружении (после переноса шаблонов в `prompts/`). |
