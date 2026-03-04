/**
 * Plugin runtime singleton.
 * Stores the PluginRuntime provided by api.runtime during register().
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setZendeskRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getZendeskRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Zendesk runtime not initialized – plugin not yet registered");
  }
  return runtime;
}
