import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, VERIFIED_VERSION } from "../t3-adapter.mjs";

const fixtures = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.server.stop(true);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "t3-adapter-test-"));
  const token = "fixture-private-token";
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  const thread = {
    id: "exact-thread", projectId: "project", title: "Private title",
    modelSelection: { instanceId: "exact-codex", model: "gpt-6.1", options: { reasoningEffort: "high" } },
    runtimeMode: "approval-required", interactionMode: "plan", worktreePath: "/test/worktree",
    latestTurn: { turnId: "failed-turn", state: "error", requestedAt: "2026-10-01T12:00:00Z" },
    session: { threadId: "exact-thread", providerName: "codex", providerInstanceId: "exact-codex",
      status: "error", activeTurnId: null, lastError: "Usage limit reached", updatedAt: "2026-10-01T12:00:00Z" },
    updatedAt: "2026-10-01T12:00:00Z", archivedAt: null, settledAt: null, settledOverride: null, deletedAt: null,
    messages: [{ id: "old-user", role: "user", text: "Private conversation", turnId: "failed-turn", streaming: false }],
    activities: [],
  };
  const state = { thread, flags: { hasPendingApprovals: false, hasPendingUserInput: false,
    hasActionableProposedPlan: false, backgroundLiveness: null }, reads: 0, posts: [],
    requests: [], socketRequests: [], badAuth: 0, scopes: ["orchestration:read", "orchestration:operate"],
    environmentId: "exact-environment", version: VERIFIED_VERSION, ...options };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request, server) {
      const path = new URL(request.url).pathname;
      state.requests.push({ path, method: request.method });
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        state.badAuth++;
        return Response.json({ message: token }, { status: 401 });
      }
      if (path === "/ws") {
        if (server.upgrade(request)) return;
        return new Response("bad upgrade", { status: 400 });
      }
      if (state.httpFailure?.path === path) return Response.json({ message: token }, { status: state.httpFailure.status });
      if (path === "/api/auth/session") return Response.json({ authenticated: state.authenticated ?? true, scopes: state.scopes });
      if (path === "/api/orchestration/threads/exact-thread") {
        state.reads++;
        state.beforeRead?.(state);
        return Response.json({ snapshotSequence: state.reads, thread: state.thread });
      }
      if (path === "/api/orchestration/shell") {
        state.beforeShell?.(state);
        const shell = { ...state.thread, ...state.flags };
        delete shell.messages;
        delete shell.activities;
        return Response.json({ threads: [shell], projects: [{ id: "project", workspaceRoot: "/test/project" }] });
      }
      if (path === "/api/orchestration/dispatch") {
        const body = await request.json();
        state.posts.push(body);
        if (state.invalidDispatch) return Response.json({ message: token });
        const existing = state.posts.slice(0, -1).find(post => post.commandId === body.commandId);
        if (!existing) state.thread.messages.push({ id: body.message.messageId, role: "user", text: body.message.text,
          turnId: "resumed-turn", streaming: false });
        return Response.json({ sequence: 123 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      message(socket, bytes) {
        const request = JSON.parse(String(bytes));
        state.socketRequests.push(request);
        expect(request).toEqual({ _tag: "Request", id: "1", tag: "server.getConfig", payload: {}, headers: [] });
        socket.send(JSON.stringify({ _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: {
          environment: { environmentId: state.environmentId, serverVersion: state.version },
          providers: [{ instanceId: "exact-codex", driver: "codex", enabled: true,
            runtimePaths: { homePath: "/test/provider-home" } }],
        } } }));
      },
    },
  });
  const config = { protocol_version: VERIFIED_VERSION, endpoint: `http://127.0.0.1:${server.port}`,
    environment_id: "exact-environment", token_file: tokenFile, provider_instances: { codex: "exact-codex" },
    experimental_non_atomic_resume: true, usage_account_matches_t3: true };
  const configFile = join(directory, "config.json");
  const saveConfig = () => writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await saveConfig();
  const environment = { AUTO_RESUME_PROVIDER: "codex", AUTO_RESUME_CWD: "/test/worktree" };
  const inspect = () => main(["--config", configFile, "inspect", "exact-thread"], environment);
  const resume = (revision, extra = {}) => main(["--config", configFile, "resume", "exact-thread", "Continue the authorized work."],
    { ...environment, AUTO_RESUME_EXPECTED_REVISION: revision, AUTO_RESUME_JOB_ID: "stable-job", ...extra });
  const result = { directory, server, state, config, configFile, tokenFile, saveConfig, inspect, resume };
  fixtures.push(result);
  return result;
}

