/**
 * Watch the bridge without Claude Code:
 *
 *   npm run bridge
 *   npm run bridge:replay
 *
 * Posts a short scripted session to the hook endpoint: main-conversation tool
 * calls, four parallel code-reviewer subagents, one tdd-guide, a failing tool
 * and two subagents that never stop. Payloads are synthetic and contain no real
 * prompts or tool output. The bridge drops them when it is not running.
 */

const PORT = Number.parseInt(process.env.BRIDGE_PORT ?? "8791", 10);
const HOOK_URL = `http://127.0.0.1:${Number.isInteger(PORT) ? PORT : 8791}/hook`;
const SESSION = "replay-session-1";
const CWD = "/home/replay/ai-agent-world";

interface Hook {
  hook_event_name: string;
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function send(hook: Hook): Promise<void> {
  const body = {
    session_id: SESSION,
    cwd: CWD,
    transcript_path: "/home/replay/.claude/projects/example.jsonl",
    ...hook,
  };
  try {
    await fetch(HOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // The replay is a convenience; a stopped bridge is not an error.
  }
}

function preTooluse(
  toolName: string,
  toolInput: Record<string, unknown>,
  agentId?: string,
): Hook {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: `toolu_replay_${toolName.toLowerCase()}`,
    ...(agentId === undefined
      ? {}
      : { agent_id: agentId, agent_type: "code-reviewer" }),
  };
}

async function main(): Promise<void> {
  await send({ hook_event_name: "SessionStart", source: "startup" });
  await sleep(300);
  await send({ hook_event_name: "UserPromptSubmit" });
  await send(preTooluse("Read", { file_path: `${CWD}/src/index.ts` }));
  await sleep(300);

  const reviewers = ["replay-1", "replay-2", "replay-3", "replay-4"];
  const descriptions = [
    "Review the authentication change",
    "Audit the token refresh path",
    "Check the session expiry handling",
    "Review the logout endpoint",
  ];
  for (let index = 0; index < reviewers.length; index += 1) {
    await send(
      preTooluse("Agent", {
        description: descriptions[index],
        prompt: "Synthetic prompt, never forwarded.",
        subagent_type: "code-reviewer",
      }),
    );
  }
  await sleep(300);

  for (const agentId of reviewers) {
    await send({
      hook_event_name: "SubagentStart",
      agent_id: agentId,
      agent_type: "code-reviewer",
    });
  }
  await sleep(400);

  for (let index = 0; index < reviewers.length; index += 1) {
    const agentId = reviewers[index];
    await send(
      preTooluse(
        "Read",
        { file_path: `${CWD}/src/auth/session-${index + 1}.ts` },
        agentId,
      ),
    );
  }
  await sleep(400);

  await send(
    preTooluse(
      "Bash",
      { command: "npm test -- --runInBand" },
      reviewers[3],
    ),
  );
  await sleep(300);
  await send({
    hook_event_name: "PostToolUseFailure",
    agent_id: reviewers[3],
    agent_type: "code-reviewer",
    tool_name: "Bash",
    tool_input: { command: "npm test -- --runInBand" },
    tool_use_id: "toolu_replay_bash",
    error: "Synthetic failure, never forwarded.",
    is_interrupt: false,
  });
  await sleep(300);

  await send(
    preTooluse("Agent", {
      description: "Add focused checks for the token store",
      prompt: "Synthetic prompt, never forwarded.",
      subagent_type: "tdd-guide",
    }),
  );
  await send({
    hook_event_name: "SubagentStart",
    agent_id: "replay-5",
    agent_type: "tdd-guide",
  });
  await sleep(400);

  for (const agentId of reviewers.slice(0, 3)) {
    await send({
      hook_event_name: "SubagentStop",
      agent_id: agentId,
      agent_type: "code-reviewer",
      agent_transcript_path: `/home/replay/.claude/projects/${agentId}.jsonl`,
      last_assistant_message:
        "Synthetic review summary. The change is small and the checks pass.",
    });
    await sleep(200);
  }

  await send({ hook_event_name: "Stop" });
  console.log(
    "Replay sent. Two subagents stay live until the bridge reaps them or the session ends.",
  );
}

void main().catch(() => {
  process.exitCode = 0;
});
