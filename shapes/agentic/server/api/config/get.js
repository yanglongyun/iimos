import { json } from "../http.js";

export default async function get(req, res, context) {
  const config = context.config;
  let keyHint = "";
  if (config.apiKey) {
    if (config.apiKey.length <= 10) {
      keyHint = "***";
    } else {
      keyHint = config.apiKey.slice(0, 6) + "..." + config.apiKey.slice(-4);
    }
  }

  const view = {
    responsesUrl: config.responsesUrl,
    key_set: Boolean(config.apiKey),
    key_hint: keyHint,
    model: config.model,
    context_window: config.context_window,
    system: config.system,
    compact_at: config.compact_at,
    keep: config.keep,
    compact_system: config.compact_system,
    compact_prefix: config.compact_prefix,
    workdir: config.workdir,
    run_timeout: config.run_timeout,
    timeout: config.timeout,
    max_output: config.max_output,
    paths: {
      data_dir: context.paths.root,
      config: context.paths.config,
    },
  };
  return json(res, 200, view);
}
