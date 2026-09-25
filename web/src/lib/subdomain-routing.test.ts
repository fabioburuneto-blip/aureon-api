import { describe, expect, it } from "vitest";
import { getSubdomainConfig, resolveSubdomainRedirect } from "./subdomain-routing";

describe("getSubdomainConfig", () => {
  it("returns null when nothing is configured", () => {
    expect(getSubdomainConfig({})).toBeNull();
  });

  it("returns null when only one host is configured", () => {
    expect(getSubdomainConfig({ appUrl: "https://app.example.com" })).toBeNull();
  });

  it("returns null when all configured URLs share the same host", () => {
    expect(
      getSubdomainConfig({
        appUrl: "https://example.com",
        marketingUrl: "https://example.com",
      }),
    ).toBeNull();
  });

  it("activates once two distinct hosts are configured", () => {
    const config = getSubdomainConfig({
      appUrl: "https://app.example.com",
      agendaUrl: "https://agenda.example.com",
    });
    expect(config).toEqual({
      appHost: "app.example.com",
      agendaHost: "agenda.example.com",
      marketingHost: null,
    });
  });

  it("ignores an unparseable URL instead of throwing", () => {
    expect(
      getSubdomainConfig({ appUrl: "not-a-url", agendaUrl: "https://agenda.example.com" }),
    ).toBeNull();
  });
});

describe("resolveSubdomainRedirect", () => {
  const config = {
    appHost: "app.example.com",
    agendaHost: "agenda.example.com",
    marketingHost: "www.example.com",
  };

  it("never redirects /api, regardless of host", () => {
    expect(resolveSubdomainRedirect("agenda.example.com", "/api/webhooks/billing/stripe", config)).toBeNull();
    expect(resolveSubdomainRedirect("app.example.com", "/api/whatever", config)).toBeNull();
  });

  it("leaves an unconfigured host alone (localhost, preview deployments)", () => {
    expect(resolveSubdomainRedirect("localhost:3000", "/dashboard", config)).toBeNull();
    expect(resolveSubdomainRedirect("preview-abc123.vercel.app", "/", config)).toBeNull();
  });

  describe("on the app host", () => {
    it("sends root to /dashboard", () => {
      expect(resolveSubdomainRedirect("app.example.com", "/", config)).toEqual({
        host: "app.example.com",
        pathname: "/dashboard",
      });
    });

    it("lets app routes through untouched", () => {
      expect(resolveSubdomainRedirect("app.example.com", "/dashboard/agenda", config)).toBeNull();
      expect(resolveSubdomainRedirect("app.example.com", "/login", config)).toBeNull();
    });

    it("sends a business slug to the agenda host", () => {
      expect(resolveSubdomainRedirect("app.example.com", "/barbearia-do-ze", config)).toEqual({
        host: "agenda.example.com",
        pathname: "/barbearia-do-ze",
      });
    });
  });

  describe("on the agenda host", () => {
    it("lets a business slug through untouched", () => {
      expect(resolveSubdomainRedirect("agenda.example.com", "/barbearia-do-ze", config)).toBeNull();
    });

    it("sends root to the marketing host", () => {
      expect(resolveSubdomainRedirect("agenda.example.com", "/", config)).toEqual({
        host: "www.example.com",
        pathname: "/",
      });
    });

    it("sends an app route to the app host", () => {
      expect(resolveSubdomainRedirect("agenda.example.com", "/login", config)).toEqual({
        host: "app.example.com",
        pathname: "/login",
      });
    });
  });

  describe("on the marketing host", () => {
    it("lets root through untouched", () => {
      expect(resolveSubdomainRedirect("www.example.com", "/", config)).toBeNull();
    });

    it("sends an app route to the app host", () => {
      expect(resolveSubdomainRedirect("www.example.com", "/onboarding", config)).toEqual({
        host: "app.example.com",
        pathname: "/onboarding",
      });
    });

    it("sends a business slug to the agenda host", () => {
      expect(resolveSubdomainRedirect("www.example.com", "/barbearia-do-ze", config)).toEqual({
        host: "agenda.example.com",
        pathname: "/barbearia-do-ze",
      });
    });
  });

  it("degrades gracefully when only app+agenda are configured (no marketing host)", () => {
    const partial = { appHost: "app.example.com", agendaHost: "agenda.example.com", marketingHost: null };
    expect(resolveSubdomainRedirect("agenda.example.com", "/", partial)).toBeNull();
  });
});