test("inspect uses bearer-authenticated HTTP and config RPC without conversation output or dispatch", async () => {
  const f = await fixture();
  const result = await f.inspect();
  expect(result.status).toBe("idle");
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(result).toMatchObject({ cwd: "/test/worktree", provider_instance: "exact-codex", resume_supported: true,
    atomic_revision_guard: false, runtime_mode: "approval-required", interaction_mode: "plan" });
  expect(JSON.stringify(result)).not.toContain("Private conversation");
  expect(JSON.stringify(result)).not.toContain("fixture-private-token");
  expect(f.state.badAuth).toBe(0);
  expect(f.state.posts).toEqual([]);
  expect(f.state.socketRequests).toHaveLength(1);
  expect((await f.inspect()).revision).toBe(result.revision);
});

test("dispatch preserves exact thread, model options, and permission modes and rechecks immediately", async () => {
  const f = await fixture();
  const armed = await f.inspect();
  const result = await f.resume(armed.revision);
  expect(result.accepted).toBe(true);
  expect(f.state.reads).toBe(3);
  expect(f.state.posts).toHaveLength(1);
  const post = f.state.posts[0];
  expect(post).toMatchObject({ type: "thread.turn.start", threadId: "exact-thread", runtimeMode: "approval-required",
    interactionMode: "plan", modelSelection: f.state.thread.modelSelection,
    message: { role: "user", text: "Continue the authorized work.", attachments: [] } });
  expect(post.commandId).toMatch(/^auto-resume-[a-f0-9]{64}$/);
  expect(post.message.messageId).toBe(result.message_id);
  expect(post.bootstrap).toBeUndefined();
  expect((await f.resume(armed.revision))).toMatchObject({ accepted: true, duplicate: true, command_id: result.command_id });
  expect(f.state.posts).toHaveLength(1);
});

test.each([
  ["running", thread => { thread.session.status = "running"; }],
  ["running", thread => { thread.session.activeTurnId = "active"; }],
  ["running", thread => { thread.messages[0].streaming = true; }],
  ["completed", thread => { thread.latestTurn.state = "completed"; }],
  ["completed", thread => { thread.settledOverride = "settled"; }],
  ["cancelled", thread => { thread.archivedAt = "2026-10-01T13:00:00Z"; }],
  ["cancelled", thread => { thread.session.status = "stopped"; }],
  ["cancelled", thread => { thread.latestTurn.state = "interrupted"; }],
  ["blocked", thread => { thread.snoozedUntil = "2026-10-03T13:00:00Z"; }],
])("%s threads receive no continuation", async (status, change) => {
  const f = await fixture();
  change(f.state.thread);
  const armed = await f.inspect();
  expect(armed.status).toBe(status);
  expect((await f.resume(armed.revision))).toMatchObject({ accepted: false, not_sent: true });
  expect(f.state.posts).toEqual([]);
});

test.each(["hasPendingApprovals", "hasPendingUserInput", "hasActionableProposedPlan"])("%s blocks continuation", async flag => {
  const f = await fixture();
  f.state.flags[flag] = true;
  const armed = await f.inspect();
  expect(armed.status).toBe("blocked");
  expect((await f.resume(armed.revision))).toMatchObject({ accepted: false, not_sent: true });
  expect(f.state.posts).toEqual([]);
});

test("changed thread after arming or during final inspection receives no POST", async () => {
  const f = await fixture();
  const armed = await f.inspect();
  f.state.thread.modelSelection.options.reasoningEffort = "low";
  expect((await f.resume(armed.revision))).toMatchObject({ accepted: false, reason: "changed", not_sent: true });
  const rearmed = await f.inspect();
  const finalRead = f.state.reads + 2;
  f.state.beforeRead = state => { if (state.reads === finalRead) state.flags.hasPendingUserInput = true; };
  expect((await f.resume(rearmed.revision))).toMatchObject({ accepted: false, reason: "changed", not_sent: true });
  expect(f.state.posts).toEqual([]);
});

