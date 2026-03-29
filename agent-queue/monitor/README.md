<!-- Copyright GraphCaster. All Rights Reserved. -->

# Agent Queue Monitor (WPF)

Windows GUI рядом с [`agent-queue.ps1`](../agent-queue.ps1): выбор `prompts/*.txt`, параметры скрипта, запуск **в отдельном окне консоли** (`pwsh` без перенаправления stdout — так же удобно для Cursor Agent CLI, рассчитанного на интерактивную консоль). Поле **workspace** по умолчанию — корень проекта для Cursor: каталог с `python/` и `ui/` рядом с `agent-queue/` (graph-caster), либо на два уровня вверх для схемы `scripts/agent-queue/`. В окне монитора — краткий статус из файла `agent-queue.monitor-status.json` (скрипт пишет его между шагами: текущий/следующий блок, сводка, при инъекции — поле **`superpower`**, например `writing-plans` / `executing-plans`), таймер «с последнего обновления статуса», кнопки **Старт** / **Стоп** / **После цикла** (файл `agent-queue.finish-after-cycle.flag` — см. [../README.md](../README.md)). Пути к Markdown-скиллам и подмешивание в промпт задаёт [`agent-queue.ps1`](../agent-queue.ps1): префиксы **`/brainstorming`**, **`/requesting-code-review`**, **`/writing-plans`**, **`/executing-plans`** при старте строки блока; файлы по умолчанию в **`superpowers/`** рядом со скриптом. Аргументы **`-Superpower*Path`** и **`-PromptFile`** могут быть относительными: сначала от каталога `agent-queue.ps1`, затем от **`-Workspace`**.

## Требования

- Windows
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (для сборки)
- **PowerShell:** для запуска `agent-queue.ps1` нужен реальный **`pwsh`** (PowerShell 7+) или **Windows PowerShell** (`powershell.exe`). Заглушки **App execution aliases** в `%LOCALAPPDATA%\Microsoft\WindowsApps\` (ложный `pwsh.exe` из магазина) **не используются** — иначе процесс часто сразу завершался с кодом **1** без работы очереди.
- **Cursor Agent CLI** (`agent` в PATH или `%LOCALAPPDATA%\cursor-agent\agent.cmd`). Первичная установка: в этой папке запустите **`build-monitor.bat`** (см. [../README.md](../README.md)).

## Если после «Старт» сразу «код 1»

1. Откройте **отдельное консольное окно**, которое создал монитор: там полный вывод `agent-queue.ps1` и Cursor CLI.
2. Убедитесь, что в этом окне работает **`agent status`** (логин / `CURSOR_API_KEY`). Подсказки в скрипте: «Fix auth first…».
3. Если консоль почти пустая и сразу выход: проверьте, что в PATH есть **настоящий** `pwsh` (или используется `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`) — см. требование выше про WindowsApps.

## Сборка и запуск

Из корня репозитория:

```powershell
dotnet build -c Release scripts/agent-queue/monitor/AgentQueueMonitor.csproj
```

Юнит-тесты (парсинг вывода `agent models` / ANSI / JSON-массив, без реального CLI):

```powershell
dotnet test -c Release scripts/agent-queue/monitor/AgentQueueMonitor.Tests/AgentQueueMonitor.Tests.csproj
```

Запуск:

```powershell
dotnet run --project scripts/agent-queue/monitor
```

Или запуск собранного `AgentQueueMonitor.exe` из `scripts/agent-queue/monitor/bin/Release/net8.0-windows/`.

**Стоп** завершает дерево процессов (`pwsh` и дочерний `agent`). При **Старте** существующий `agent-queue.finish-after-cycle.flag` удаляется.

Список **моделей** заполняется из Cursor CLI (**`agent models`**; исполняемый файл в GUI не выбирается — всегда **`agent`**). При отсутствии CLI — запасной вариант `composer-2`. Редактировать id модели вручную нельзя.

Поле **«Количество циклов к выполнению»** (`-Cycles`) задаёт число циклов при автоматическом порядке шагов (как в скрипте по имени файла). Явный **`-Sequential`** / **`-PipelineOrder`** из окна монитора не задаётся — для линейного порядка или принудительного pipeline запускайте `agent-queue.ps1` вручную. Пауза между шагами (`-DelaySeconds`) в окне не настраивается.
