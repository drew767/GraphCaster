# Phase 3: Agent & RAG Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement in-runner agent loop with tool calling and RAG nodes for document retrieval and indexing — closing §20 (agent streaming), §33 (agent-calling-tools pattern), §36 (RAG retrieval).

**Architecture:** 
- **Agent loop** — Adopt Dify's pattern: iterative LLM calls with tool execution between rounds, bounded by max iterations. Stream partial responses via existing event transport.
- **RAG nodes** — Two-tier: `rag_index` for ingestion, `rag_query` for retrieval. Vector store abstraction with ChromaDB as default backend.

**Tech Stack:** Python 3.11+, OpenAI/Anthropic APIs, ChromaDB, sentence-transformers, existing event transport

---

## File Structure

```
python/graph_caster/
├── agent/
│   ├── __init__.py
│   ├── loop.py           # AgentLoop with streaming
│   ├── tool_executor.py  # Tool execution layer
│   ├── memory.py         # Conversation memory (optional)
│   └── providers/
│       ├── __init__.py
│       ├── base.py       # LLM provider interface
│       ├── openai.py     # OpenAI provider
│       └── anthropic.py  # Anthropic provider
├── rag/
│   ├── __init__.py
│   ├── retriever.py      # Retriever interface
│   ├── indexer.py        # Document indexer
│   └── stores/
│       ├── __init__.py
│       ├── base.py       # VectorStore interface
│       └── chroma.py     # ChromaDB implementation
└── nodes/
    ├── agent_node.py
    ├── rag_query_node.py
    └── rag_index_node.py
```

---

## Task 1: LLM Provider Interface

**Files:**
- Create: `python/graph_caster/agent/__init__.py`
- Create: `python/graph_caster/agent/providers/__init__.py`
- Create: `python/graph_caster/agent/providers/base.py`
- Test: `python/tests/test_agent_provider_base.py`

- [ ] **Step 1: Define provider interface**

```python
# base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal

@dataclass
class ToolDefinition:
    """Tool definition for LLM function calling."""
    name: str
    description: str
    parameters: dict  # JSON Schema
    
    def to_openai_format(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }
    
    def to_anthropic_format(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }

@dataclass
class ToolCall:
    """Parsed tool call from LLM response."""
    id: str
    name: str
    arguments: dict

@dataclass
class Message:
    """Chat message."""
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None
    name: str | None = None  # For tool results

@dataclass
class StreamChunk:
    """Streaming response chunk."""
    delta: str
    finish_reason: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)

class LLMProvider(ABC):
    """Abstract LLM provider for agent loop.
    
    Pattern inspired by Dify's api/core/model_providers/*.
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        pass
    
    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> Message:
        """Non-streaming chat completion."""
        pass
    
    @abstractmethod
    async def chat_stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncIterator[StreamChunk]:
        """Streaming chat completion."""
        pass
    
    @abstractmethod
    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        pass
```

- [ ] **Step 2: Write test**

```python
# test_agent_provider_base.py
from graph_caster.agent.providers import ToolDefinition, ToolCall, Message

def test_tool_definition_to_openai():
    tool = ToolDefinition(
        name="get_weather",
        description="Get weather for a city",
        parameters={
            "type": "object",
            "properties": {
                "city": {"type": "string"}
            },
            "required": ["city"]
        }
    )
    
    openai_format = tool.to_openai_format()
    
    assert openai_format["type"] == "function"
    assert openai_format["function"]["name"] == "get_weather"

def test_message_with_tool_calls():
    msg = Message(
        role="assistant",
        content="",
        tool_calls=[
            ToolCall(id="call-1", name="get_weather", arguments={"city": "NYC"})
        ]
    )
    
    assert len(msg.tool_calls) == 1
    assert msg.tool_calls[0].name == "get_weather"
```

- [ ] **Step 3: Run test**

```bash
pytest python/tests/test_agent_provider_base.py -v
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/agent/
git commit -m "feat(agent): add LLM provider interface with tool calling support"
```

---

## Task 2: OpenAI Provider Implementation

**Files:**
- Create: `python/graph_caster/agent/providers/openai.py`
- Test: `python/tests/test_agent_provider_openai.py`

- [ ] **Step 1: Write failing test**

```python
# test_agent_provider_openai.py
import pytest
import os

@pytest.fixture
def openai_provider():
    from graph_caster.agent.providers.openai import OpenAIProvider
    return OpenAIProvider(
        api_key=os.environ.get("OPENAI_API_KEY", "test-key"),
        model="gpt-4o-mini"
    )

def test_openai_provider_name(openai_provider):
    assert openai_provider.name == "openai"

@pytest.mark.skipif(not os.environ.get("OPENAI_API_KEY"), reason="No API key")
@pytest.mark.asyncio
async def test_openai_chat(openai_provider):
    from graph_caster.agent.providers import Message
    
    response = await openai_provider.chat([
        Message(role="user", content="Say hello in one word")
    ])
    
    assert response.role == "assistant"
    assert len(response.content) > 0

@pytest.mark.skipif(not os.environ.get("OPENAI_API_KEY"), reason="No API key")
@pytest.mark.asyncio
async def test_openai_tool_calling(openai_provider):
    from graph_caster.agent.providers import Message, ToolDefinition
    
    tools = [
        ToolDefinition(
            name="get_weather",
            description="Get weather for a city",
            parameters={
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"]
            }
        )
    ]
    
    response = await openai_provider.chat(
        messages=[Message(role="user", content="What's the weather in Paris?")],
        tools=tools
    )
    
    # Model should call the tool
    assert len(response.tool_calls) > 0
    assert response.tool_calls[0].name == "get_weather"
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement OpenAI provider**

```python
# openai.py
import json
from typing import AsyncIterator
import openai
from .base import LLMProvider, Message, ToolDefinition, ToolCall, StreamChunk

