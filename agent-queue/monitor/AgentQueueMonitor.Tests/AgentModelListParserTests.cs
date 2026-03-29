// Copyright GraphCaster. All Rights Reserved.

using Xunit;

namespace AgentQueueMonitor.Tests;

public class AgentModelListParserTests
{
    [Fact]
    public void ParseModelsOutput_Empty_YieldsEmpty()
    {
        Assert.Empty(AgentModelListParser.ParseModelsOutput(""));
        Assert.Empty(AgentModelListParser.ParseModelsOutput("   \r\n  "));
    }

    [Fact]
    public void ParseModelsOutput_JsonArray_PreservesOrderAndFiltersInvalid()
    {
        var r = AgentModelListParser.ParseModelsOutput(@"[""composer-2"", """", ""bad id"", ""gpt-4.1""]");
        Assert.Equal(new[] { "composer-2", "gpt-4.1" }, r);
    }

    [Fact]
    public void ParseModelsOutput_LineMode_StripsAnsiAndSkipsComments()
    {
        var raw = "\x1b[32mcomposer-2\x1b[0m\r\n# skip\n";
        var r = AgentModelListParser.ParseModelsOutput(raw);
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_PipeRowSplitsCells()
    {
        var r = AgentModelListParser.ParseModelsOutput("| composer-2 | gpt-4");
        Assert.Equal(new[] { "composer-2", "gpt-4" }, r);
    }

    [Fact]
    public void ParseModelsOutput_PipeRow_EmptyCellsSkipped()
    {
        var r = AgentModelListParser.ParseModelsOutput("|  | composer-2 |   |");
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_JsonArray_SurroundingWhitespace_Ok()
    {
        var r = AgentModelListParser.ParseModelsOutput(" \r\n  [\"composer-2\"]  \r\n ");
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_MarkdownBulletGluedToId()
    {
        var r = AgentModelListParser.ParseModelsOutput("*composer-2 extra ignored");
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_LineMode_BulletWithSpaceBeforeId()
    {
        Assert.Equal(new[] { "composer-2" }, AgentModelListParser.ParseModelsOutput("- composer-2"));
        Assert.Equal(new[] { "gpt-4" }, AgentModelListParser.ParseModelsOutput("• gpt-4"));
    }

    [Fact]
    public void ParseModelsOutput_LineMode_TwoIdsOnOneLine_UsesFirstTokenOnly()
    {
        var r = AgentModelListParser.ParseModelsOutput("composer-2 gpt-4");
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_LineMode_TabBetweenTwoIds_UsesFirstTokenOnly()
    {
        var r = AgentModelListParser.ParseModelsOutput("composer-2\tgpt-4");
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void DeduplicateModels_IsCaseInsensitiveFirstWins()
    {
        var r = AgentModelListParser.DeduplicateModels(new List<string> { "Composer-2", "composer-2", "gpt-4" });
        Assert.Equal(new[] { "Composer-2", "gpt-4" }, r);
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("bad id", false)]
    [InlineData(".bad", false)]
    [InlineData("a", true)]
    [InlineData("composer-2", true)]
    [InlineData("gpt-4.1-mini", true)]
    public void IsModelId_Expected(string s, bool ok)
    {
        Assert.Equal(ok, AgentModelListParser.IsModelId(s));
    }

    [Fact]
    public void IsModelId_Length81_IsFalse()
    {
        var s = new string('a', 81);
        Assert.False(AgentModelListParser.IsModelId(s));
        Assert.True(AgentModelListParser.IsModelId(new string('a', 80)));
    }

    [Fact]
    public void StripAnsi_RemovesColorAndResetSequences()
    {
        var raw = "\x1b[1m\x1b[32mgpt-4\x1b[0m";
        Assert.Equal("gpt-4", AgentModelListParser.StripAnsi(raw));
    }

    [Fact]
    public void ParseModelsOutput_JsonArray_AllInvalid_FallsBackToLineMode()
    {
        var stdout = "[\"bad id\", \"\"]\ncomposer-2\n";
        var r = AgentModelListParser.ParseModelsOutput(stdout);
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_InvalidJsonPrefix_FallsBackToLineMode()
    {
        var stdout = "[ not json\ncomposer-2\n";
        var r = AgentModelListParser.ParseModelsOutput(stdout);
        Assert.Single(r);
        Assert.Equal("composer-2", r[0]);
    }

    [Fact]
    public void ParseModelsOutput_EmptyJsonArray_YieldsEmpty()
    {
        Assert.Empty(AgentModelListParser.ParseModelsOutput("[]"));
    }
}
