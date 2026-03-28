// Copyright Aura. All Rights Reserved.

using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentQueueMonitor;

public static class AgentModelListParser
{
    private static readonly Regex ModelIdRegex = new(@"^[a-zA-Z0-9][a-zA-Z0-9._\-]*$", RegexOptions.Compiled);
    private static readonly Regex AnsiEscapeRegex = new(@"\x1b\[[0-9;]*m", RegexOptions.Compiled);

    public static List<string> ParseModelsOutput(string stdout)
    {
        var lines = new List<string>();
        var t = stdout.Trim();
        if (t.Length == 0)
        {
            return lines;
        }

        if (t[0] == '[')
        {
            try
            {
                var arr = JsonSerializer.Deserialize<string[]>(t);
                if (arr != null)
                {
                    foreach (var s in arr)
                    {
                        if (string.IsNullOrEmpty(s))
                        {
                            continue;
                        }

                        var x = s.Trim();
                        if (IsModelId(x))
                        {
                            lines.Add(x);
                        }
                    }
                }

                if (lines.Count > 0)
                {
                    return DeduplicateModels(lines);
                }
            }
            catch
            {
            }
        }

        foreach (var rawLine in stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var line = StripAnsi(rawLine.Trim());
            if (line.Length == 0)
            {
                continue;
            }

            if (line.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            if (line.Contains('|', StringComparison.Ordinal))
            {
                foreach (var cell in line.Split('|'))
                {
                    var c = cell.Trim();
                    if (IsModelId(c))
                    {
                        lines.Add(c);
                    }
                }

                continue;
            }

            var tokens = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length == 0)
            {
                continue;
            }

            var head = tokens[0].TrimStart('*', '-', '•', '·').Trim();
            if (IsModelId(head))
            {
                lines.Add(head);
            }
            else if (head.Length == 0)
            {
                for (var i = 1; i < tokens.Length; i++)
                {
                    var candidate = tokens[i].TrimStart('*', '-', '•', '·').Trim();
                    if (candidate.Length == 0)
                    {
                        continue;
                    }

                    if (IsModelId(candidate))
                    {
                        lines.Add(candidate);
                        break;
                    }
                }
            }
        }

        return DeduplicateModels(lines);
    }

    public static bool IsModelId(string s)
    {
        if (s.Length == 0 || s.Length > 80)
        {
            return false;
        }

        return ModelIdRegex.IsMatch(s);
    }

    public static string StripAnsi(string s)
    {
        return AnsiEscapeRegex.Replace(s, "");
    }

    public static List<string> DeduplicateModels(List<string> lines)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<string>();
        foreach (var x in lines)
        {
            if (seen.Add(x))
            {
                result.Add(x);
            }
        }

        return result;
    }
}
