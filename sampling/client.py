import asyncio
from anthropic import AsyncAnthropic
from mcp import ClientSession, StdioServerParameters
from mcp.types import LoggingMessageNotificationParams
from mcp.client.stdio import stdio_client
from mcp.client.session import RequestContext
from mcp.types import (
    CreateMessageRequestParams,
    CreateMessageResult,
    TextContent,
    SamplingMessage,
)

anthropic_client = AsyncAnthropic()
model = "claude-sonnet-4-0"

server_params = StdioServerParameters(
    command="uv",
    args=["run", "server.py"],
)


async def chat(input_messages: list[SamplingMessage], max_tokens=4000):
    messages = []
    for msg in input_messages:
        if msg.role == "user" and msg.content.type == "text":
            content = (
                msg.content.text
                if hasattr(msg.content, "text")
                else str(msg.content)
            )
            messages.append({"role": "user", "content": content})
        elif msg.role == "assistant" and msg.content.type == "text":
            content = (
                msg.content.text
                if hasattr(msg.content, "text")
                else str(msg.content)
            )
            messages.append({"role": "assistant", "content": content})

    response = await anthropic_client.messages.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
    )

    text = "".join([p.text for p in response.content if p.type == "text"])
    return text


async def sampling_callback(
    context: RequestContext, params: CreateMessageRequestParams
):
    # Call Claude using the Anthropic SDK
    text = await chat(params.messages)

    return CreateMessageResult(
        role="assistant",
        model=model,
        content=TextContent(type="text", text=text),
    )

async def logging_callback(params: LoggingMessageNotificationParams):
    print(params.data)


async def print_progress_callback(
    progress: float, total: float | None, message: str | None
):
    if total is not None:
        percentage = (progress / total) * 100
        print(f"Progress: {progress}/{total} ({percentage:.1f}%)")
    else:
        print(f"Progress: {progress}")


async def run():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(
            read, write, sampling_callback=sampling_callback, logging_callback=logging_callback
        ) as session:
            await session.initialize()

            result = await session.call_tool(
                name="summarize",
                arguments={"text_to_summarize": "lots of text"},
                log_arguments={"a": 1, "b": 3},
                progress_callback=print_progress_callback,
            )
            print(result.content)


if __name__ == "__main__":
    import asyncio

    asyncio.run(run())