test("inconsistent shell and detail snapshots fail closed", async () => {
  const f = await fixture({ beforeShell: state => { state.thread.updatedAt = "2026-10-02T12:00:00Z"; } });
  expect(await f.inspect()).toMatchObject({ status: "blocked", reason: "changed" });
  expect(f.state.posts).toEqual([]);
});

test("optional missing fields work while missing human-input flags fail closed", async () => {
  const f = await fixture();
  const initial = await f.inspect();
  delete f.state.flags.backgroundLiveness;
  expect(await f.inspect()).toMatchObject({ status: "idle", revision: initial.revision });
  delete f.state.flags.hasPendingUserInput;
  expect(await f.inspect()).toMatchObject({ status: "blocked", reason: "protocol" });
  expect(f.state.posts).toEqual([]);
});

test.each(["experimental_non_atomic_resume", "usage_account_matches_t3"])("%s is required for automatic dispatch", async field => {
  const f = await fixture();
  f.config[field] = false;
  await f.saveConfig();
  const armed = await f.inspect();
  expect(armed.resume_supported).toBe(false);
  expect(await f.resume(armed.revision)).toMatchObject({ accepted: false, reason: "experimental-disabled", not_sent: true });
  expect(f.state.posts).toEqual([]);
});

test("missing guard, wrong provider, and wrong workspace fail before dispatch", async () => {
  const f = await fixture();
  const armed = await f.inspect();
  expect(await f.resume(armed.revision, { AUTO_RESUME_JOB_ID: "" })).toMatchObject({ accepted: false, reason: "missing-guard" });
  expect(await f.resume(armed.revision, { AUTO_RESUME_PROVIDER: "claude" })).toMatchObject({ accepted: false, reason: "wrong-provider" });
  expect(await f.resume(armed.revision, { AUTO_RESUME_CWD: "/another/workspace" })).toMatchObject({ accepted: false, reason: "wrong-workspace" });
  expect(f.state.posts).toEqual([]);
});

test.each([["environmentId", "another-environment", "wrong-environment"], ["version", "new-nightly", "unsupported-version"]])("rejects mismatched server %s", async (field, value, reason) => {
  const f = await fixture();
  f.state[field] = value;
  expect(await f.inspect()).toMatchObject({ status: "blocked", reason });
  expect(f.state.reads).toBe(0);
});

test("auth errors and read-only scopes cannot permit automatic dispatch or disclose credentials", async () => {
  const f = await fixture({ authenticated: false });
  const error = await f.inspect();
  expect(error.reason).toBe("authentication");
  expect(JSON.stringify(error)).not.toContain("fixture-private-token");
  f.state.authenticated = true;
  f.state.scopes = ["orchestration:read"];
  const armed = await f.inspect();
  expect(armed.resume_supported).toBe(false);
  expect(await f.resume(armed.revision)).toMatchObject({ accepted: false, reason: "authorization", not_sent: true });
  expect(f.state.posts).toEqual([]);
});

test("credentials must be private regular files and cannot be symlinks", async () => {
  const f = await fixture();
  await chmod(f.tokenFile, 0o644);
  expect(await f.inspect()).toMatchObject({ reason: "credential" });
  await chmod(f.tokenFile, 0o600);
  f.config.token_file = join(f.directory, "token-link");
  await symlink(f.tokenFile, f.config.token_file);
  await f.saveConfig();
  expect(await f.inspect()).toMatchObject({ reason: "credential" });
  expect(f.state.requests).toEqual([]);
});

test("a dispatch with an invalid acknowledgement remains uncertain and cannot trigger an automatic retry", async () => {
  const f = await fixture({ invalidDispatch: true });
  const armed = await f.inspect();
  expect(await f.resume(armed.revision)).toMatchObject({ accepted: false, reason: "dispatch-uncertain", not_sent: false, retryable: false });
  expect(f.state.posts).toHaveLength(1);
});

test("HTTP server errors are sanitized and cannot dispatch", async () => {
  const f = await fixture({ httpFailure: { path: "/api/orchestration/shell", status: 500 } });
  const result = await f.inspect();
  expect(result.reason).toBe("http-error");
  expect(JSON.stringify(result)).not.toContain("fixture-private-token");
  expect(f.state.posts).toEqual([]);
});
