import { json } from "../http.js";

export default async function status(req, res, context) {
  const config = context.config;
  return json(res, 200, {
    version: context.version,
    model: config.model,
    model_ready: Boolean(config.responsesUrl && config.apiKey && config.model),
    workdir: config.workdir || process.cwd(),
    browser_connected: Boolean(context.browser?.connected()),
  });
}
