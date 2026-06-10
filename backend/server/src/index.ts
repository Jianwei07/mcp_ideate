import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadServerConfig } from "./config.ts";
import { registerResearchTool } from "./tools/research.ts";

const config = loadServerConfig();
const mcp = new McpServer(
  {
    name: "secure-research",
    version: "0.2.0",
  },
  {
    capabilities: {
      logging: {},
    },
    instructions:
      "Research only the configured, allowlisted Notion knowledge base. Inference is delegated to the MCP client through sampling.",
  },
);

registerResearchTool(mcp, config);

const transport = new StdioServerTransport();
await mcp.connect(transport);
