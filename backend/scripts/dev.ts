import { watch } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

class DevSupervisor {
  private host: Bun.Subprocess | null = null;
  private ollama: Bun.Subprocess | null = null;
  private restarting = false;
  private stopped = false;

  async start(): Promise<void> {
    await this.ensureOllama();
    await this.run(["bun", "run", "db:migrate"]);
    await this.verifyModel();
    this.startHost();
    this.watchSources();

    const stop = () => void this.shutdown();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {});
  }

  private async ensureOllama(): Promise<void> {
    if (await this.isOllamaReady()) {
      console.log("Ollama: ready");
      return;
    }

    console.log("Ollama: starting local service");
    this.ollama = Bun.spawn(["ollama", "serve"], {
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(500);
      if (await this.isOllamaReady()) return;
      if (this.ollama.exitCode !== null) {
        throw new Error("ollama serve exited before becoming ready");
      }
    }
    throw new Error("Ollama did not become ready within 15 seconds");
  }

  private async isOllamaReady(): Promise<boolean> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(800),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async verifyModel(): Promise<void> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL ?? "llama3.2:3b";
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama preflight failed: ${response.status}`);
    const payload = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    const installed = new Set(payload.models?.map((item) => item.name) ?? []);
    if (!installed.has(model) && !installed.has(`${model}:latest`)) {
      throw new Error(
        `Ollama model '${model}' is not installed. Run: ollama pull ${model}`,
      );
    }
    console.log(`Ollama model: ${model}`);
  }

  private startHost(): void {
    console.log("Host: http://127.0.0.1:8000");
    this.host = Bun.spawn(["bun", "client/src/host/index.ts"], {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
    });
    void this.host.exited.then((exitCode) => {
      if (!this.stopped && !this.restarting) {
        console.error(`Host exited with code ${exitCode}`);
        process.exit(exitCode || 1);
      }
    });
  }

  private watchSources(): void {
    for (const directory of ["client/src", "server/src", "contracts/src"]) {
      try {
        watch(directory, { recursive: true }, () => void this.restartHost());
      } catch {
        console.warn(
          `Recursive watch unavailable for ${directory}; watching top-level changes only.`,
        );
        watch(directory, () => void this.restartHost());
      }
    }
  }

  private async restartHost(): Promise<void> {
    if (this.restarting || this.stopped) return;
    this.restarting = true;
    await sleep(120);
    this.host?.kill();
    if (this.host) await this.host.exited;
    this.startHost();
    this.restarting = false;
  }

  private async run(command: string[]): Promise<void> {
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
    }
  }

  private async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.host?.kill();
    if (this.host) await this.host.exited;
    this.ollama?.kill();
    if (this.ollama) await this.ollama.exited;
    process.exit(0);
  }
}

await new DevSupervisor().start();
