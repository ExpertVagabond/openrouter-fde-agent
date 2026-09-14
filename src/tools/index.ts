import { serverTool } from '@openrouter/agent';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { listDirTool } from './list-dir.js';
import { shellTool } from './shell.js';
import { openrouterEndpointsTool } from './openrouter-endpoints.js';
import { openrouterProbeTool } from './openrouter-probe.js';
import { openrouterBatchSubmitTool, openrouterBatchStatusTool, openrouterBatchListTool } from './openrouter-batch.js';

export const tools = [
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  globTool,
  grepTool,
  listDirTool,
  shellTool,

  // Domain tools: live OpenRouter routing and cost data
  openrouterEndpointsTool,
  openrouterProbeTool,
  openrouterBatchSubmitTool,
  openrouterBatchStatusTool,
  openrouterBatchListTool,

  // Server tool: executed by OpenRouter, no client implementation needed.
  // openrouter:datetime is deliberately omitted: on claude-sonnet-4.6 (2026-09-14)
  // combining it with any client tool call returned an empty output array.
  // AGENT_NO_SERVER_TOOLS=1 drops it: free-tier models must not call paid server tools.
  ...(process.env.AGENT_NO_SERVER_TOOLS ? [] : [serverTool({ type: 'openrouter:web_search' })]),
];
