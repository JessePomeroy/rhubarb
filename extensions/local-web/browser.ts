import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { configuration } from "./config.ts";

/** One MCP session per Pi extension instance; browser operations cannot race. */
export class BrowserClient {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private queue: Promise<unknown> = Promise.resolve();

  private async connected(signal?: AbortSignal) {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(
      configuration().browser,
    );
    const client = new Client({ name: "rhubarb-local-web", version: "1.0.0" });
    try {
      await client.connect(transport, { signal });
    } catch (error) {
      await transport.close();
      throw error;
    }
    this.transport = transport;
    this.client = client;
    return client;
  }

  private serial<T>(run: () => Promise<T>, signal?: AbortSignal) {
    const result = this.queue
      .catch(() => undefined)
      .then(() => {
        signal?.throwIfAborted();
        return run();
      });
    this.queue = result;
    return result;
  }

  tools(name?: string, signal?: AbortSignal) {
    return this.serial(async () => {
      const client = await this.connected(signal);
      const { tools } = await client.listTools({}, { signal });
      if (name) {
        const tool = tools.find((tool) => tool.name === name);
        if (!tool) throw new Error(`Unknown Playwright tool: ${name}`);
        return tool;
      }
      return tools.map(({ name, description }) => ({ name, description }));
    }, signal);
  }

  call(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.serial(async () => {
      const client = await this.connected(signal);
      return client.callTool({ name, arguments: args }, undefined, { signal });
    }, signal);
  }

  async close() {
    try {
      await this.transport?.terminateSession();
    } finally {
      await this.client?.close();
      this.client = undefined;
      this.transport = undefined;
    }
  }
}
