// Copyright GraphCaster. All Rights Reserved.

using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace AgentQueueMonitor;

public partial class MainWindow : Window
{
    private const string FixedCursorAgentExe = "agent";

    private string _agentQueueDir = "";
    private string _repoRoot = "";
    private Process? _process;
    private readonly DispatcherTimer _stallTimer;
    private string? _modelsAgentKey;

    private string _monitorStatusPath = "";
    private DateTime _lastStatusActivityUtc;
    private DateTime _processStartUtc;

    private int _logHeightSyncDeferrals;

    private string? _lastLoggedMonitorPhase;

    private int? _lastLoggedPromptBlockIndex;

    private readonly string _stallDebugLogPath;
    private readonly object _stallDebugLogLock = new();
    private DateTime _lastStallHeartbeatDebugUtc;
    private DateTime _lastSkipStallFlagDebugUtc;

    public MainWindow()
    {
        InitializeComponent();
        _stallDebugLogPath = Path.Combine(AppContext.BaseDirectory, "agent-queue-stall-debug.log");
        try
        {
            AppendStallDebugLogLine($"=== monitor process start pid={Environment.ProcessId} baseDir={AppContext.BaseDirectory} ===");
        }
        catch
        {
        }
        try
        {
            _agentQueueDir = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(AppContext.BaseDirectory);
            _repoRoot = AgentQueuePathFinder.GetDefaultCursorWorkspace(_agentQueueDir);
            TxtWorkspace.Text = _repoRoot;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Не найден agent-queue.ps1: " + ex.Message, "Agent Queue Monitor", MessageBoxButton.OK, MessageBoxImage.Error);
        }

        _stallTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _stallTimer.Tick += (_, _) => UpdateStallDisplay();
        Loaded += (_, _) =>
        {
            RefreshPromptFiles();
            RefreshModelList();
            AppendLog("Монитор готов. События приложения и статус agent-queue — ниже; вывод Cursor Agent — в отдельном окне консоли. Текст в этом окне очищается только при выходе; файл agent-queue-stall-debug.log рядом с exe очищается при каждом запуске очереди (Старт).");
            AppendStallDebugLogLine("Monitor UI ready; stall/file log: " + _stallDebugLogPath);
            ParamsStackPanel.SizeChanged += (_, _) => SyncLogHeightToParams();
            ParamsScrollViewer.SizeChanged += (_, _) => SyncLogHeightToParams();
            SizeChanged += (_, _) => SyncLogHeightToParams();
            ContentRendered += (_, _) => ScheduleSyncLogHeight();
            ScheduleSyncLogHeight();
        };
    }

    private void ScheduleSyncLogHeight()
    {
        Dispatcher.BeginInvoke(SyncLogHeightToParams, DispatcherPriority.Loaded);
        Dispatcher.BeginInvoke(SyncLogHeightToParams, DispatcherPriority.Render);
        Dispatcher.BeginInvoke(SyncLogHeightToParams, DispatcherPriority.ContextIdle);
    }

    private void SyncLogHeightToParams()
    {
        if (ParamsStackPanel == null || TxtLog == null)
        {
            return;
        }

        if (ParamsStackPanel.ActualHeight < 1)
        {
            if (_logHeightSyncDeferrals < 12)
            {
                _logHeightSyncDeferrals++;
                Dispatcher.BeginInvoke(SyncLogHeightToParams, DispatcherPriority.Render);
            }

            return;
        }

        _logHeightSyncDeferrals = 0;

        var h = Math.Max(72, ParamsStackPanel.ActualHeight);
        if (double.IsNaN(h) || double.IsInfinity(h))
        {
            return;
        }

        var current = TxtLog.Height;
        if (!double.IsNaN(current) && Math.Abs(current - h) <= 0.5)
        {
            return;
        }

        TxtLog.Height = h;
    }

    private string FinishFlagPath => Path.Combine(_agentQueueDir, "agent-queue.finish-after-cycle.flag");

    private void RefreshPromptFiles()
    {
        PromptFilesList.Items.Clear();
        var promptsDir = Path.Combine(_agentQueueDir, "prompts");
        if (Directory.Exists(promptsDir))
        {
            foreach (var f in Directory.GetFiles(promptsDir, "*.txt"))
            {
                PromptFilesList.Items.Add(Path.GetFileName(f));
            }
        }

        var local = Path.Combine(_agentQueueDir, "agent-queue.prompts.local.txt");
        if (File.Exists(local))
        {
            PromptFilesList.Items.Add("agent-queue.prompts.local.txt");
        }

        if (PromptFilesList.Items.Count > 0)
        {
            PromptFilesList.SelectedIndex = 0;
        }
    }

