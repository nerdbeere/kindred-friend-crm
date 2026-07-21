export interface KindredConfig {
  baseUrl: string;
  token: string;
}

/**
 * Loads configuration from the environment. Fails fast (throws) if either
 * required variable is missing so the process exits at startup with a clear
 * message rather than misbehaving later.
 *
 * The names match the ones already established in the Kindred repo's
 * skills/kindred/SKILL.md so agents/users see one consistent convention.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): KindredConfig {
  const baseUrl = (env.KINDRED_URL ?? "").trim().replace(/\/+$/, "");
  const token = (env.KINDRED_TOKEN ?? "").trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push("KINDRED_URL");
  if (!token) missing.push("KINDRED_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `kindred-mcp: missing required environment variable(s): ${missing.join(
        ", ",
      )}. Set KINDRED_URL to your Kindred base URL and KINDRED_TOKEN to the ` +
        "token printed by `npm run print:feed-token` on the Kindred instance.",
    );
  }

  // Basic sanity check so a typo'd KINDRED_URL fails loudly at startup.
  try {
    // eslint-disable-next-line no-new
    new URL(baseUrl);
  } catch {
    throw new Error(
      `kindred-mcp: KINDRED_URL is not a valid URL: "${baseUrl}".`,
    );
  }

  return { baseUrl, token };
}
