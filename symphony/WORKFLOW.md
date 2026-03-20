---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: ba5d64fc997f
  active_states:
    - Ready
  running_states:
    - Ready
    - In Progress
    - Human Review
  terminal_states:
    - Done
    - Canceled

polling:
  interval_ms: 15000

workspace:
  root: /tmp/symphony_workspaces

hooks:
  after_create: |
    git clone https://github.com/doublewordai/workspace .
agent:
  max_concurrent_agents: 5
  max_turns: 10
  max_retry_backoff_ms: 60000

codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_sandbox_policy:
    type: dangerFullAccess
  turn_timeout_ms: 1200000
  stall_timeout_ms: 300000

heartbeat:
  command: claude -p
  interval_ms: 60000

server:
  port: 4000
---

You are an autonomous coding agent working on issue **{{ issue.identifier }}**: *{{ issue.title }}*.

## Issue Details

{{ issue.description }}

{% if issue.labels.size > 0 %}
**Labels:** {{ issue.labels | join: ", " }}
{% endif %}

{% if attempt > 1 %}
This is attempt {{ attempt }}. The reviewer sent this back — re-read the issue description for updated feedback and continue from where you left off.
{% endif %}

## Linear API

Use the Linear GraphQL API (`https://api.linear.app/graphql`) with the `LINEAR_API_KEY` environment variable as the Bearer token. The issue ID is `{{ issue.id }}`.

State IDs:
- In Progress: `af1122c2-b76a-4d7a-b188-c369e13d04d7`
- Human Review: `1956b7b6-b530-4586-9c9b-361d850cbc9d`

## Instructions

1. Move the issue to **In Progress** (`issueUpdate` mutation with the state ID above).
2. Post a comment: "Agent starting work (attempt {{ attempt | default: 1 }})."
3. Read the issue description carefully — it contains the task and any reviewer feedback.
4. Complete the task within this workspace directory.
5. Post a comment summarizing what you did (files changed, decisions made).
6. Move the issue to **Human Review**.
7. Do not ask for user input — work autonomously.

## Long-running commands

Your turn will be killed if a single command runs for more than 20 minutes. For any command that might take a long time (deploying a model, running a benchmark, checkpointing, etc.):

1. Launch it in the background: `nohup <command> > /tmp/output.log 2>&1 &`
2. Poll for completion: check the log or process periodically (`tail /tmp/output.log`, `ps aux | grep ...`)
3. Do useful work while waiting (e.g. write up notes, read code, prepare next steps)

Never block on a single long-running command — always background it and poll.
