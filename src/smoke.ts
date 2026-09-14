// Headless smoke test: one real prompt through the agent loop with the
// OpenRouter tools, capped by AGENT_MAX_COST. Usage:
//   node --env-file=$HOME/.config/openrouter/openrouter.env node_modules/.bin/tsx src/smoke.ts "question"
import { loadConfig } from './config.js';
import { runAgentWithRetry } from './agent.js';

const question =
  process.argv[2] ??
  'Which provider should a cost-sensitive batch job use for deepseek/deepseek-chat-v3.1 right now, and what exact provider settings would you set? Use openrouter_endpoints; do not probe.';

const config = loadConfig({ maxCost: Number(process.env.AGENT_MAX_COST ?? 0.1), maxSteps: 6 });
console.log(`model=${config.model} maxCost=$${config.maxCost}\n`);

const result = await runAgentWithRetry(config, question, {
  onEvent: (e) => {
    if (e.type === 'tool_call') console.log(`\n[tool] ${e.name} ${JSON.stringify(e.args)}`);
    else if (e.type === 'tool_result') console.log(`[result] ${e.output}\n`);
    else if (e.type === 'text') process.stdout.write(e.delta);
  },
});
console.log(`\n\n--- final text ---\n${result.text}`);
console.log(`--- output items: ${result.output.map((o: any) => o.type + (o.name ? ':' + o.name : '')).join(', ')}`);
console.log(`usage: ${JSON.stringify(result.usage)}`);
