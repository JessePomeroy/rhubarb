import assert from "node:assert/strict";
import test from "node:test";
import {
  Effect,
  Layer,
  ManagedRuntime,
  Queue,
  Stream,
  type Cause,
} from "effect";
import { BackendRegistry, type SubagentBackend } from "./src/backend.ts";
import type { ParentQuestion, SubagentEvent } from "./src/domain.ts";
import { SendError } from "./src/domain.ts";
import { SubagentManager, SubagentManagerLive } from "./src/manager.ts";
import {
  createParentChannel,
  parentQuestionTool,
} from "./src/parent-communication.ts";

test("parent replies are correlated; stale replies cannot answer the next question", async () => {
  let pending: ParentQuestion | undefined;
  const channel = createParentChannel((question) => {
    pending = question;
  });
  const tool = parentQuestionTool(channel);
  const first = tool.execute("one", { question: "Which file?" });
  const firstId = channel.pending?.id;
  assert.ok(firstId);
  assert.equal(pending?.id, firstId);
  channel.reply(firstId, "app.ts");
  assert.equal((await first).content[0].text, "app.ts");
  const next = tool.execute("two", { question: "Which function?" });
  assert.throws(() => channel.reply(firstId, "stale"), /no longer/);
  const secondId = channel.pending?.id;
  assert.ok(secondId);
  channel.reply(secondId, "render");
  assert.equal((await next).content[0].text, "render");
  channel.close();
});

test("cancellation and teardown release blocked questions without manufacturing an answer", async () => {
  const channel = createParentChannel(() => {});
  const signal = new AbortController();
  const first = channel.request("Continue?", signal.signal);
  signal.abort();
  await assert.rejects(first, /cancelled/);
  assert.equal(channel.pending, undefined);
  const second = channel.request("Still there?");
  channel.close();
  await assert.rejects(second, /closed/);
  await assert.rejects(channel.request("Again?"), /closed/);
});

function questionRuntime() {
  const questions: Array<() => Promise<string>> = [];
  const backend: SubagentBackend = {
    name: "pi",
    available: Effect.succeed(true),
    capabilities: {
      steering: true,
      modelSelection: true,
      reasoningEffort: true,
    },
    spawn: () =>
      Effect.gen(function* () {
        const events = yield* Queue.make<SubagentEvent, Cause.Done>();
        const emit = (event: SubagentEvent) => {
          Queue.offerUnsafe(events, event);
        };
        const channel = createParentChannel((question) =>
          emit({ _tag: "ParentQuestionChanged", question }),
        );
        questions.push(async () => {
          const reply = await channel.request(
            "Which behavior should I preserve?",
          );
          emit({
            _tag: "RunSettled",
            outcome: { _tag: "Completed", finalText: reply },
          });
          return reply;
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            channel.close();
            Queue.endUnsafe(events);
          }),
        );
        return {
          meta: Effect.succeed({ backend: "pi" as const }),
          events: Stream.fromQueue(events),
          send: (text, replyTo) =>
            Effect.try({
              try: () => {
                if (!replyTo) throw new Error("Reply id required");
                channel.reply(replyTo, text);
              },
              catch: (error) => new SendError({ message: String(error) }),
            }),
          interrupt: Effect.sync(() => {
            channel.close();
            emit({ _tag: "RunSettled", outcome: { _tag: "Interrupted" } });
          }),
        };
      }),
  };
  return {
    questions,
    runtime: ManagedRuntime.make(
      SubagentManagerLive.pipe(
        Layer.provide(
          Layer.succeed(BackendRegistry, new Map([["pi", backend]])),
        ),
      ),
    ),
  };
}

test("waiting parent is released for a child question even when another child is still running", async () => {
  const { runtime, questions } = questionRuntime();
  try {
    const manager = await runtime.runPromise(SubagentManager);
    const task = {
      prompt: "test",
      title: "worker",
      cwd: process.cwd(),
      parent: { parentCwd: process.cwd(), projectTrusted: false },
    };
    const a = await runtime.runPromise(manager.spawn("pi", task));
    const b = await runtime.runPromise(manager.spawn("pi", task));
    const notifications: boolean[] = [];
    manager.view.setOnQuestion((_snap, consumed) =>
      notifications.push(consumed),
    );
    let waiting!: () => void;
    const ready = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const wait = runtime.runPromise(manager.waitFor([a.id, b.id], waiting));
    await ready;
    const childAnswer = questions[0]();
    await wait;
    assert.deepEqual(notifications, [true]);
    const questionId = manager.view.get(a.id)?.pendingQuestion?.id;
    assert.ok(questionId);
    assert.equal(manager.view.get(b.id)?.status, "running");
    await runtime.runPromise(
      manager.send(a.id, "Preserve existing behavior", questionId),
    );
    assert.equal(await childAnswer, "Preserve existing behavior");
    await runtime.runPromise(manager.waitFor([a.id]));
    assert.equal(manager.view.get(a.id)?.status, "done");
    assert.equal(manager.view.get(a.id)?.pendingQuestion, undefined);
    await assert.rejects(
      runtime.runPromise(manager.send(a.id, "late reply", questionId)),
      /no longer/,
    );
  } finally {
    await runtime.dispose();
  }
});

test("an unconsumed question notifies the parent; cancellation releases the blocked child", async () => {
  const { runtime, questions } = questionRuntime();
  try {
    const manager = await runtime.runPromise(SubagentManager);
    const snap = await runtime.runPromise(
      manager.spawn("pi", {
        prompt: "test",
        title: "worker",
        cwd: process.cwd(),
        parent: { parentCwd: process.cwd(), projectTrusted: false },
      }),
    );
    let notified!: () => void;
    const notification = new Promise<void>((resolve) => {
      notified = resolve;
    });
    manager.view.setOnQuestion((_snap, consumed) => {
      assert.equal(consumed, false);
      notified();
    });
    const child = questions[0]();
    const rejection = assert.rejects(child, /closed/);
    await notification;
    await runtime.runPromise(manager.cancel([snap.id]));
    await rejection;
    assert.equal(manager.view.get(snap.id)?.status, "error");
    assert.equal(manager.view.get(snap.id)?.pendingQuestion, undefined);
  } finally {
    await runtime.dispose();
  }
});
