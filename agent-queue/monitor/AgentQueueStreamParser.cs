// Copyright Aura. All Rights Reserved.

using System.Text.Json;

namespace AgentQueueMonitor;

internal static class AgentQueueStreamParser
{
    public static string? TryDescribeStatus(string line)
    {
        var t = line.Trim();
        if (t.Length == 0)
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(t);
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl))
            {
                return null;
            }

            var type = typeEl.GetString() ?? "";
            root.TryGetProperty("subtype", out var subEl);
            var sub = subEl.ValueKind == JsonValueKind.String ? subEl.GetString() : null;

            return type switch
            {
                "thinking" => sub == "delta" ? "Размышление…" : "Размышление",
                "reasoning" => sub == "delta" ? "Рассуждение…" : "Рассуждение",
                "tool_call" => DescribeToolCall(root, sub),
                "system" => "Система",
                "user" => "Пользователь / контекст",
                "result" => "Результат шага",
                "connection" => "Подключение: " + (sub ?? "?"),
                "retry" => "Повтор: " + (sub ?? "?"),
                "assistant" => sub == "delta" ? "Ответ (поток)" : "Ответ",
                _ => "Событие: " + type
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string DescribeToolCall(JsonElement root, string? sub)
    {
        if (!root.TryGetProperty("tool_call", out var tc))
        {
            return "Инструмент: " + (sub ?? "?");
        }

        foreach (var prop in tc.EnumerateObject())
        {
            var name = prop.Name;
            if (name == "readToolCall" && prop.Value.TryGetProperty("args", out var ra))
            {
                var path = ra.TryGetProperty("path", out var p) ? p.GetString() : "";
                return "Чтение: " + path;
            }

            if (name == "grepToolCall")
            {
                return "Grep";
            }

            if (name == "writeToolCall" && prop.Value.TryGetProperty("args", out var wa))
            {
                var path = wa.TryGetProperty("path", out var p) ? p.GetString() : "";
                return "Запись: " + path;
            }

            if (name == "editToolCall" && prop.Value.TryGetProperty("args", out var ea))
            {
                var path = ea.TryGetProperty("path", out var p) ? p.GetString() : "";
                return "Правка: " + path;
            }

            if (name == "deleteToolCall")
            {
                return "Удаление файла";
            }

            if (name == "shellToolCall" && prop.Value.TryGetProperty("args", out var sa))
            {
                var cmd = sa.TryGetProperty("command", out var c) ? c.GetString() : "";
                if (cmd != null && cmd.Length > 80)
                {
                    cmd = cmd[..77] + "...";
                }

                return "Shell: " + cmd;
            }
        }

        return sub == "started" ? "Инструмент (старт)" : sub == "completed" ? "Инструмент (готово)" : "Инструмент";
    }

    public static bool TryParseStepLine(string line, out int step, out int total)
    {
        step = 0;
        total = 0;
        if (!line.Contains("Step ", StringComparison.Ordinal))
        {
            return false;
        }

        try
        {
            var idx = line.IndexOf("Step ", StringComparison.Ordinal);
            if (idx < 0)
            {
                return false;
            }

            var rest = line[(idx + 5)..];
            var slash = rest.IndexOf('/');
            if (slash <= 0)
            {
                return false;
            }

            var a = rest[..slash].Trim();
            var b = rest[(slash + 1)..];
            var space = b.IndexOf(' ');
            if (space > 0)
            {
                b = b[..space];
            }

            b = b.Trim();
            if (int.TryParse(a, out step) && int.TryParse(b, out total))
            {
                return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }
}
