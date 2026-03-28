// Copyright Aura. All Rights Reserved.

using Xunit;

namespace AgentQueueMonitor.Tests;

public class AgentQueuePathFinderTests
{
    [Fact]
    public void FindDirectoryContainingAgentQueueScript_SameDirectory_ReturnsThatDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, AgentQueuePathFinder.AgentQueueScriptName), "# stub");
            var found = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(root);
            Assert.Equal(Path.GetFullPath(root), found);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_ParentDirectory_ReturnsParent()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        var child = Path.Combine(root, "bin", "out");
        Directory.CreateDirectory(child);
        try
        {
            File.WriteAllText(Path.Combine(root, AgentQueuePathFinder.AgentQueueScriptName), "# stub");
            var found = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(child);
            Assert.Equal(Path.GetFullPath(root), found);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_NearestAncestorWithScriptWins()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        var mid = Path.Combine(root, "scripts", "agent-queue");
        var leaf = Path.Combine(mid, "monitor", "deep");
        Directory.CreateDirectory(leaf);
        try
        {
            File.WriteAllText(Path.Combine(root, AgentQueuePathFinder.AgentQueueScriptName), "# root stub");
            File.WriteAllText(Path.Combine(mid, AgentQueuePathFinder.AgentQueueScriptName), "# mid stub");
            var found = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(leaf);
            Assert.Equal(Path.GetFullPath(mid), found);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_Missing_ThrowsFileNotFound()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        try
        {
            var ex = Assert.Throws<FileNotFoundException>(() =>
                AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(root));
            Assert.Equal(AgentQueuePathFinder.AgentQueueScriptName, ex.Message);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_FifteenNestedLevels_FindsRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, AgentQueuePathFinder.AgentQueueScriptName), "# stub");
        var dir = root;
        for (var d = 1; d <= 15; d++)
        {
            dir = Path.Combine(dir, "d" + d.ToString());
            Directory.CreateDirectory(dir);
        }

        try
        {
            var found = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(dir);
            Assert.Equal(Path.GetFullPath(root), found);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_SixteenNestedLevels_ThrowsWhenScriptOnlyAtRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, AgentQueuePathFinder.AgentQueueScriptName), "# stub");
        var dir = root;
        for (var d = 1; d <= 16; d++)
        {
            dir = Path.Combine(dir, "d" + d.ToString());
            Directory.CreateDirectory(dir);
        }

        try
        {
            var ex = Assert.Throws<FileNotFoundException>(() =>
                AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(dir));
            Assert.Equal(AgentQueuePathFinder.AgentQueueScriptName, ex.Message);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void GetDefaultCursorWorkspace_GraphCasterLayout_ParentWithPythonAndUi()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqws-" + Guid.NewGuid().ToString("n"));
        var aq = Path.Combine(root, "agent-queue");
        Directory.CreateDirectory(Path.Combine(root, "python"));
        Directory.CreateDirectory(Path.Combine(root, "ui"));
        Directory.CreateDirectory(aq);
        try
        {
            var ws = AgentQueuePathFinder.GetDefaultCursorWorkspace(aq);
            Assert.Equal(Path.GetFullPath(root), ws);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void GetDefaultCursorWorkspace_ScriptsAgentQueueLayout_TwoLevelsUp()
    {
        var repo = Path.Combine(Path.GetTempPath(), "aqws-" + Guid.NewGuid().ToString("n"));
        var aq = Path.Combine(repo, "scripts", "agent-queue");
        Directory.CreateDirectory(aq);
        try
        {
            var ws = AgentQueuePathFinder.GetDefaultCursorWorkspace(aq);
            Assert.Equal(Path.GetFullPath(repo), ws);
        }
        finally
        {
            TryDeleteDirectory(repo);
        }
    }

    [Fact]
    public void GetDefaultCursorWorkspace_OtherParentName_UsesParentOfAgentQueue()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqws-" + Guid.NewGuid().ToString("n"));
        var aq = Path.Combine(root, "tools", "agent-queue");
        Directory.CreateDirectory(aq);
        try
        {
            var expected = Path.GetFullPath(Path.Combine(root, "tools"));
            var ws = AgentQueuePathFinder.GetDefaultCursorWorkspace(aq);
            Assert.Equal(expected, ws);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    [Fact]
    public void FindDirectoryContainingAgentQueueScript_PublishLikePathUnderMonitor_FindsAgentQueueDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), "aqpf-" + Guid.NewGuid().ToString("n"));
        var agentQueueDir = Path.Combine(root, "scripts", "agent-queue");
        var leaf = Path.Combine(agentQueueDir, "monitor", "bin", "Release", "net8.0-windows");
        Directory.CreateDirectory(leaf);
        try
        {
            File.WriteAllText(Path.Combine(agentQueueDir, AgentQueuePathFinder.AgentQueueScriptName), "# stub");
            var found = AgentQueuePathFinder.FindDirectoryContainingAgentQueueScript(leaf);
            Assert.Equal(Path.GetFullPath(agentQueueDir), found);
        }
        finally
        {
            TryDeleteDirectory(root);
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch
        {
        }
    }
}