    private void RefreshModelList()
    {
        var exe = FixedCursorAgentExe;

        var prev = (CmbModel.SelectedItem as string)?.Trim();
        if (string.IsNullOrEmpty(prev))
        {
            prev = "composer-2";
        }

        var models = FetchModelsFromCli(exe);
        CmbModel.Items.Clear();
        foreach (var m in models)
        {
            CmbModel.Items.Add(m);
        }

        string? pick = null;
        foreach (var m in models)
        {
            if (string.Equals(m, prev, StringComparison.OrdinalIgnoreCase))
            {
                pick = m;
                break;
            }
        }

        if (pick == null)
        {
            foreach (var m in models)
            {
                if (string.Equals(m, "composer-2", StringComparison.OrdinalIgnoreCase))
                {
                    pick = m;
                    break;
                }
            }
        }

        if (pick == null && models.Count > 0)
        {
            pick = models[0];
        }

        if (pick != null)
        {
            CmbModel.SelectedItem = pick;
        }

        _modelsAgentKey = exe;
    }

    private void PromptFilesList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PromptFilesList.SelectedItem is not string name)
        {
            return;
        }

        var path = name == "agent-queue.prompts.local.txt"
            ? Path.Combine(_agentQueueDir, name)
            : Path.Combine(_agentQueueDir, "prompts", name);
        TxtCurrentStep.Text = "Файл: " + name;
        _ = path;
    }

    private bool TryBuildAgentQueueProcessStartInfo(
        bool clearMonitorStatusFiles,
        out ProcessStartInfo? psi,
        out string? errorMessage)
    {
        psi = null;
        errorMessage = null;

        if (PromptFilesList.SelectedItem is not string fileName)
        {
            errorMessage = "Выберите файл промптов.";
            return false;
        }

        var promptPath = fileName == "agent-queue.prompts.local.txt"
            ? Path.Combine(_agentQueueDir, "agent-queue.prompts.local.txt")
            : Path.Combine(_agentQueueDir, "prompts", fileName);

        if (!File.Exists(promptPath))
        {
            errorMessage = "Файл не найден: " + promptPath;
            return false;
        }

        _monitorStatusPath = Path.Combine(_agentQueueDir, "agent-queue.monitor-status.json");

        if (clearMonitorStatusFiles)
        {
            if (File.Exists(FinishFlagPath))
            {
                try
                {
                    File.Delete(FinishFlagPath);
                }
                catch
                {
                }
            }

            try
            {
                if (File.Exists(_monitorStatusPath))
                {
                    File.Delete(_monitorStatusPath);
                }
            }
            catch
            {
            }

            try
            {
                var manualFlag = Path.Combine(_agentQueueDir, "agent-queue.manual-stall-retry.flag");
                if (File.Exists(manualFlag))
                {
                    File.Delete(manualFlag);
                }
            }
            catch
            {
            }
        }

        var psiInner = new ProcessStartInfo
        {
            FileName = FindPwshExecutable(),
            UseShellExecute = false,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
            CreateNoWindow = false,
            WorkingDirectory = _repoRoot
        };

        psiInner.Environment["AGENT_QUEUE_MONITOR_STATUS"] = _monitorStatusPath;
        psiInner.Environment["AGENT_QUEUE_DEBUG_LOG_PATH"] = _stallDebugLogPath;
        psiInner.Environment["AGENT_QUEUE_DEBUG_LOG_NO_RESET"] = "1";
        psiInner.Environment["AGENT_QUEUE_STALL_ALLOW_MANUAL"] = "1";
        psiInner.Environment["AGENT_QUEUE_HIDE_THINKING"] = "0";
        psiInner.Environment["AGENT_QUEUE_ASSISTANT_STREAM_DELTA"] = "1";

        const int defaultStallRestartSeconds = 1200;
        const int maxStallRestartSeconds = 604800;
        var stallRestartSecondsForArgs = defaultStallRestartSeconds;
        if (int.TryParse(TxtStallRestartSeconds?.Text?.Trim() ?? "", out var stallParsed) && stallParsed >= 0)
        {
            stallRestartSecondsForArgs = stallParsed > maxStallRestartSeconds ? maxStallRestartSeconds : stallParsed;
        }

        psiInner.Environment["AGENT_QUEUE_STALL_RESTART_SECONDS"] = stallRestartSecondsForArgs.ToString();

        psiInner.ArgumentList.Add("-NoProfile");
        psiInner.ArgumentList.Add("-ExecutionPolicy");
        psiInner.ArgumentList.Add("Bypass");
        psiInner.ArgumentList.Add("-File");
        psiInner.ArgumentList.Add(Path.Combine(_agentQueueDir, "agent-queue.ps1"));
        psiInner.ArgumentList.Add("-PromptFile");
        psiInner.ArgumentList.Add(promptPath);
        psiInner.ArgumentList.Add("-Workspace");
        psiInner.ArgumentList.Add(TxtWorkspace.Text.Trim());

        psiInner.ArgumentList.Add("-AgentExe");
        psiInner.ArgumentList.Add(FixedCursorAgentExe);

        var model = (CmbModel.SelectedItem as string)?.Trim() ?? "";
        if (model.Length > 0)
        {
            psiInner.ArgumentList.Add("-Model");
            psiInner.ArgumentList.Add(model);
        }

        var mode = (CmbMode.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "agent";
        if (mode != "agent")
        {
            psiInner.ArgumentList.Add("-Mode");
            psiInner.ArgumentList.Add(mode);
        }

        if (int.TryParse(TxtCycles.Text.Trim(), out var cycles) && cycles > 0)
        {
            psiInner.ArgumentList.Add("-Cycles");
            psiInner.ArgumentList.Add(cycles.ToString());
        }

        psiInner.ArgumentList.Add("-NoStreamColor");

        psiInner.ArgumentList.Add("-StreamBufferChars");
        psiInner.ArgumentList.Add("512");

        psiInner.ArgumentList.Add("-AssistantStreamDelta");

        if (int.TryParse(TxtStartFromPrompt.Text.Trim(), out var sfp) && sfp >= 1)
        {
            psiInner.ArgumentList.Add("-StartFromPrompt");
            psiInner.ArgumentList.Add(sfp.ToString());
        }

        if (int.TryParse(TxtCyclesPerChat.Text.Trim(), out var cpc) && cpc >= 0)
        {
            psiInner.ArgumentList.Add("-CyclesPerChat");
            psiInner.ArgumentList.Add(cpc.ToString());
        }

        if (ChkStartNewChat.IsChecked != true)
        {
            psiInner.ArgumentList.Add("-ContinueFirstPrompt");
        }

        psiInner.ArgumentList.Add("-StallRestartSeconds");
        psiInner.ArgumentList.Add(stallRestartSecondsForArgs.ToString());

        psiInner.ArgumentList.Add("-StallAllowManualRetry");

        psi = psiInner;
        return true;
    }

    private void StartAgentQueueFromPsi(ProcessStartInfo psi)
    {
        _processStartUtc = DateTime.UtcNow;
        _lastStatusActivityUtc = _processStartUtc;
        _stallTimer.Start();
        try
        {
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.Exited += (_, _) => Dispatcher.BeginInvoke(OnProcessExited);
            p.Start();
            AppendStallDebugLogLine("pwsh agent-queue started pid=" + p.Id + " fileName=" + psi.FileName);
            _process = p;
            SetRunningUi(true);
        }
        catch
        {
            _stallTimer.Stop();
            _process = null;
            throw;
        }
    }

    private void BtnStart_OnClick(object sender, RoutedEventArgs e)
    {
        if (_process != null)
        {
            return;
        }

        if (!TryBuildAgentQueueProcessStartInfo(
                clearMonitorStatusFiles: true,
                out var psi,
                out var err))
        {
            if (!string.IsNullOrEmpty(err))
            {
                MessageBox.Show(this, err, "Agent Queue Monitor", MessageBoxButton.OK, MessageBoxImage.Warning);
            }

            return;
        }

        ResetStallDebugLogForNewAgentRun();
        _lastLoggedMonitorPhase = null;
        _lastLoggedPromptBlockIndex = null;
        TxtPhase.Text = "Запуск…";
        TxtCycle.Text = "—";
        TxtCurrentStep.Text = "—";
        TxtNextStep.Text = "—";
        try
        {
            var promptName = (PromptFilesList.SelectedItem as string) ?? "?";
            LogAgentQueueLaunch(promptName);
            StartAgentQueueFromPsi(psi!);
        }
        catch (Exception ex)
        {
            _stallTimer.Stop();
            MessageBox.Show(this, ex.Message, "Запуск", MessageBoxButton.OK, MessageBoxImage.Error);
            SetRunningUi(false);
        }
    }

    private void AppendStallDebugLogLine(string message)
    {
        try
        {
            var line = DateTime.UtcNow.ToString("O") + " [mon] " + message + Environment.NewLine;
            lock (_stallDebugLogLock)
            {
                File.AppendAllText(_stallDebugLogPath, line, Encoding.UTF8);
            }
        }
        catch
        {
        }
    }

    private void ResetStallDebugLogForNewAgentRun()
    {
        try
        {
            lock (_stallDebugLogLock)
            {
                var dir = Path.GetDirectoryName(_stallDebugLogPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                File.WriteAllText(_stallDebugLogPath, string.Empty, new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }

    private void LogAgentQueueLaunch(string promptFileName)
    {
        var ws = TxtWorkspace.Text.Trim();
        AppendLog("Запуск очереди agent-queue.ps1 (отдельное окно консоли для вывода агента).");
        AppendLog("Промпт: «" + promptFileName + "» · Workspace: " + ws);
        var model = (CmbModel.SelectedItem as string)?.Trim() ?? "";
        var mode = (CmbMode.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "agent";
        AppendLog("AgentExe: " + FixedCursorAgentExe + " · Model: " + model + " · Mode: " + mode + " · OutputFormat: stream-json (по умолчанию) · порядок шагов: авто (без -PipelineOrder/-Sequential)");
        AppendLog("Trust и Force: включены (без -NoTrust/-NoForce) · стрим дельт ответа: -AssistantStreamDelta + AGENT_QUEUE_ASSISTANT_STREAM_DELTA=1 · размышления не скрываются (AGENT_QUEUE_HIDE_THINKING=0)");
        AppendLog("Cycles: " + TxtCycles.Text.Trim() + " · CyclesPerChat: " + TxtCyclesPerChat.Text.Trim() + " · StartFromPrompt: " + TxtStartFromPrompt.Text.Trim() + " · Первый промпт: " + (ChkStartNewChat.IsChecked == true ? "новый чат" : "--ContinueFirstPrompt"));
        AppendLog("Таймер автоперезапуска, с: " + TxtStallRestartSeconds.Text.Trim() + " · -StreamBufferIdleMs не передаётся (0 по умолчанию в скрипте)");
        AppendLog("MonitorStatus: " + _monitorStatusPath);
        if (!int.TryParse(TxtStallRestartSeconds?.Text?.Trim() ?? "", out var stallLaunch) || stallLaunch <= 0)
        {
            AppendLog("Внимание: таймер автоперезапуска = 0 — по таймеру шаг не перезапускается. Задайте секунды (> 0): столько времени без обновления monitor-status.json до флага перезапуска. Ручная кнопка работает.");
            AppendStallDebugLogLine("launch warn: StallRestartSeconds=0 — auto stall off");
        }
    }

    private void SetRunningUi(bool running)
    {
        BtnStart.IsEnabled = !running;
        BtnStop.IsEnabled = running;
        BtnAfterCycle.IsEnabled = running;
        BtnManualStallRetry.IsEnabled = running;
    }

    private void BtnManualStallRetry_OnClick(object sender, RoutedEventArgs e)
    {
        WriteManualStallRetryFlag(allowOverwrite: true, refreshActivityClock: true);
    }

    private void WriteManualStallRetryFlag(bool allowOverwrite, bool refreshActivityClock)
    {
        if (string.IsNullOrEmpty(_agentQueueDir))
        {
            AppendStallDebugLogLine("WriteManualStallRetryFlag ABORT: agentQueueDir empty");
            return;
        }

        var flag = Path.Combine(_agentQueueDir, "agent-queue.manual-stall-retry.flag");
        try
        {
            if (!allowOverwrite && File.Exists(flag))
            {
                if ((DateTime.UtcNow - _lastSkipStallFlagDebugUtc).TotalSeconds >= 4)
                {
                    _lastSkipStallFlagDebugUtc = DateTime.UtcNow;
                    AppendStallDebugLogLine("WriteManualStallRetryFlag SKIP (flag exists, allowOverwrite=false) path=" + flag);
                }

                return;
            }

            File.WriteAllText(flag, DateTime.UtcNow.ToString("o") + Environment.NewLine);
            if (refreshActivityClock)
            {
                _lastStatusActivityUtc = DateTime.UtcNow;
            }

            AppendLog("Перезапуск текущего шага: создан файл-флаг " + Path.GetFileName(flag) + ".");
            AppendStallDebugLogLine("WriteManualStallRetryFlag OK allowOverwrite=" + allowOverwrite + " refreshActivityClock=" + refreshActivityClock + " path=" + flag);
        }
        catch (Exception ex)
        {
            AppendLog("Ошибка записи флага перезапуска шага: " + ex.Message);
            AppendStallDebugLogLine("WriteManualStallRetryFlag ERROR: " + ex);
        }
    }

    private void TryAutoStallRetryFromMonitorIdle(TimeSpan idle)
    {
        if (_process == null || _process.HasExited)
        {
            return;
        }

        if (!int.TryParse(TxtStallRestartSeconds?.Text?.Trim() ?? "", out var stallSec) || stallSec <= 0)
        {
            return;
        }

        var threshold = stallSec;
        if (idle.TotalSeconds <= threshold)
        {
            return;
        }

        AppendStallDebugLogLine("TryAutoStall: idleSec=" + idle.TotalSeconds.ToString("F1") + " > timerSec=" + threshold + " calling WriteManualStallRetryFlag");
        WriteManualStallRetryFlag(allowOverwrite: false, refreshActivityClock: false);
    }

    private static bool IsWindowsAppsExecutionAliasShim(string? fullPath)
    {
        if (string.IsNullOrEmpty(fullPath))
        {
            return false;
        }

        return fullPath.Contains($"{Path.DirectorySeparatorChar}WindowsApps{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
               || fullPath.Contains("\\WindowsApps\\", StringComparison.OrdinalIgnoreCase);
    }

    private static string? FindOnPathSkipWindowsAppsShim(string fileName)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv))
        {
            return null;
        }

        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            var full = Path.Combine(dir.Trim(), fileName);
            if (File.Exists(full) && !IsWindowsAppsExecutionAliasShim(full))
            {
                return full;
            }
        }

        return null;
    }

    private static string FindPwshExecutable()
    {
        var found = TryFindPwshExecutable();
        if (found != null)
        {
            return found;
        }

        throw new FileNotFoundException(
            "Не найден настоящий pwsh.exe или powershell.exe (заглушка Microsoft Store в WindowsApps не используется). Установите PowerShell 7 или используйте Windows PowerShell.");
    }

    private static string? TryFindPwshExecutable()
    {
        var p = FindOnPathSkipWindowsAppsShim("pwsh.exe");
        if (p != null)
        {
            return p;
        }

        var ps7 = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "PowerShell", "7", "pwsh.exe");
        if (File.Exists(ps7))
        {
            return ps7;
        }

        p = FindOnPathSkipWindowsAppsShim("powershell.exe");
        if (p != null)
        {
            return p;
        }

        var sysPs = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        return File.Exists(sysPs) ? sysPs : null;
    }

    private static string? FindOnPath(string fileName)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv))
        {
            return null;
        }

        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            var full = Path.Combine(dir.Trim(), fileName);
            if (File.Exists(full))
            {
                return full;
            }
        }

        return null;
    }

    private static List<string> FetchModelsFromCli(string agentExeName)
    {
        var path = ResolveAgentExecutable(agentExeName);
        path = PreferCursorAgentPs1(path);
        if (path == null)
        {
            return GetFallbackModels();
        }

        if (TryRunAgentArg(path, "models", out var stdout, out var exit) && exit == 0)
        {
            var parsed = AgentModelListParser.ParseModelsOutput(stdout);
            if (parsed.Count > 0)
            {
                return parsed;
            }
        }

        if (TryRunAgentArg(path, "--list-models", out stdout, out exit) && exit == 0)
        {
            var parsed = AgentModelListParser.ParseModelsOutput(stdout);
            if (parsed.Count > 0)
            {
                return parsed;
            }
        }

        return GetFallbackModels();
    }

    private static List<string> GetFallbackModels()
    {
        return new List<string> { "composer-2" };
    }

    private static string? ResolveAgentExecutable(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        name = name.Trim();
        if (name.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
        {
            return null;
        }

        if (name.Contains(Path.DirectorySeparatorChar) || name.Contains('/'))
        {
            if (File.Exists(name))
            {
                return Path.GetFullPath(name);
            }

            return null;
        }

        foreach (var ext in new[] { "", ".exe", ".cmd", ".bat", ".ps1" })
        {
            var found = FindOnPath(name + ext);
            if (found != null)
            {
                return found;
            }
        }

        if (string.Equals(name, "agent", StringComparison.OrdinalIgnoreCase))
        {
            var la = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (!string.IsNullOrEmpty(la))
            {
                var fb = Path.Combine(la, "cursor-agent", "agent.cmd");
                if (File.Exists(fb))
                {
                    return fb;
                }
            }
        }

        return null;
    }

    private static string? PreferCursorAgentPs1(string? path)
    {
        if (path == null)
        {
            return null;
        }

        if (path.EndsWith("agent.cmd", StringComparison.OrdinalIgnoreCase))
        {
            var dir = Path.GetDirectoryName(path);
            if (dir != null)
            {
                var ps1 = Path.Combine(dir, "cursor-agent.ps1");
                if (File.Exists(ps1))
                {
                    return ps1;
                }
            }
        }

        return path;
    }

    private static bool TryRunAgentArg(string agentPath, string arg1, out string stdout, out int exitCode)
    {
        stdout = "";
        exitCode = -1;
        try
        {
            var psi = new ProcessStartInfo
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            };

            if (agentPath.EndsWith(".ps1", StringComparison.OrdinalIgnoreCase))
            {
                var pwsh = TryFindPwshExecutable();
                if (pwsh == null)
                {
                    return false;
                }

                psi.FileName = pwsh;
                psi.ArgumentList.Add("-NoProfile");
                psi.ArgumentList.Add("-ExecutionPolicy");
                psi.ArgumentList.Add("Bypass");
                psi.ArgumentList.Add("-File");
                psi.ArgumentList.Add(agentPath);
                psi.ArgumentList.Add(arg1);
            }
            else if (agentPath.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || agentPath.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
            {
                psi.FileName = "cmd.exe";
                psi.ArgumentList.Add("/c");
                psi.ArgumentList.Add($"\"{agentPath}\" {arg1}");
            }
            else
            {
                psi.FileName = agentPath;
                psi.ArgumentList.Add(arg1);
            }

            using var p = Process.Start(psi);
            if (p == null)
            {
                return false;
            }

            if (!p.WaitForExit(120_000))
            {
                try
                {
                    p.Kill();
                }
                catch
                {
                }

                return false;
            }

            stdout = p.StandardOutput.ReadToEnd();
            exitCode = p.ExitCode;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private const int MonitorPreviewMaxWords = 10;

    private static string FormatMonitorPreviewWords(string? text, int maxWords)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "";
        }

        var parts = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return "";
        }

        var n = Math.Min(maxWords, parts.Length);
        return string.Join(" ", parts, 0, n);
    }

    private void RefreshMonitorStatusFromFile()
    {
        if (string.IsNullOrEmpty(_monitorStatusPath) || !File.Exists(_monitorStatusPath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(_monitorStatusPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string? phaseStr = null;
            if (root.TryGetProperty("phase", out var ph))
            {
                var p = ph.GetString();
                phaseStr = p;
                TxtPhase.Text = p switch
                {
                    "done" => "Готово",
                    "starting_agent" => "Между шагами / вывод в консоли",
                    "restarting_same_step" => "Перезапуск текущего шага…",
                    _ => string.IsNullOrEmpty(p) ? "—" : p
                };
            }

            if (!string.Equals(phaseStr, _lastLoggedMonitorPhase, StringComparison.Ordinal))
            {
                _lastLoggedMonitorPhase = phaseStr;
                if (!string.IsNullOrEmpty(phaseStr))
                {
                    var ru = phaseStr switch
                    {
                        "done" => "Статус agent-queue: шаг завершён (phase=done)",
                        "starting_agent" => "Статус agent-queue: между шагами, запуск агента (phase=starting_agent)",
                        "restarting_same_step" => "Статус agent-queue: перезапуск текущего шага (phase=restarting_same_step)",
                        _ => "Статус agent-queue: phase=" + phaseStr
                    };
                    AppendLog(ru);
                }
            }

            if (string.Equals(phaseStr, "done", StringComparison.Ordinal))
            {
                TxtCycle.Text = "—";
            }
            else if (root.TryGetProperty("cycle", out var cyEl) && cyEl.ValueKind == JsonValueKind.Number &&
                     cyEl.TryGetInt32(out var cy) &&
                     root.TryGetProperty("cyclesTotal", out var ctEl) && ctEl.ValueKind == JsonValueKind.Number &&
                     ctEl.TryGetInt32(out var ct) && ct > 0)
            {
                TxtCycle.Text = $"{cy} / {ct}";
            }
            else if (root.TryGetProperty("round", out var rdEl) && rdEl.ValueKind == JsonValueKind.Number &&
                     rdEl.TryGetInt32(out var rd))
            {
                if (root.TryGetProperty("roundsTotal", out var rttEl) && rttEl.ValueKind == JsonValueKind.Number &&
                    rttEl.TryGetInt32(out var rtt) && rtt > 0)
                {
                    TxtCycle.Text = $"{rd} / {rtt}";
                }
                else
                {
                    TxtCycle.Text = $"{rd}";
                }
            }
            else
            {
                TxtCycle.Text = "—";
            }

            string? summaryLine = null;
            if (root.TryGetProperty("summaryLine", out var sumEl) && sumEl.ValueKind == JsonValueKind.String)
            {
                summaryLine = sumEl.GetString();
            }

            int? promptBlockIndex = null;
            if (root.TryGetProperty("promptBlockIndex", out var pbi) && pbi.ValueKind == JsonValueKind.Number && pbi.TryGetInt32(out var pbn))
            {
                promptBlockIndex = pbn;
            }

            string? superpower = null;
            if (root.TryGetProperty("superpower", out var spEl) && spEl.ValueKind == JsonValueKind.String)
            {
                var s = spEl.GetString();
                if (!string.IsNullOrWhiteSpace(s))
                {
                    superpower = s.Trim();
                }
            }

            string? currentPreview = null;
            if (root.TryGetProperty("currentPreview", out var cpe) && cpe.ValueKind == JsonValueKind.String)
            {
                currentPreview = cpe.GetString();
            }

            var sourceForCurrentWords = !string.IsNullOrEmpty(currentPreview) ? currentPreview : summaryLine;
            var currentWords = FormatMonitorPreviewWords(sourceForCurrentWords, MonitorPreviewMaxWords);
            var spPrefix = string.IsNullOrEmpty(superpower) ? "" : "[" + superpower + "] ";
            if (promptBlockIndex.HasValue)
            {
                TxtCurrentStep.Text = string.IsNullOrEmpty(currentWords)
                    ? spPrefix + $"#{promptBlockIndex.Value}"
                    : spPrefix + $"#{promptBlockIndex.Value} {currentWords}";
                var tip = !string.IsNullOrEmpty(currentPreview) ? currentPreview : summaryLine;
                if (!string.IsNullOrEmpty(superpower))
                {
                    var spNote = "superpower: " + superpower;
                    tip = string.IsNullOrEmpty(tip) ? spNote : spNote + "\n" + tip;
                }

                TxtCurrentStep.ToolTip = string.IsNullOrEmpty(tip) ? null : tip;
            }
            else if (!string.IsNullOrEmpty(currentWords))
            {
                TxtCurrentStep.Text = spPrefix + currentWords;
                var tipSeq = summaryLine;
                if (!string.IsNullOrEmpty(superpower))
                {
                    var spNote = "superpower: " + superpower;
                    tipSeq = string.IsNullOrEmpty(tipSeq) ? spNote : spNote + "\n" + tipSeq;
                }

                TxtCurrentStep.ToolTip = tipSeq;
            }
            else
            {
                TxtCurrentStep.Text = "—";
                TxtCurrentStep.ToolTip = null;
            }

            if (promptBlockIndex.HasValue && promptBlockIndex != _lastLoggedPromptBlockIndex)
            {
                _lastLoggedPromptBlockIndex = promptBlockIndex;
                var stepDesc = string.IsNullOrEmpty(currentWords) ? "" : " · " + currentWords;
                var spLog = string.IsNullOrEmpty(superpower) ? "" : " · superpower: " + superpower;
                AppendLog("Активный промпт-блок: #" + promptBlockIndex.Value + stepDesc + spLog);
            }

            if (root.TryGetProperty("nextPromptBlockIndex", out var ni))
            {
                if (ni.ValueKind == JsonValueKind.Null)
                {
                    TxtNextStep.Text = "—";
                    TxtNextStep.ToolTip = null;
                }
                else if (ni.TryGetInt32(out var nx))
                {
                    var pv = "";
                    if (root.TryGetProperty("nextPreview", out var np) && np.ValueKind == JsonValueKind.String)
                    {
                        pv = np.GetString() ?? "";
                    }

                    var nw = FormatMonitorPreviewWords(pv, MonitorPreviewMaxWords);
                    TxtNextStep.Text = string.IsNullOrEmpty(nw) ? $"#{nx}" : $"#{nx} {nw}";
                    TxtNextStep.ToolTip = string.IsNullOrEmpty(pv) ? null : pv;
                }
            }
            else
            {
                TxtNextStep.Text = "—";
                TxtNextStep.ToolTip = null;
            }

            var fileUtc = File.GetLastWriteTimeUtc(_monitorStatusPath);
            if (fileUtc > _lastStatusActivityUtc)
            {
                _lastStatusActivityUtc = fileUtc;
            }
        }
        catch (Exception ex)
        {
            AppendStallDebugLogLine("RefreshMonitorStatusFromFile exception: " + ex.Message);
        }
    }

    private void UpdateStallDisplay()
    {
        RefreshMonitorStatusFromFile();

        if (_process == null)
        {
            return;
        }

        var refUtc = _lastStatusActivityUtc;
        if (refUtc == default)
        {
            refUtc = _processStartUtc;
        }

        if (_process.HasExited)
        {
            return;
        }

        var idle = DateTime.UtcNow - refUtc;
        if (int.TryParse(TxtStallRestartSeconds?.Text?.Trim() ?? "", out var stallCfg) && stallCfg > 0)
        {
            if ((DateTime.UtcNow - _lastStallHeartbeatDebugUtc).TotalSeconds >= 2)
            {
                _lastStallHeartbeatDebugUtc = DateTime.UtcNow;
                var thr = stallCfg;
                var flagPath = Path.Combine(_agentQueueDir, "agent-queue.manual-stall-retry.flag");
                AppendStallDebugLogLine("HB idleSec=" + idle.TotalSeconds.ToString("F1") + " timerSec=" + thr + " refUtc=" + refUtc.ToString("O") + " jsonExists=" + File.Exists(_monitorStatusPath) + " flagExists=" + File.Exists(flagPath));
            }
        }

        TryAutoStallRetryFromMonitorIdle(idle);
        var sec = (int)idle.TotalSeconds;
        var mm = sec / 60;
        var ss = sec % 60;
        TxtStall.Text = $"{mm}:{ss:D2}";
    }

    private void AppendLog(string line)
    {
        var ts = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        var prefixed = "[" + ts + "] " + line;
        AppendStallDebugLogLine("[ui] " + line);
        if (TxtLog.Text.Length > 120_000)
        {
            TxtLog.Text = TxtLog.Text[^80_000..];
        }

        TxtLog.AppendText(prefixed + Environment.NewLine);
        TxtLog.ScrollToEnd();
    }

    private void OnProcessExited()
    {
        _stallTimer.Stop();
        RefreshMonitorStatusFromFile();
        var code = -1;
        try
        {
            if (_process != null)
            {
                _process.WaitForExit(60_000);
                code = _process.ExitCode;
            }
        }
        catch
        {
            code = _process?.ExitCode ?? -1;
        }

        _process?.Dispose();
        _process = null;

        SetRunningUi(false);
        TxtPhase.Text = "Завершено, код " + code;
        AppendLog("Процесс agent-queue (pwsh) завершён, код выхода: " + code);
        AppendStallDebugLogLine("pwsh agent-queue exited code=" + code);
    }

    private void BtnStop_OnClick(object sender, RoutedEventArgs e)
    {
        if (_process == null)
        {
            return;
        }

        AppendLog("Кнопка «Стоп»: принудительное завершение дерева процессов (pwsh / agent).");
        AppendStallDebugLogLine("BtnStop Kill entireProcessTree pid=" + _process.Id);

        try
        {
            _process.Kill(entireProcessTree: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Стоп", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void BtnAfterCycle_OnClick(object sender, RoutedEventArgs e)
    {
        try
        {
            File.WriteAllText(FinishFlagPath, DateTime.UtcNow.ToString("o"));
            TxtPhase.Text = "Запрошено завершение после текущего цикла (файл-флаг создан)";
            AppendLog("Завершить после текущего цикла: записан файл-флаг " + FinishFlagPath);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Выйти после цикла", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        _stallTimer.Stop();
        if (_process != null)
        {
            try
            {
                _process.Kill(entireProcessTree: true);
            }
            catch
            {
            }

            _process.Dispose();
        }

        TxtLog.Text = "";
        base.OnClosed(e);
    }
}
