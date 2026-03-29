// Copyright GraphCaster. All Rights Reserved.

using System;
using System.IO;

namespace AgentQueueMonitor;

public static class AgentQueuePathFinder
{
    public const string AgentQueueScriptName = "agent-queue.ps1";

    public static string FindDirectoryContainingAgentQueueScript(string startDirectory)
    {
        var dir = Path.GetFullPath(startDirectory);
        for (var i = 0; i < 16; i++)
        {
            var candidate = Path.Combine(dir, AgentQueueScriptName);
            if (File.Exists(candidate))
            {
                return dir;
            }

            var parent = Directory.GetParent(dir);
            if (parent == null)
            {
                break;
            }

            dir = parent.FullName;
        }

        throw new FileNotFoundException(AgentQueueScriptName);
    }

    /// <summary>
    /// Folder passed to agent-queue.ps1 -Workspace / Cursor --workspace.
    /// graph-caster: parent of agent-queue/ when that parent contains python/ and ui/.
    /// Legacy scripts/agent-queue/: repo root (two levels up from agent-queue/).
    /// Otherwise: parent of agent-queue/.
    /// </summary>
    public static string GetDefaultCursorWorkspace(string agentQueueDirectory)
    {
        var agentQueueDir = Path.GetFullPath(agentQueueDirectory);
        var parent = Path.GetFullPath(Path.Combine(agentQueueDir, ".."));
        var py = Path.Combine(parent, "python");
        var ui = Path.Combine(parent, "ui");
        if (Directory.Exists(py) && Directory.Exists(ui))
        {
            return parent;
        }

        var parentName = Path.GetFileName(parent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.Equals(parentName, "scripts", StringComparison.OrdinalIgnoreCase))
        {
            return Path.GetFullPath(Path.Combine(agentQueueDir, "..", ".."));
        }

        return parent;
    }
}
