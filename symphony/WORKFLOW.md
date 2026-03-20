---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: ba5d64fc997f
  active_states:
    - Sprint Backlog
    - In Progress
  terminal_states:
    - Done
    - Canceled
    - Duplicate

polling:
  interval_ms: 15000

workspace:
  root: /tmp/symphony_workspaces

hooks:
  after_create: |
    git clone https://github.com:doublewordai/workspace.git .
agent:
  max_concurrent_agents: 1
  max_turns: 3
  max_retry_backoff_ms: 60000

codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_sandbox_policy:
    type: dangerFullAccess
  turn_timeout_ms: 300000
  stall_timeout_ms: 120000

server:
  port: 4000
---

You are an autonomous coding agent working on issue **{{ issue.identifier }}**: *{{ issue.title }}*.

## Issue Details

{{ issue.description }}

{% if issue.labels.size > 0 %}
**Labels:** {{ issue.labels | join: ", " }}
{% endif %}

{% if attempt %}
This is continuation attempt {{ attempt }}. Review your previous work and continue from where you left off.
{% endif %}

## Instructions

1. Read the issue carefully and understand exactly what is being asked.
2. Complete the task described in the issue within this workspace directory.
3. When you are done, create a file called `DONE.md` summarizing what you did.
4. Move the Linear issue to **Done** using the Linear GraphQL API (`https://api.linear.app/graphql`). The `LINEAR_API_KEY` environment variable is already set for authentication (pass it as the `Authorization` header). The issue ID is `{{ issue.id }}`. You will need to:
   - Query `workflowStates` to find the ID of the "Done" state for this issue's team
   - Call the `issueUpdate` mutation with that state ID
5. Do not ask for user input — work autonomously.
