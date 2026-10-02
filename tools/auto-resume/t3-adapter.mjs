#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export const VERIFIED_VERSION = "0.0.44-nightly.20260929.2456";
const MODES = ["approval-required", "auto-accept-edits", "auto", "full-access"];
const DRIVER = { codex: "codex", claude: "claudeAgent" };
const TIMEOUT = 8000;

class AdapterError extends Error {
  constructor(reason, message, notSent = true) {
    super(message);
    this.reason = reason;
    this.notSent = notSent;
  }
}

function requireValue(ok, reason, message) {
  if (!ok) throw new AdapterError(reason, message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

const digest = value => createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
const text = value => typeof value === "string" && value.trim().length > 0;

export async function loadConfig(path) {
  requireValue(isAbsolute(path || ""), "configuration", "Use an absolute --config path.");
  let config;
  try { config = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new AdapterError("configuration", "Cannot read the T3 adapter JSON config."); }
  requireValue(config.protocol_version === VERIFIED_VERSION, "unsupported-version",
    `This experimental adapter only supports T3 ${VERIFIED_VERSION}.`);
  let url;
  try { url = new URL(config.endpoint); }
  catch { throw new AdapterError("configuration", "Configure the exact T3 endpoint URL."); }
  requireValue(["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash, "configuration", "Use a T3 origin without credentials or a path.");
  requireValue(url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "configuration", "Plain HTTP is allowed only for a loopback T3 server.");
  requireValue(text(config.environment_id) && isAbsolute(config.token_file || ""), "configuration",
    "Configure environment_id and an absolute token_file path.");
  requireValue(config.provider_instances && typeof config.provider_instances === "object" &&
    Object.entries(config.provider_instances).every(([provider, instance]) => DRIVER[provider] && text(instance)),
    "configuration", "Map each usage provider to its exact T3 provider instance.");
  return { ...config, endpoint: url.origin };
}

async function readToken(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= 16384 && (stat.mode & 0o077) === 0 &&
      (typeof process.getuid !== "function" || stat.uid === process.getuid()),
      "credential", "The token file must be a private regular file owned by this user, mode 0600.");
    const token = (await file.readFile("utf8")).trim();
    requireValue(text(token) && !/[\s\x00-\x1f\x7f]/.test(token), "credential", "The token file must contain only a bearer token.");
    return token;
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("credential", "Cannot read the private T3 bearer token file.");
  } finally { await file?.close(); }
}

async function request(config, token, path, body) {
  let response;
  try {
    response = await fetch(`${config.endpoint}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT), redirect: "error",
    });
  } catch { throw new AdapterError("transport", "T3 HTTP request failed or timed out.", body === undefined); }
  if (!response.ok) throw new AdapterError("http-error", `T3 HTTP request returned ${response.status}.`, body === undefined);
  try {
    const bytes = await response.text();
    requireValue(bytes.length <= 20_000_000, "protocol", "T3 response exceeded the supported size.");
    return JSON.parse(bytes);
  } catch (error) {
    if (body !== undefined) throw new AdapterError("dispatch-uncertain", "T3 dispatch acknowledgement was invalid; inspect the thread before retrying.", false);
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("protocol", "T3 returned an invalid JSON snapshot.");
  }
}

async function serverConfig(config, token) {
  const session = await request(config, token, "/api/auth/session");
  requireValue(session.authenticated === true && Array.isArray(session.scopes) &&
    session.scopes.includes("orchestration:read"), "authentication", "The T3 credential is invalid or cannot read threads.");
  const url = new URL(`${config.endpoint}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const result = await new Promise((accept, reject) => {
    let socket;
    const timer = setTimeout(() => finish(new AdapterError("transport", "T3 config RPC timed out.")), TIMEOUT);
    function finish(error, value) {
      clearTimeout(timer);
      if (socket) { socket.onclose = null; socket.onerror = null; socket.close(); }
      error ? reject(error) : accept(value);
    }
    try { socket = new WebSocket(url.href, { headers: { authorization: `Bearer ${token}` } }); }
    catch { finish(new AdapterError("transport", "Cannot open the authenticated T3 socket.")); return; }
    socket.onopen = () => socket.send(JSON.stringify({ _tag: "Request", id: "1", tag: "server.getConfig", payload: {}, headers: [] }));
    socket.onerror = () => finish(new AdapterError("transport", "T3 config socket failed."));
    socket.onclose = () => finish(new AdapterError("transport", "T3 config socket closed before its reply."));
    socket.onmessage = event => {
      let frames;
      try { const decoded = JSON.parse(event.data); frames = Array.isArray(decoded) ? decoded : [decoded]; }
      catch { finish(new AdapterError("protocol", "Invalid T3 RPC frame.")); return; }
      for (const frame of frames) {
        if (frame._tag === "Ping") { socket.send(JSON.stringify({ _tag: "Pong" })); continue; }
        if (frame._tag === "Exit" && frame.requestId === "1") {
          if (frame.exit?._tag === "Success") finish(null, frame.exit.value);
          else finish(new AdapterError("protocol", "T3 rejected the server config RPC."));
          return;
        }
      }
    };
  });
  requireValue(result?.environment?.environmentId === config.environment_id, "wrong-environment", "T3 environment does not match the configured environment_id.");
  requireValue(result.environment.serverVersion === VERIFIED_VERSION, "unsupported-version", "The running T3 server version does not match the verified protocol.");
  requireValue(Array.isArray(result.providers), "protocol", "T3 config has no provider registry.");
  return { server: result, scopes: session.scopes };
}

function classify(thread, shell) {
  if (thread.deletedAt != null || thread.archivedAt != null) return ["cancelled", "archived-or-deleted"];
  if (shell.hasPendingApprovals || shell.hasPendingUserInput || shell.hasActionableProposedPlan) return ["blocked", "human-input"];
  if (thread.snoozedUntil != null) return ["blocked", "snoozed"];
  if (shell.backgroundLiveness != null || ["starting", "running"].includes(thread.session?.status) ||
    thread.session?.activeTurnId != null || thread.latestTurn?.state === "running" ||
    thread.messages.some(message => message.streaming === true)) return ["running", "work-in-progress"];
  if (thread.settledOverride === "settled" || thread.settledAt != null || thread.latestTurn?.state === "completed") return ["completed", "completed-or-settled"];
  if (["interrupted", "stopped"].includes(thread.session?.status) || thread.latestTurn?.state === "interrupted") return ["cancelled", "interrupted-or-stopped"];
  const latestUser = [...thread.messages].reverse().find(message => message.role === "user");
  if (latestUser?.turnId === null && thread.session?.status !== "error") return ["running", "queued-user-message"];
  if (thread.session && !["idle", "ready", "error"].includes(thread.session.status)) return ["blocked", "unknown-session-status"];
  if (thread.latestTurn && !["error", "completed", "interrupted", "running"].includes(thread.latestTurn.state)) return ["blocked", "unknown-turn-status"];
  return ["idle", "idle"];
}

async function snapshot(config, token, server, threadId, environment) {
  const detail = await request(config, token, `/api/orchestration/threads/${encodeURIComponent(threadId)}`);
  const index = await request(config, token, "/api/orchestration/shell");
  const thread = detail?.thread;
  requireValue(thread?.id === threadId && Array.isArray(thread.messages) && Array.isArray(thread.activities) &&
    text(thread.updatedAt) && MODES.includes(thread.runtimeMode) && ["default", "plan"].includes(thread.interactionMode) &&
    ["session", "latestTurn", "deletedAt", "archivedAt", "settledAt", "settledOverride"].every(key => Object.hasOwn(thread, key)),
    "protocol", "T3 thread snapshot is missing required identity or safety fields.");
  requireValue(Array.isArray(index?.threads) && Array.isArray(index?.projects), "protocol", "T3 shell snapshot is invalid.");
  const shell = index.threads.find(value => value.id === threadId);
  requireValue(shell && ["hasPendingApprovals", "hasPendingUserInput", "hasActionableProposedPlan"].every(key => typeof shell[key] === "boolean"),
    "protocol", "T3 shell snapshot is missing required human-input flags.");
  const shared = ["projectId", "modelSelection", "runtimeMode", "interactionMode", "worktreePath", "latestTurn", "session", "updatedAt", "archivedAt", "settledOverride", "settledAt"];
  requireValue(shared.every(key => digest(shell[key]) === digest(thread[key])), "changed", "T3 thread changed during inspection.");
  const project = index.projects.find(value => value.id === thread.projectId);
  requireValue(project && isAbsolute(thread.worktreePath || project.workspaceRoot || ""), "protocol", "Cannot resolve the exact T3 thread workspace.");
  const cwd = resolve(thread.worktreePath || project.workspaceRoot);
  requireValue(!environment.AUTO_RESUME_CWD || cwd === resolve(environment.AUTO_RESUME_CWD), "wrong-workspace", "T3 workspace does not match the armed working directory.");
  const instance = thread.modelSelection?.instanceId;
  requireValue(text(instance) && text(thread.modelSelection?.model), "protocol", "T3 model selection has no exact provider instance or model.");
  const provider = environment.AUTO_RESUME_PROVIDER || Object.keys(config.provider_instances).find(key => config.provider_instances[key] === instance);
  requireValue(DRIVER[provider] && config.provider_instances[provider] === instance, "wrong-provider", "T3 provider instance does not match the armed usage provider.");
  const registered = server.providers.find(value => value.instanceId === instance);
  requireValue(registered?.driver === DRIVER[provider] && registered.enabled === true,
    "wrong-provider", "The configured T3 provider instance is missing, disabled, or uses another driver.");
  requireValue(!thread.session?.providerInstanceId || thread.session.providerInstanceId === instance,
    "wrong-provider", "The T3 session is owned by another provider instance.");
  const [status, reason] = classify(thread, shell);
  const revision = digest({ environment_id: config.environment_id, thread, cwd,
    human_input: [shell.hasPendingApprovals, shell.hasPendingUserInput, shell.hasActionableProposedPlan],
    background_liveness: shell.backgroundLiveness ?? null, provider_home: registered.runtimePaths?.homePath ?? null });
  const supported = config.experimental_non_atomic_resume === true && config.usage_account_matches_t3 === true;
  return { thread, output: { status, revision, reason, thread_id: threadId, environment_id: config.environment_id,
    cwd, provider, provider_instance: instance, model_selection: thread.modelSelection,
    runtime_mode: thread.runtimeMode, interaction_mode: thread.interactionMode,
    resume_supported: supported, atomic_revision_guard: false,
    resume_limitation: supported ? "Thread changes after the final check cannot be rejected atomically by T3." :
      "Enable experimental_non_atomic_resume and declare usage_account_matches_t3 to permit experimental continuation." } };
}

export async function runAdapter(config, command, threadId, prompt, environment = process.env) {
  requireValue(["inspect", "resume"].includes(command) && text(threadId) && threadId.length <= 512 && !/[\x00-\x1f\x7f]/.test(threadId), "arguments", "Use inspect <thread-id> or resume <thread-id> <prompt>.");
  if (command === "resume") {
    requireValue(config.experimental_non_atomic_resume === true && config.usage_account_matches_t3 === true,
      "experimental-disabled", "T3 automatic continuation needs explicit experimental_non_atomic_resume and usage_account_matches_t3 settings.");
    requireValue(text(environment.AUTO_RESUME_EXPECTED_REVISION) && text(environment.AUTO_RESUME_JOB_ID) &&
      text(environment.AUTO_RESUME_PROVIDER) && text(environment.AUTO_RESUME_CWD) && text(prompt),
      "missing-guard", "Resume needs the armed revision, job ID, provider, working directory, and prompt.");
  }
  const token = await readToken(config.token_file);
  const { server, scopes } = await serverConfig(config, token);
  const initial = await snapshot(config, token, server, threadId, environment);
  if (command === "inspect") return { ...initial.output,
    resume_supported: initial.output.resume_supported && scopes.includes("orchestration:operate") };
  requireValue(scopes.includes("orchestration:operate"), "authorization", "T3 credential cannot operate threads.");
  const identity = { environment_id: config.environment_id, threadId, job: environment.AUTO_RESUME_JOB_ID,
    revision: environment.AUTO_RESUME_EXPECTED_REVISION, prompt };
  const commandId = `auto-resume-${digest(identity)}`;
  const messageId = `auto-resume-message-${digest(identity)}`;
  if (initial.thread.messages.some(message => message.id === messageId && message.role === "user" && message.text === prompt)) {
    return { accepted: true, duplicate: true, command_id: commandId, not_sent: true };
  }
  requireValue(initial.output.status === "idle", initial.output.reason, `T3 thread is ${initial.output.status}; no continuation was sent.`);
  requireValue(initial.output.revision === environment.AUTO_RESUME_EXPECTED_REVISION, "changed", "T3 thread changed since arming; no continuation was sent.");
  const final = await snapshot(config, token, server, threadId, environment);
  requireValue(final.output.status === "idle" && final.output.revision === initial.output.revision,
    "changed", "T3 thread changed before dispatch; no continuation was sent.");
  const result = await request(config, token, "/api/orchestration/dispatch", {
    type: "thread.turn.start", commandId, threadId,
    message: { messageId, role: "user", text: prompt, attachments: [] },
    modelSelection: final.thread.modelSelection, runtimeMode: final.thread.runtimeMode,
    interactionMode: final.thread.interactionMode, createdAt: new Date().toISOString(),
  });
  if (!Number.isSafeInteger(result?.sequence) || result.sequence < 0) {
    throw new AdapterError("dispatch-uncertain", "T3 dispatch acknowledgement was invalid; inspect the thread before retrying.", false);
  }
  return { accepted: true, command_id: commandId, message_id: messageId, sequence: result.sequence, atomic_revision_guard: false };
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  let path = environment.AUTO_RESUME_T3_CONFIG;
  if (argv[0] === "--config") { path = argv[1]; argv = argv.slice(2); }
  const [command, threadId, prompt] = argv;
  try {
    requireValue(argv.length === (command === "resume" ? 3 : 2), "arguments", "Use --config <file> inspect <thread-id> or resume <thread-id> <prompt>.");
    return await runAdapter(await loadConfig(path), command, threadId, prompt, environment);
  } catch (error) {
    const safe = error instanceof AdapterError ? error : new AdapterError("adapter-error", "T3 adapter failed before a verified acknowledgement.", command !== "resume");
    return { ...(command === "resume" ? { accepted: false } : { status: "blocked", revision: "" }),
      reason: safe.reason, message: safe.message, retryable: false, not_sent: safe.notSent };
  }
}

if (import.meta.main) {
  const result = await main();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.accepted === false || result.revision === "") process.exitCode = 1;
}
