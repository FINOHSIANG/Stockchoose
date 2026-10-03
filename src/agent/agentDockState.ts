export const AGENT_DOCK_STORAGE_KEY = "stockchoose.agentDock.expanded.v1";

export function resolveInitialAgentDockExpanded(storedValue: string | null, isMobile: boolean) {
  if (storedValue === "true") return true;
  if (storedValue === "false") return false;
  return !isMobile;
}

export function readInitialAgentDockExpanded() {
  if (typeof window === "undefined") return true;
  const isMobile = window.matchMedia?.("(max-width: 767px)").matches ?? false;
  return resolveInitialAgentDockExpanded(window.localStorage.getItem(AGENT_DOCK_STORAGE_KEY), isMobile);
}

export function persistAgentDockExpanded(expanded: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AGENT_DOCK_STORAGE_KEY, String(expanded));
}
