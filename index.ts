/**
 * OpenClaw Zendesk plugin entry point.
 *
 * Registers the Zendesk channel with the OpenClaw plugin API.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { createZendeskPlugin } from "./src/channel.js";
import { setZendeskRuntime } from "./src/runtime.js";

const plugin = {
  id: "zendesk",
  name: "Zendesk",
  description:
    "Zendesk Support channel plugin – receive tickets and reply with your OpenClaw AI agent",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setZendeskRuntime(api.runtime);
    api.registerChannel({ plugin: createZendeskPlugin() });
  },
};

export default plugin;