class OpenAIProvider(LLMProvider):
    """OpenAI API provider.
    
    Supports GPT-4, GPT-4o, GPT-3.5-turbo with function calling.
    """
    
    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str | None = None,
    ):
        self.model = model
        self._client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
        )
    
    @property
    def name(self) -> str:
        return "openai"
    
    def _messages_to_openai(self, messages: list[Message]) -> list[dict]:
        result = []
        for msg in messages:
            m = {"role": msg.role, "content": msg.content}
            if msg.tool_calls:
                m["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments)
                        }
                    }
                    for tc in msg.tool_calls
                ]
            if msg.tool_call_id:
                m["tool_call_id"] = msg.tool_call_id
            if msg.name:
                m["name"] = msg.name
            result.append(m)
        return result
    
    def _parse_tool_calls(self, tool_calls: list | None) -> list[ToolCall]:
        if not tool_calls:
            return []
        return [
            ToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=json.loads(tc.function.arguments or "{}")
            )
            for tc in tool_calls
        ]
    
    async def chat(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> Message:
        kwargs = {
            "model": self.model,
            "messages": self._messages_to_openai(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        
        if tools:
            kwargs["tools"] = [t.to_openai_format() for t in tools]
        
        response = await self._client.chat.completions.create(**kwargs)
        choice = response.choices[0]
        
        return Message(
            role="assistant",
            content=choice.message.content or "",
            tool_calls=self._parse_tool_calls(choice.message.tool_calls)
        )
    
    async def chat_stream(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncIterator[StreamChunk]:
        kwargs = {
            "model": self.model,
            "messages": self._messages_to_openai(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        
        if tools:
            kwargs["tools"] = [t.to_openai_format() for t in tools]
        
        async with await self._client.chat.completions.create(**kwargs) as stream:
            tool_calls_buffer: dict[int, dict] = {}
            
            async for chunk in stream:
                delta = chunk.choices[0].delta
                finish_reason = chunk.choices[0].finish_reason
                
                # Handle streaming tool calls
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_buffer:
                            tool_calls_buffer[idx] = {
                                "id": tc.id or "",
                                "name": tc.function.name if tc.function else "",
                                "arguments": ""
                            }
                        if tc.function and tc.function.arguments:
                            tool_calls_buffer[idx]["arguments"] += tc.function.arguments
                
                # Yield chunk
                tool_calls = []
                if finish_reason == "tool_calls":
                    tool_calls = [
                        ToolCall(
                            id=tc["id"],
                            name=tc["name"],
                            arguments=json.loads(tc["arguments"] or "{}")
                        )
                        for tc in tool_calls_buffer.values()
                    ]
                
                yield StreamChunk(
                    delta=delta.content or "",
                    finish_reason=finish_reason,
                    tool_calls=tool_calls
                )
    
    def count_tokens(self, text: str) -> int:
        try:
            import tiktoken
            enc = tiktoken.encoding_for_model(self.model)
            return len(enc.encode(text))
        except Exception:
            # Fallback: rough estimate
            return len(text) // 4
```

- [ ] **Step 4: Tests pass**

```bash
OPENAI_API_KEY=sk-... pytest python/tests/test_agent_provider_openai.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/agent/providers/openai.py
git commit -m "feat(agent): add OpenAI provider with function calling"
```

---

## Task 3: Agent Loop Implementation

**Files:**
- Create: `python/graph_caster/agent/loop.py`
- Create: `python/graph_caster/agent/tool_executor.py`
- Test: `python/tests/test_agent_loop.py`

- [ ] **Step 1: Write failing test**

```python
# test_agent_loop.py
import pytest
from graph_caster.agent.loop import AgentLoop, AgentStep
from graph_caster.agent.providers import Message, ToolDefinition, ToolCall

class MockProvider:
    name = "mock"
    call_count = 0
    
    async def chat(self, messages, tools=None, **kwargs):
        self.call_count += 1
        
        # First call: request tool
        if self.call_count == 1:
            return Message(
                role="assistant",
                content="",
                tool_calls=[ToolCall(id="call-1", name="get_weather", arguments={"city": "NYC"})]
            )
        # Second call: final answer
        return Message(role="assistant", content="The weather in NYC is sunny.")
    
    async def chat_stream(self, messages, tools=None, **kwargs):
        msg = await self.chat(messages, tools, **kwargs)
        from graph_caster.agent.providers import StreamChunk
        yield StreamChunk(delta=msg.content, finish_reason="stop", tool_calls=msg.tool_calls)
    
    def count_tokens(self, text):
        return len(text) // 4

@pytest.mark.asyncio
async def test_agent_loop_executes_tools():
    provider = MockProvider()
    
    tools = [
        ToolDefinition(
            name="get_weather",
            description="Get weather",
            parameters={"type": "object", "properties": {"city": {"type": "string"}}}
        )
    ]
    
    async def execute_tool(name: str, arguments: dict) -> str:
        if name == "get_weather":
            return f"Weather in {arguments['city']}: sunny, 72°F"
        return "Unknown tool"
    
    loop = AgentLoop(
        provider=provider,
        tools=tools,
        tool_executor=execute_tool,
        max_iterations=5,
    )
    
    steps = []
    async for step in loop.run("What's the weather in NYC?"):
        steps.append(step)
    
    # Should have: thought -> tool_call -> tool_result -> final_answer
    assert len(steps) >= 2
    assert any(s.type == "tool_call" for s in steps)
    assert steps[-1].type == "final_answer"
    assert "sunny" in steps[-1].content.lower()

@pytest.mark.asyncio
async def test_agent_loop_respects_max_iterations():
    class InfiniteToolProvider:
        name = "infinite"
        async def chat(self, messages, tools=None, **kwargs):
            return Message(
                role="assistant",
                content="",
                tool_calls=[ToolCall(id="call-1", name="loop_tool", arguments={})]
            )
        async def chat_stream(self, *args, **kwargs):
            from graph_caster.agent.providers import StreamChunk
            yield StreamChunk(delta="", tool_calls=[ToolCall(id="call-1", name="loop_tool", arguments={})])
        def count_tokens(self, text):
            return 0
    
    loop = AgentLoop(
        provider=InfiniteToolProvider(),
        tools=[ToolDefinition(name="loop_tool", description="Loop", parameters={})],
        tool_executor=lambda *args: "result",
        max_iterations=3,
    )
    
    steps = []
    async for step in loop.run("Run forever"):
        steps.append(step)
    
    # Should stop at max iterations
    assert len([s for s in steps if s.type == "tool_call"]) <= 3
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement tool executor**

```python
# tool_executor.py
from typing import Callable, Awaitable, Any
from dataclasses import dataclass

ToolExecutorFn = Callable[[str, dict], Awaitable[str]]

@dataclass
class ToolResult:
    """Result of tool execution."""
    tool_call_id: str
    name: str
    result: str
    error: str | None = None
    
    def to_message(self) -> 'Message':
        from .providers import Message
        return Message(
            role="tool",
            content=self.result if not self.error else f"Error: {self.error}",
            tool_call_id=self.tool_call_id,
            name=self.name,
        )

async def execute_tools(
    tool_calls: list['ToolCall'],
    executor: ToolExecutorFn,
) -> list[ToolResult]:
    """Execute multiple tool calls in sequence."""
    results = []
    for tc in tool_calls:
        try:
            result = await executor(tc.name, tc.arguments)
            results.append(ToolResult(
                tool_call_id=tc.id,
                name=tc.name,
                result=str(result),
            ))
        except Exception as e:
            results.append(ToolResult(
                tool_call_id=tc.id,
                name=tc.name,
                result="",
                error=str(e),
            ))
    return results
```

- [ ] **Step 4: Implement agent loop**

```python
# loop.py
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable, Awaitable, Literal
from .providers import LLMProvider, Message, ToolDefinition, StreamChunk
from .tool_executor import execute_tools, ToolResult

@dataclass
class AgentStep:
    """One step in agent execution."""
    type: Literal["thought", "tool_call", "tool_result", "final_answer", "error"]
    content: str
    tool_name: str | None = None
    tool_args: dict | None = None
    iteration: int = 0

class AgentLoop:
    """In-runner agent loop with tool calling.
    
    Pattern inspired by:
    - Dify's api/core/workflow/nodes/agent/agent_node.py
    - n8n's AI Agent node iteration logic
    
    Streams steps via existing event transport.
    """
    
    def __init__(
        self,
        provider: LLMProvider,
        tools: list[ToolDefinition],
        tool_executor: Callable[[str, dict], Awaitable[str]],
        system_prompt: str | None = None,
        max_iterations: int = 10,
        temperature: float = 0.7,
    ):
        self.provider = provider
        self.tools = tools
        self.tool_executor = tool_executor
        self.system_prompt = system_prompt or self._default_system_prompt()
        self.max_iterations = max_iterations
        self.temperature = temperature
    
    def _default_system_prompt(self) -> str:
        return """You are a helpful AI assistant with access to tools.

When you need information or need to perform actions, use the available tools.
Always explain your reasoning before using tools.
When you have enough information to answer the user's question, provide a clear final answer."""
    
    async def run(self, user_message: str) -> AsyncIterator[AgentStep]:
        """Run agent loop, yielding steps."""
        messages: list[Message] = [
            Message(role="system", content=self.system_prompt),
            Message(role="user", content=user_message),
        ]
        
        for iteration in range(self.max_iterations):
            # Get LLM response
            response = await self.provider.chat(
                messages=messages,
                tools=self.tools if self.tools else None,
                temperature=self.temperature,
            )
            
            # Check if we have tool calls
            if response.tool_calls:
                # Yield tool call steps
                for tc in response.tool_calls:
                    yield AgentStep(
                        type="tool_call",
                        content=f"Calling {tc.name}",
                        tool_name=tc.name,
                        tool_args=tc.arguments,
                        iteration=iteration,
                    )
                
                # Add assistant message with tool calls
                messages.append(response)
                
                # Execute tools
                results = await execute_tools(response.tool_calls, self.tool_executor)
                
                # Yield tool results and add to messages
                for result in results:
                    yield AgentStep(
                        type="tool_result",
                        content=result.result if not result.error else f"Error: {result.error}",
                        tool_name=result.name,
                        iteration=iteration,
                    )
                    messages.append(result.to_message())
                
                # Continue loop for next iteration
                continue
            
            # No tool calls = final answer
            if response.content:
                yield AgentStep(
                    type="final_answer",
                    content=response.content,
                    iteration=iteration,
                )
            
            # Done
            return
        
        # Max iterations reached
        yield AgentStep(
            type="error",
            content=f"Agent stopped after {self.max_iterations} iterations",
            iteration=self.max_iterations,
        )
    
    async def run_stream(self, user_message: str) -> AsyncIterator[AgentStep]:
        """Run agent loop with streaming responses."""
        messages: list[Message] = [
            Message(role="system", content=self.system_prompt),
            Message(role="user", content=user_message),
        ]
        
        for iteration in range(self.max_iterations):
            # Stream LLM response
            full_content = ""
            tool_calls = []
            
            async for chunk in self.provider.chat_stream(
                messages=messages,
                tools=self.tools if self.tools else None,
                temperature=self.temperature,
            ):
                if chunk.delta:
                    full_content += chunk.delta
                    yield AgentStep(
                        type="thought",
                        content=chunk.delta,
                        iteration=iteration,
                    )
                
                if chunk.tool_calls:
                    tool_calls = chunk.tool_calls
            
            # Process tool calls
            if tool_calls:
                for tc in tool_calls:
                    yield AgentStep(
                        type="tool_call",
                        content=f"Calling {tc.name}",
                        tool_name=tc.name,
                        tool_args=tc.arguments,
                        iteration=iteration,
                    )
                
                messages.append(Message(
                    role="assistant",
                    content=full_content,
                    tool_calls=tool_calls
                ))
                
                results = await execute_tools(tool_calls, self.tool_executor)
                
                for result in results:
                    yield AgentStep(
                        type="tool_result",
                        content=result.result if not result.error else f"Error: {result.error}",
                        tool_name=result.name,
                        iteration=iteration,
                    )
                    messages.append(result.to_message())
                
                continue
            
            # Final answer
            if full_content:
                yield AgentStep(
                    type="final_answer",
                    content=full_content,
                    iteration=iteration,
                )
            
            return
        
        yield AgentStep(
            type="error",
            content=f"Agent stopped after {self.max_iterations} iterations",
            iteration=self.max_iterations,
        )
```

- [ ] **Step 5: Tests pass**

```bash
pytest python/tests/test_agent_loop.py -v
```

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/agent/
git commit -m "feat(agent): implement agent loop with tool calling (§33)"
```

---

## Task 4: Agent Node

**Files:**
- Create: `python/graph_caster/nodes/agent_node.py`
- Modify: `schemas/graph-document.schema.json`
- Test: `python/tests/test_agent_node.py`

- [ ] **Step 1: Write failing test**

```python
# test_agent_node.py
import pytest
from graph_caster.nodes.agent_node import AgentNode
from graph_caster.runner.context import RunContext

@pytest.mark.asyncio
async def test_agent_node_executes():
    node = AgentNode(
        id="agent-1",
        config={
            "provider": "openai",
            "model": "gpt-4o-mini",
            "systemPrompt": "You are a helpful assistant",
            "tools": [],
            "maxIterations": 5,
        }
    )
    
    # Mock context with input
    ctx = RunContext(
        run_id="run-1",
        graph_id="graph-1",
        node_inputs={
            "agent-1": {"prompt": "Say hello"}
        }
    )
    
    # Would need API key to actually run
    # Just verify structure
    assert node.config.provider == "openai"
    assert node.config.max_iterations == 5
```

- [ ] **Step 2: Implement agent node**

```python
# agent_node.py
from dataclasses import dataclass, field
from typing import Any, Literal
from graph_caster.nodes.base import Node, NodeResult
from graph_caster.agent.loop import AgentLoop, AgentStep
from graph_caster.agent.providers import ToolDefinition

@dataclass
class AgentNodeConfig:
    provider: Literal["openai", "anthropic"] = "openai"
    model: str = "gpt-4o-mini"
    systemPrompt: str = ""
    tools: list[dict] = field(default_factory=list)  # Tool definitions
    maxIterations: int = 10
    temperature: float = 0.7
    apiKey: str = ""  # Or use secrets

class AgentNode(Node):
    """Agent node — runs LLM with tool calling loop.
    
    Pattern: Similar to Dify's agent_node.py and n8n's AI Agent node.
    
    Input:
    - prompt: str — User message to process
    - context: dict (optional) — Additional context
    
    Output:
    - response: str — Final agent response
    - steps: list — Execution trace
    - iterations: int — Number of iterations used
    """
    
    node_type = "agent"
    
    def __init__(self, id: str, config: dict):
        super().__init__(id)
        self.config = AgentNodeConfig(**config)
    
    def validate(self) -> None:
        if not self.config.provider:
            raise ValueError("Agent node requires provider")
        if self.config.maxIterations < 1:
            raise ValueError("maxIterations must be >= 1")
    
    async def execute(self, ctx: 'RunContext') -> NodeResult:
        # Get input prompt
        inputs = ctx.node_inputs.get(self.id, {})
        prompt = inputs.get("prompt", "")
        if not prompt:
            raise ValueError("Agent node requires 'prompt' input")
        
        # Create provider
        provider = self._create_provider(ctx)
        
        # Parse tool definitions
        tools = [
            ToolDefinition(
                name=t["name"],
                description=t.get("description", ""),
                parameters=t.get("parameters", {})
            )
            for t in self.config.tools
        ]
        
        # Create tool executor from context
        tool_executor = self._create_tool_executor(ctx, tools)
        
        # Run agent loop
        loop = AgentLoop(
            provider=provider,
            tools=tools,
            tool_executor=tool_executor,
            system_prompt=self.config.systemPrompt,
            max_iterations=self.config.maxIterations,
            temperature=self.config.temperature,
        )
        
        steps = []
        final_response = ""
        
        async for step in loop.run(prompt):
            steps.append({
                "type": step.type,
                "content": step.content,
                "toolName": step.tool_name,
                "toolArgs": step.tool_args,
                "iteration": step.iteration,
            })
            
            # Emit step event for streaming
            await ctx.emit_event("agent_step", {
                "nodeId": self.id,
                "step": steps[-1]
            })
            
            if step.type == "final_answer":
                final_response = step.content
        
        return {
            "response": final_response,
            "steps": steps,
            "iterations": len(set(s["iteration"] for s in steps)),
        }
    
    def _create_provider(self, ctx: 'RunContext'):
        api_key = self.config.apiKey or ctx.get_secret(f"{self.config.provider.upper()}_API_KEY")
        
        if self.config.provider == "openai":
            from graph_caster.agent.providers.openai import OpenAIProvider
            return OpenAIProvider(api_key=api_key, model=self.config.model)
        elif self.config.provider == "anthropic":
            from graph_caster.agent.providers.anthropic import AnthropicProvider
            return AnthropicProvider(api_key=api_key, model=self.config.model)
        else:
            raise ValueError(f"Unknown provider: {self.config.provider}")
    
    def _create_tool_executor(self, ctx: 'RunContext', tools: list[ToolDefinition]):
        """Create tool executor that can call graph nodes as tools."""
        async def execute(name: str, arguments: dict) -> str:
            # Check if tool is a graph node reference
            tool_node = ctx.graph.get_node(name)
            if tool_node:
                # Execute node as tool
                result = await tool_node.execute(ctx.with_inputs({name: arguments}))
                return str(result)
            
            # Check if tool is MCP tool
            if name.startswith("mcp:"):
                mcp_result = await ctx.call_mcp_tool(name[4:], arguments)
                return str(mcp_result)
            
            return f"Unknown tool: {name}"
        
        return execute
```

- [ ] **Step 3: Add to schema**

```json
{
  "type": "agent",
  "properties": {
    "provider": { "enum": ["openai", "anthropic"], "default": "openai" },
    "model": { "type": "string", "default": "gpt-4o-mini" },
    "systemPrompt": { "type": "string" },
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "parameters": { "type": "object" }
        }
      }
    },
    "maxIterations": { "type": "integer", "default": 10 },
    "temperature": { "type": "number", "default": 0.7 }
  },
  "required": ["provider"]
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/nodes/agent_node.py schemas/
git commit -m "feat(nodes): add agent node with tool calling loop (§20, §33)"
```

---

## Task 5: Vector Store Interface

**Files:**
- Create: `python/graph_caster/rag/__init__.py`
- Create: `python/graph_caster/rag/stores/__init__.py`
- Create: `python/graph_caster/rag/stores/base.py`
- Test: `python/tests/test_rag_store_base.py`

- [ ] **Step 1: Define vector store interface**

```python
# base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

@dataclass
class Document:
    """Document for RAG indexing/retrieval."""
    id: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] | None = None

@dataclass
class SearchResult:
    """Search result with score."""
    document: Document
    score: float

class VectorStore(ABC):
    """Abstract vector store interface.
    
    Pattern: Similar to Langflow's VectorStore component and
    Dify's api/core/rag/datasource/*.
    """
    
    @abstractmethod
    async def initialize(self) -> None:
        """Initialize store connection."""
        pass
    
    @abstractmethod
    async def close(self) -> None:
        """Close store connection."""
        pass
    
    @abstractmethod
    async def add_documents(
        self,
        documents: list[Document],
        collection: str = "default",
    ) -> list[str]:
        """Add documents to store. Returns document IDs."""
        pass
    
    @abstractmethod
    async def search(
        self,
        query: str,
        collection: str = "default",
        top_k: int = 5,
        filter: dict | None = None,
    ) -> list[SearchResult]:
        """Search for similar documents."""
        pass
    
    @abstractmethod
    async def delete(
        self,
        ids: list[str],
        collection: str = "default",
    ) -> int:
        """Delete documents by ID. Returns count deleted."""
        pass
    
    @abstractmethod
    async def list_collections(self) -> list[str]:
        """List available collections."""
        pass
```

- [ ] **Step 2: Write test**

```python
# test_rag_store_base.py
from graph_caster.rag.stores import Document, SearchResult

def test_document_creation():
    doc = Document(
        id="doc-1",
        content="Hello world",
        metadata={"source": "test"}
    )
    
    assert doc.id == "doc-1"
    assert doc.content == "Hello world"
    assert doc.metadata["source"] == "test"

def test_search_result():
    doc = Document(id="1", content="test")
    result = SearchResult(document=doc, score=0.95)
    
    assert result.score == 0.95
    assert result.document.id == "1"
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/rag/
git commit -m "feat(rag): add vector store interface"
```

---

## Task 6: ChromaDB Implementation

**Files:**
- Create: `python/graph_caster/rag/stores/chroma.py`
- Test: `python/tests/test_rag_store_chroma.py`

- [ ] **Step 1: Write failing test**

```python
# test_rag_store_chroma.py
import pytest
import tempfile
from graph_caster.rag.stores import Document
from graph_caster.rag.stores.chroma import ChromaVectorStore

@pytest.fixture
async def chroma_store():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaVectorStore(persist_directory=tmpdir)
        await store.initialize()
        yield store
        await store.close()

@pytest.mark.asyncio
async def test_chroma_add_and_search(chroma_store):
    docs = [
        Document(id="1", content="Python is a programming language"),
        Document(id="2", content="JavaScript runs in browsers"),
        Document(id="3", content="Rust is fast and memory safe"),
    ]
    
    ids = await chroma_store.add_documents(docs, collection="test")
    assert len(ids) == 3
    
    results = await chroma_store.search(
        query="programming language",
        collection="test",
        top_k=2
    )
    
    assert len(results) == 2
    # Python doc should be most relevant
    assert any(r.document.id == "1" for r in results)

@pytest.mark.asyncio
async def test_chroma_delete(chroma_store):
    docs = [Document(id="1", content="Test doc")]
    await chroma_store.add_documents(docs, collection="test")
    
    deleted = await chroma_store.delete(["1"], collection="test")
    assert deleted == 1
    
    results = await chroma_store.search("test", collection="test")
    assert len(results) == 0
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement ChromaDB store**

```python
# chroma.py
import asyncio
from typing import Any
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from .base import VectorStore, Document, SearchResult

class ChromaVectorStore(VectorStore):
    """ChromaDB vector store implementation.
    
    Uses sentence-transformers for embeddings by default.
    """
    
    def __init__(
        self,
        persist_directory: str | None = None,
        embedding_model: str = "all-MiniLM-L6-v2",
    ):
        self.persist_directory = persist_directory
        self.embedding_model_name = embedding_model
        self._client: chromadb.Client | None = None
        self._embedder: SentenceTransformer | None = None
    
    async def initialize(self) -> None:
        # Initialize in thread pool (chromadb is sync)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._init_sync)
    
    def _init_sync(self) -> None:
        if self.persist_directory:
            self._client = chromadb.PersistentClient(
                path=self.persist_directory,
                settings=Settings(anonymized_telemetry=False)
            )
        else:
            self._client = chromadb.Client()
        
        self._embedder = SentenceTransformer(self.embedding_model_name)
    
    async def close(self) -> None:
        # ChromaDB handles cleanup automatically
        pass
    
    def _get_or_create_collection(self, name: str):
        return self._client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"}
        )
    
    async def add_documents(
        self,
        documents: list[Document],
        collection: str = "default",
    ) -> list[str]:
        loop = asyncio.get_event_loop()
        
        # Generate embeddings
        contents = [d.content for d in documents]
        embeddings = await loop.run_in_executor(
            None,
            lambda: self._embedder.encode(contents).tolist()
        )
        
        # Add to collection
        def add_sync():
            coll = self._get_or_create_collection(collection)
            coll.add(
                ids=[d.id for d in documents],
                embeddings=embeddings,
                documents=contents,
                metadatas=[d.metadata for d in documents]
            )
            return [d.id for d in documents]
        
        return await loop.run_in_executor(None, add_sync)
    
    async def search(
        self,
        query: str,
        collection: str = "default",
        top_k: int = 5,
        filter: dict | None = None,
    ) -> list[SearchResult]:
        loop = asyncio.get_event_loop()
        
        # Generate query embedding
        query_embedding = await loop.run_in_executor(
            None,
            lambda: self._embedder.encode([query]).tolist()[0]
        )
        
        def search_sync():
            coll = self._get_or_create_collection(collection)
            
            kwargs = {
                "query_embeddings": [query_embedding],
                "n_results": top_k,
            }
            if filter:
                kwargs["where"] = filter
            
            results = coll.query(**kwargs)
            
            search_results = []
            if results["ids"] and results["ids"][0]:
                for i, doc_id in enumerate(results["ids"][0]):
                    doc = Document(
                        id=doc_id,
                        content=results["documents"][0][i] if results["documents"] else "",
                        metadata=results["metadatas"][0][i] if results["metadatas"] else {},
                    )
                    # ChromaDB returns distances, convert to similarity score
                    distance = results["distances"][0][i] if results["distances"] else 0
                    score = 1 - distance  # For cosine distance
                    search_results.append(SearchResult(document=doc, score=score))
            
            return search_results
        
        return await loop.run_in_executor(None, search_sync)
    
    async def delete(
        self,
        ids: list[str],
        collection: str = "default",
    ) -> int:
        loop = asyncio.get_event_loop()
        
        def delete_sync():
            coll = self._get_or_create_collection(collection)
            coll.delete(ids=ids)
            return len(ids)
        
        return await loop.run_in_executor(None, delete_sync)
    
    async def list_collections(self) -> list[str]:
        loop = asyncio.get_event_loop()
        
        def list_sync():
            return [c.name for c in self._client.list_collections()]
        
        return await loop.run_in_executor(None, list_sync)
```

- [ ] **Step 4: Tests pass**

```bash
pytest python/tests/test_rag_store_chroma.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/rag/stores/chroma.py
git commit -m "feat(rag): add ChromaDB vector store implementation"
```

---

## Task 7: RAG Query Node

**Files:**
- Create: `python/graph_caster/nodes/rag_query_node.py`
- Modify: `schemas/graph-document.schema.json`
- Test: `python/tests/test_rag_query_node.py`

- [ ] **Step 1: Write failing test**

```python
# test_rag_query_node.py
import pytest
from graph_caster.nodes.rag_query_node import RagQueryNode

def test_rag_query_node_config():
    node = RagQueryNode(
        id="rag-1",
        config={
            "collection": "docs",
            "topK": 5,
            "scoreThreshold": 0.7,
        }
    )
    
    assert node.config.collection == "docs"
    assert node.config.top_k == 5
    assert node.config.score_threshold == 0.7

def test_rag_query_node_validates():
    node = RagQueryNode(
        id="rag-1",
        config={"collection": "", "topK": 0}  # Invalid
    )
    
    with pytest.raises(ValueError):
        node.validate()
```

- [ ] **Step 2: Implement RAG query node**

```python
# rag_query_node.py
from dataclasses import dataclass, field
from typing import Any, Literal
from graph_caster.nodes.base import Node, NodeResult
from graph_caster.rag.stores import VectorStore, SearchResult

@dataclass
class RagQueryConfig:
    collection: str = "default"
    topK: int = 5
    scoreThreshold: float = 0.0
    includeMetadata: bool = True
    
    @property
    def top_k(self) -> int:
        return self.topK
    
    @property
    def score_threshold(self) -> float:
        return self.scoreThreshold
    
    @property
    def include_metadata(self) -> bool:
        return self.includeMetadata

class RagQueryNode(Node):
    """RAG query node — retrieves relevant documents.
    
    Pattern: Similar to Dify's knowledge_retrieval_node.py
    
    Input:
    - query: str — Search query
    - filter: dict (optional) — Metadata filter
    
    Output:
    - documents: list — Retrieved documents with scores
    - count: int — Number of results
    """
    
    node_type = "rag_query"
    
    def __init__(self, id: str, config: dict):
        super().__init__(id)
        # Handle camelCase to snake_case
        self.config = RagQueryConfig(**config)
    
    def validate(self) -> None:
        if not self.config.collection:
            raise ValueError("RAG query requires collection name")
        if self.config.top_k < 1:
            raise ValueError("topK must be >= 1")
    
    async def execute(self, ctx: 'RunContext') -> NodeResult:
        inputs = ctx.node_inputs.get(self.id, {})
        query = inputs.get("query", "")
        filter_dict = inputs.get("filter")
        
        if not query:
            raise ValueError("RAG query requires 'query' input")
        
        # Get vector store from context
        store: VectorStore = ctx.get_service("vector_store")
        
        # Search
        results = await store.search(
            query=query,
            collection=self.config.collection,
            top_k=self.config.top_k,
            filter=filter_dict,
        )
        
        # Filter by score threshold
        filtered = [
            r for r in results
            if r.score >= self.config.score_threshold
        ]
        
        # Format output
        documents = []
        for r in filtered:
            doc = {
                "id": r.document.id,
                "content": r.document.content,
                "score": r.score,
            }
            if self.config.include_metadata:
                doc["metadata"] = r.document.metadata
            documents.append(doc)
        
        return {
            "documents": documents,
            "count": len(documents),
            "query": query,
        }
```

- [ ] **Step 3: Update schema**

```json
{
  "type": "rag_query",
  "properties": {
    "collection": { "type": "string", "default": "default" },
    "topK": { "type": "integer", "default": 5, "minimum": 1 },
    "scoreThreshold": { "type": "number", "default": 0.0 },
    "includeMetadata": { "type": "boolean", "default": true }
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/nodes/rag_query_node.py schemas/
git commit -m "feat(nodes): add rag_query node for document retrieval (§36)"
```

---

## Task 8: RAG Index Node

**Files:**
- Create: `python/graph_caster/nodes/rag_index_node.py`
- Create: `python/graph_caster/rag/indexer.py`
- Test: `python/tests/test_rag_index_node.py`

- [ ] **Step 1: Write failing test**

```python
# test_rag_index_node.py
import pytest
from graph_caster.nodes.rag_index_node import RagIndexNode

def test_rag_index_node_config():
    node = RagIndexNode(
        id="index-1",
        config={
            "collection": "docs",
            "chunkSize": 500,
            "chunkOverlap": 50,
        }
    )
    
    assert node.config.collection == "docs"
    assert node.config.chunk_size == 500
```

- [ ] **Step 2: Implement document indexer**

```python
# indexer.py
from dataclasses import dataclass
from typing import Iterator
import re

@dataclass
class Chunk:
    """Document chunk for indexing."""
    id: str
    content: str
    metadata: dict

def chunk_text(
    text: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
    separator: str = "\n\n",
) -> Iterator[str]:
    """Split text into overlapping chunks.
    
    Pattern: Similar to Langflow's RecursiveCharacterTextSplitter.
    """
    if not text:
        return
    
    # Try to split on separator first
    sections = text.split(separator)
    
    current_chunk = ""
    
    for section in sections:
        section = section.strip()
        if not section:
            continue
        
        # If section fits in current chunk
        if len(current_chunk) + len(section) + len(separator) <= chunk_size:
            if current_chunk:
                current_chunk += separator + section
            else:
                current_chunk = section
        else:
            # Yield current chunk if we have one
            if current_chunk:
                yield current_chunk
                # Start new chunk with overlap
                if chunk_overlap > 0:
                    overlap = current_chunk[-chunk_overlap:]
                    current_chunk = overlap + separator + section
                else:
                    current_chunk = section
            else:
                # Section is larger than chunk_size, split further
                words = section.split()
                current_chunk = ""
                for word in words:
                    if len(current_chunk) + len(word) + 1 <= chunk_size:
                        current_chunk = f"{current_chunk} {word}".strip()
                    else:
                        if current_chunk:
                            yield current_chunk
                        current_chunk = word
    
    if current_chunk:
        yield current_chunk

class DocumentIndexer:
    """Document indexer with chunking."""
    
    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def index_text(
        self,
        text: str,
        doc_id: str,
        metadata: dict | None = None,
    ) -> list[Chunk]:
        """Index text into chunks."""
        chunks = []
        base_metadata = metadata or {}
        
        for i, chunk_content in enumerate(chunk_text(
            text,
            self.chunk_size,
            self.chunk_overlap,
        )):
            chunk_id = f"{doc_id}:chunk:{i}"
            chunks.append(Chunk(
                id=chunk_id,
                content=chunk_content,
                metadata={
                    **base_metadata,
                    "doc_id": doc_id,
                    "chunk_index": i,
                }
            ))
        
        return chunks
```

- [ ] **Step 3: Implement RAG index node**

```python
# rag_index_node.py
from dataclasses import dataclass
from typing import Any
from graph_caster.nodes.base import Node, NodeResult
from graph_caster.rag.stores import VectorStore, Document
from graph_caster.rag.indexer import DocumentIndexer

@dataclass
class RagIndexConfig:
    collection: str = "default"
    chunkSize: int = 500
    chunkOverlap: int = 50
    
    @property
    def chunk_size(self) -> int:
        return self.chunkSize
    
    @property
    def chunk_overlap(self) -> int:
        return self.chunkOverlap

class RagIndexNode(Node):
    """RAG index node — indexes documents into vector store.
    
    Input:
    - documents: list — Documents to index [{id, content, metadata}]
    OR
    - text: str — Raw text to index
    - docId: str — Document ID for raw text
    
    Output:
    - indexed: int — Number of documents/chunks indexed
    - ids: list — IDs of indexed chunks
    """
    
    node_type = "rag_index"
    
    def __init__(self, id: str, config: dict):
        super().__init__(id)
        self.config = RagIndexConfig(**config)
    
    def validate(self) -> None:
        if not self.config.collection:
            raise ValueError("RAG index requires collection name")
    
    async def execute(self, ctx: 'RunContext') -> NodeResult:
        inputs = ctx.node_inputs.get(self.id, {})
        
        # Get vector store
        store: VectorStore = ctx.get_service("vector_store")
        
        indexer = DocumentIndexer(
            chunk_size=self.config.chunk_size,
            chunk_overlap=self.config.chunk_overlap,
        )
        
        documents_to_index: list[Document] = []
        
        # Handle document list input
        if "documents" in inputs:
            for doc in inputs["documents"]:
                chunks = indexer.index_text(
                    text=doc.get("content", ""),
                    doc_id=doc.get("id", ""),
                    metadata=doc.get("metadata", {})
                )
                documents_to_index.extend([
                    Document(id=c.id, content=c.content, metadata=c.metadata)
                    for c in chunks
                ])
        
        # Handle raw text input
        elif "text" in inputs:
            chunks = indexer.index_text(
                text=inputs["text"],
                doc_id=inputs.get("docId", "doc"),
                metadata=inputs.get("metadata", {})
            )
            documents_to_index.extend([
                Document(id=c.id, content=c.content, metadata=c.metadata)
                for c in chunks
            ])
        
        else:
            raise ValueError("RAG index requires 'documents' or 'text' input")
        
        # Index documents
        ids = await store.add_documents(
            documents=documents_to_index,
            collection=self.config.collection,
        )
        
        return {
            "indexed": len(ids),
            "ids": ids,
            "collection": self.config.collection,
        }
```

- [ ] **Step 4: Update schema**

```json
{
  "type": "rag_index",
  "properties": {
    "collection": { "type": "string", "default": "default" },
    "chunkSize": { "type": "integer", "default": 500 },
    "chunkOverlap": { "type": "integer", "default": 50 }
  }
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/nodes/rag_index_node.py python/graph_caster/rag/indexer.py
git commit -m "feat(nodes): add rag_index node for document ingestion"
```

---

## Task 9: Integration with Runner

**Files:**
- Modify: `python/graph_caster/runner/node_visits.py`
- Modify: `python/graph_caster/runner/context.py`
- Test: `python/tests/test_runner_agent_rag.py`

- [ ] **Step 1: Add node types to visitor**

```python
# In node_visits.py, add imports and handlers:

from graph_caster.nodes.agent_node import AgentNode
from graph_caster.nodes.rag_query_node import RagQueryNode
from graph_caster.nodes.rag_index_node import RagIndexNode

NODE_TYPES = {
    # ... existing types
    "agent": AgentNode,
    "rag_query": RagQueryNode,
    "rag_index": RagIndexNode,
}
```

- [ ] **Step 2: Add vector store to context**

```python
# In context.py, add service registry:

class RunContext:
    def __init__(self, ...):
        # ... existing
        self._services: dict[str, Any] = {}
    
    def register_service(self, name: str, service: Any) -> None:
        self._services[name] = service
    
    def get_service(self, name: str) -> Any:
        if name not in self._services:
            raise RuntimeError(f"Service not registered: {name}")
        return self._services[name]
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(runner): integrate agent and RAG nodes into runner"
```

---

## Task 10: Documentation

**Files:**
- Modify: `doc/PRODUCT_DESIGNE.md`

- [ ] **Step 1: Document new nodes**

Add to PRODUCT_DESIGNE.md:

```markdown
### Agent Node

Executes an LLM with tool calling in a loop.

**Config:**
- `provider`: "openai" | "anthropic" — LLM provider
- `model`: string — Model name (e.g., "gpt-4o-mini")
- `systemPrompt`: string — System prompt
- `tools`: array — Tool definitions (name, description, parameters)
- `maxIterations`: integer (default: 10) — Max tool calling iterations
- `temperature`: number (default: 0.7)

**Input:**
- `prompt`: string — User message

**Output:**
- `response`: string — Final agent response
- `steps`: array — Execution trace
- `iterations`: integer — Iterations used

**Events:**
- `agent_step`: Emitted for each step (thought, tool_call, tool_result, final_answer)

### RAG Query Node

Retrieves relevant documents from vector store.

**Config:**
- `collection`: string — Collection name
- `topK`: integer (default: 5) — Max results
- `scoreThreshold`: number (default: 0.0) — Minimum similarity score
- `includeMetadata`: boolean (default: true)

**Input:**
- `query`: string — Search query
- `filter`: object (optional) — Metadata filter

**Output:**
- `documents`: array — Retrieved documents with scores
- `count`: integer

### RAG Index Node

Indexes documents into vector store.

**Config:**
- `collection`: string — Collection name
- `chunkSize`: integer (default: 500) — Chunk size in characters
- `chunkOverlap`: integer (default: 50) — Overlap between chunks

**Input:**
- `documents`: array — [{id, content, metadata}]
OR
- `text`: string — Raw text
- `docId`: string — Document ID

**Output:**
- `indexed`: integer — Chunks indexed
- `ids`: array — Chunk IDs
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: add agent and RAG node documentation"
```

---

## Success Criteria

- [ ] `pytest python/tests/test_agent_*.py` — all pass
- [ ] `pytest python/tests/test_rag_*.py` — all pass
- [ ] Agent node with mock provider executes tool loop correctly
- [ ] RAG query/index with ChromaDB works end-to-end
- [ ] Agent step events stream via existing transport
- [ ] Integration test: Agent calls RAG as tool
- [ ] Documentation updated

---

## Dependencies

Add to `pyproject.toml`:

```toml
dependencies = [
    # Existing...
    "openai>=1.0",
    "anthropic>=0.20",
    "chromadb>=0.4",
    "sentence-transformers>=2.2",
]

[project.optional-dependencies]
tiktoken = ["tiktoken>=0.5"]
```
