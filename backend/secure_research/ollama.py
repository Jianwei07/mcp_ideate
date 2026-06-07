from __future__ import annotations

import json

import httpx
from mcp import types

from .models import SampledAnswer


class OllamaUnavailable(RuntimeError):
    pass


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: float = 180.0,
        context_tokens: int = 8192,
        max_output_tokens: int = 1200,
        keep_alive: str = "5m",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout_seconds
        self.context_tokens = context_tokens
        self.max_output_tokens = max_output_tokens
        self.keep_alive = keep_alive

    async def preflight(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
        except (httpx.HTTPError, OSError) as exc:
            raise OllamaUnavailable(
                "Ollama is not reachable at "
                f"{self.base_url}. Start it with `ollama serve`."
            ) from exc

        installed = {
            item.get("name", "")
            for item in response.json().get("models", [])
        }
        model_available = self.model in installed
        if ":" not in self.model:
            model_available = model_available or f"{self.model}:latest" in installed
        if not model_available:
            raise OllamaUnavailable(
                f"Required model '{self.model}' is not installed. "
                f"Run `ollama pull {self.model}`."
            )

    async def sample(
        self, params: types.CreateMessageRequestParams
    ) -> SampledAnswer:
        messages: list[dict[str, str]] = []
        if params.systemPrompt:
            messages.append({"role": "system", "content": params.systemPrompt})
        for message in params.messages:
            content = message.content
            if isinstance(content, types.TextContent):
                messages.append({"role": message.role, "content": content.text})

        schema = SampledAnswer.model_json_schema()
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "format": schema,
            "keep_alive": self.keep_alive,
            "options": {
                "temperature": 0.1,
                "num_ctx": self.context_tokens,
                "num_predict": min(
                    params.maxTokens, self.max_output_tokens
                ),
            },
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/chat", json=payload
            )
            response.raise_for_status()
        content = response.json()["message"]["content"]
        return SampledAnswer.model_validate(json.loads(content))
