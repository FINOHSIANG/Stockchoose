import { describe, expect, it } from "vitest";
import { resolveInitialAgentDockExpanded } from "./agentDockState";

describe("resolveInitialAgentDockExpanded", () => {
  it("keeps a saved expanded or collapsed preference", () => {
    expect(resolveInitialAgentDockExpanded("true", true)).toBe(true);
    expect(resolveInitialAgentDockExpanded("false", false)).toBe(false);
  });

  it("defaults to expanded on desktop and collapsed on mobile", () => {
    expect(resolveInitialAgentDockExpanded(null, false)).toBe(true);
    expect(resolveInitialAgentDockExpanded(null, true)).toBe(false);
  });
});
