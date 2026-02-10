import {
  startServer,
  startExecutor,
  api,
  connectTerminal,
  type ServerHandle,
  type ExecutorHandle,
} from "./helpers";

let server: ServerHandle;
let executor: ExecutorHandle;

beforeAll(async () => {
  server = await startServer();

  // Start executor process that connects to the server
  executor = await startExecutor(server.baseUrl, {
    id: "test-exec",
    name: "Test Executor",
  });

  // Wait for the executor to appear in the executors list
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const executors = await api(server.baseUrl).executors.list();
    const found = executors.find((e: any) => e.id === "test-exec");
    if (found && found.status === "online") break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 60000);

afterAll(() => {
  executor?.cleanup();
  server?.cleanup();
});

describe("Remote executor", () => {
  it("lists the executor as online", async () => {
    const executors = await api(server.baseUrl).executors.list();
    const found = executors.find((e: any) => e.id === "test-exec");
    expect(found).toBeDefined();
    expect(found.status).toBe("online");
    expect(found.name).toBe("Test Executor");
  });

  it("creates a session on the remote executor and interacts with it", async () => {
    // Create a session targeting the remote executor
    const createRes = await api(server.baseUrl).sessions.create({
      command: "bash",
      executor: "test-exec",
    });
    expect(createRes.status).toBe(201);
    const session = await createRes.json();
    const sessionName = session.name;
    expect(session.executor).toBe("test-exec");

    // List sessions — should show executor field
    const sessions = await api(server.baseUrl).sessions.list();
    const found = sessions.find((s: any) => s.name === sessionName);
    expect(found).toBeDefined();
    expect(found.executor).toBe("test-exec");

    // Connect via WebSocket — data flows through the executor's terminal channel
    const term = await connectTerminal(server.wsUrl, sessionName);
    await term.waitFor(/\$/, 15000);

    // Send a command
    term.ws.send("echo remote-e2e\r");
    await term.waitFor(/remote-e2e/, 10000);

    // Snapshot
    const snapshot = await api(server.baseUrl).sessions.snapshot(sessionName);
    expect(snapshot.text).toContain("remote-e2e");

    // Clean up
    term.close();
    await api(server.baseUrl).sessions.delete(sessionName);
  });
});
