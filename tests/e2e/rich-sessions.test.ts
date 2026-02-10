import { startServer, api, connectRich, type ServerHandle } from "./helpers";

let server: ServerHandle;

beforeAll(async () => {
  server = await startServer();
}, 60000);

afterAll(() => {
  server.cleanup();
});

describe("Rich session lifecycle", () => {
  let sessionName: string;

  it("creates a rich session, sends a prompt, and receives a response", async () => {
    // Create a rich session
    const createRes = await api(server.baseUrl).sessions.create({ mode: "rich" });
    expect(createRes.status).toBe(201);
    const session = await createRes.json();
    sessionName = session.name;
    expect(session.mode).toBe("rich");

    // List sessions and verify it appears
    const sessions = await api(server.baseUrl).sessions.list();
    const found = sessions.find((s: any) => s.name === sessionName);
    expect(found).toBeDefined();
    expect(found.mode).toBe("rich");

    // Connect via WebSocket
    const rich = await connectRich(server.wsUrl, sessionName);

    // Wait for session_state indicating process is alive
    await rich.waitForEvent(
      (e) => e.type === "session_state",
      15000,
    );

    // Send a simple prompt
    rich.sendPrompt("What is 2+2? Reply with just the number, nothing else.");

    // Wait for the turn to complete (claude needs time to start and respond)
    await rich.waitForTurnComplete(60000);

    // Verify we received at least one assistant event
    const assistantEvents = rich.events.filter(
      (e) => e.type === "event" && e.event?.type === "assistant",
    );
    expect(assistantEvents.length).toBeGreaterThan(0);

    // Clean up
    rich.close();
    await api(server.baseUrl).sessions.delete(sessionName);
  });
});

describe("Rich session reconnect and replay", () => {
  let sessionName: string;

  it("replays events on reconnect", async () => {
    // Create a rich session
    const createRes = await api(server.baseUrl).sessions.create({ mode: "rich" });
    const session = await createRes.json();
    sessionName = session.name;

    // First connection: send a prompt and wait for completion
    const rich1 = await connectRich(server.wsUrl, sessionName);
    await rich1.waitForEvent((e) => e.type === "session_state", 15000);
    rich1.sendPrompt("What is 3+3? Reply with just the number, nothing else.");
    await rich1.waitForTurnComplete(60000);

    const firstEventCount = rich1.events.length;
    expect(firstEventCount).toBeGreaterThan(0);

    // Disconnect
    rich1.close();
    await new Promise((r) => setTimeout(r, 1000));

    // Reconnect
    const rich2 = await connectRich(server.wsUrl, sessionName);

    // Wait a moment for replay to happen
    await new Promise((r) => setTimeout(r, 2000));

    // Should have replayed events from the first connection
    // At minimum we should see event messages (user, assistant, result, etc.)
    const replayedEvents = rich2.events.filter(
      (e) => e.type === "event" && (e.event?.type === "user" || e.event?.type === "assistant" || e.event?.type === "result"),
    );
    expect(replayedEvents.length).toBeGreaterThan(0);

    // Clean up
    rich2.close();
    await api(server.baseUrl).sessions.delete(sessionName);
  });
});
