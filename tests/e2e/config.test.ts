import { startServer, api, type ServerHandle } from "./helpers";

describe("Config persistence", () => {
  let server: ServerHandle;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startServer();
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    server.cleanup();
  });

  it("GET config returns empty object initially", async () => {
    const config = await api(baseUrl).config.get();
    expect(config).toEqual({});
  });

  it("PUT { theme: 'dark', fontSize: '14' } returns both keys", async () => {
    const config = await api(baseUrl).config.put({ theme: "dark", fontSize: "14" });
    expect(config).toMatchObject({ theme: "dark", fontSize: "14" });
  });

  it("GET config returns { theme: 'dark', fontSize: '14' }", async () => {
    const config = await api(baseUrl).config.get();
    expect(config).toEqual({ theme: "dark", fontSize: "14" });
  });

  it("PUT { theme: 'light' } updates theme", async () => {
    const config = await api(baseUrl).config.put({ theme: "light" });
    expect(config).toMatchObject({ theme: "light" });
  });

  it("GET config returns { theme: 'light', fontSize: '14' } with fontSize preserved", async () => {
    const config = await api(baseUrl).config.get();
    expect(config).toEqual({ theme: "light", fontSize: "14" });
  });
});
