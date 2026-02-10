import { startServer, api, connectTerminal, type ServerHandle } from "./helpers";

let server: ServerHandle;

beforeAll(async () => {
  server = await startServer();
}, 60000);

afterAll(() => {
  server.cleanup();
});

describe("Session lifecycle", () => {
  let sessionName: string;

  it("creates a terminal session, interacts with it, snapshots, and deletes it", async () => {
    // Create a session
    const createRes = await api(server.baseUrl).sessions.create({ command: "bash" });
    expect(createRes.ok).toBe(true);
    const session = await createRes.json();
    sessionName = session.name;
    expect(sessionName).toBeTruthy();

    // List sessions and verify it appears
    const sessions = await api(server.baseUrl).sessions.list();
    const found = sessions.find((s: any) => s.name === sessionName);
    expect(found).toBeDefined();

    // Connect via WebSocket and wait for shell prompt
    const term = await connectTerminal(server.wsUrl, sessionName);
    await term.waitFor(/\$/, 15000);

    // Send a command and wait for output
    term.ws.send("echo hello-e2e\r");
    await term.waitFor(/hello-e2e/, 10000);

    // Get snapshot and verify content
    const snapshot = await api(server.baseUrl).sessions.snapshot(sessionName);
    expect(snapshot.text).toContain("hello-e2e");

    // Clean up terminal connection
    term.close();

    // Delete session and verify it's gone
    const deleteRes = await api(server.baseUrl).sessions.delete(sessionName);
    expect(deleteRes.ok).toBe(true);

    const sessionsAfter = await api(server.baseUrl).sessions.list();
    const gone = sessionsAfter.find((s: any) => s.name === sessionName);
    expect(gone).toBeUndefined();
  });
});

describe("Multiple WebSocket clients", () => {
  let sessionName: string;

  it("supports two clients on the same session", async () => {
    // Create a session
    const createRes = await api(server.baseUrl).sessions.create({ command: "bash" });
    const session = await createRes.json();
    sessionName = session.name;

    // Connect two clients
    const clientA = await connectTerminal(server.wsUrl, sessionName);
    const clientB = await connectTerminal(server.wsUrl, sessionName);

    // Wait for prompts on both
    await clientA.waitFor(/\$/, 15000);
    await clientB.waitFor(/\$/, 15000);

    // clientA sends a command
    clientA.ws.send("echo multi-test\r");

    // Both clients should see the output
    await clientA.waitFor(/multi-test/, 10000);
    await clientB.waitFor(/multi-test/, 10000);

    // Close clientA
    clientA.close();

    // clientB should still work
    clientB.ws.send("echo still-alive\r");
    await clientB.waitFor(/still-alive/, 10000);

    // Clean up
    clientB.close();
    await api(server.baseUrl).sessions.delete(sessionName);
  });
});

describe("Fork", () => {
  let originalName: string;
  let forkedName: string;

  it("forks a session and both exist with correct parent", async () => {
    // Create the original session
    const createRes = await api(server.baseUrl).sessions.create({ command: "bash" });
    const session = await createRes.json();
    originalName = session.name;

    // Fork it
    const forkRes = await api(server.baseUrl).sessions.fork(originalName);
    expect(forkRes.ok).toBe(true);
    const forked = await forkRes.json();
    forkedName = forked.name;
    expect(forkedName).toBeTruthy();
    expect(forkedName).not.toBe(originalName);

    // List sessions and verify both exist
    const sessions = await api(server.baseUrl).sessions.list();
    const origFound = sessions.find((s: any) => s.name === originalName);
    const forkFound = sessions.find((s: any) => s.name === forkedName);
    expect(origFound).toBeDefined();
    expect(forkFound).toBeDefined();

    // Verify the forked session has parent set to original
    expect(forkFound.parent).toBe(originalName);

    // Clean up both
    await api(server.baseUrl).sessions.delete(forkedName);
    await api(server.baseUrl).sessions.delete(originalName);
  });
});

describe("Reorder", () => {
  const sessionNames: string[] = [];

  it("reorders sessions to reversed order", async () => {
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      const res = await api(server.baseUrl).sessions.create({ command: "bash" });
      const session = await res.json();
      sessionNames.push(session.name);
    }

    expect(sessionNames).toHaveLength(3);

    // Reverse the order
    const reversed = [...sessionNames].reverse();
    const reorderRes = await api(server.baseUrl).sessions.reorder(reversed);
    expect(reorderRes.ok).toBe(true);

    // List and verify positions match reversed order
    const sessions = await api(server.baseUrl).sessions.list();
    const listedNames = sessions.map((s: any) => s.name);

    // The reversed names should appear in that order within the listed sessions
    for (let i = 0; i < reversed.length; i++) {
      const idx = listedNames.indexOf(reversed[i]);
      expect(idx).toBe(i);
    }

    // Clean up all 3
    for (const name of sessionNames) {
      await api(server.baseUrl).sessions.delete(name);
    }
  });
});

describe("Job creation", () => {
  let jobName: string;

  it("creates a job with a prompt and verifies job_prompt is set", async () => {
    // Create a job
    const createRes = await api(server.baseUrl).sessions.createJob({ prompt: "test job" });
    expect(createRes.ok).toBe(true);
    const job = await createRes.json();
    jobName = job.name;
    expect(jobName).toBeTruthy();

    // List sessions and find the job
    const sessions = await api(server.baseUrl).sessions.list();
    const found = sessions.find((s: any) => s.name === jobName);
    expect(found).toBeDefined();
    expect(found.job_prompt).toBe("test job");

    // Clean up
    await api(server.baseUrl).sessions.delete(jobName);
  });
});
