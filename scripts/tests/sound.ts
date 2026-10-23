/**
 * Phase 7 checks for the pure sound decisions and the engine core. The engine
 * is driven through a minimal fake AudioContext, so the checks can prove the
 * gesture rule, cue cleanup, throttling and the ambient bed without a browser.
 */
import {
  ARRIVAL_THROTTLE_MS,
  CUE_THROTTLE_MS,
  DEFAULT_SOUND_SETTINGS,
  SOUND_STORAGE_KEY,
  clampVolume,
  cueForEvent,
  isActivatingGesture,
  normaliseSoundSettings,
  parseSoundSettings,
  readSoundSettings,
  serializeSoundSettings,
  speakerPitch,
  throttleAllows,
  throttleKey,
  throttleWindowMs,
  writeSoundSettings,
} from "../../src/audio/soundCues.ts";
import type { StorageLike } from "../../src/audio/soundCues.ts";
import {
  SoundEngine,
  UNLOCK_EVENTS,
  attachUnlockListeners,
} from "../../src/audio/soundEngine.ts";
import type { TestReporter } from "./harness.ts";
import {
  FakeAudioContext,
  FakeCompressor,
  FakeGain,
  FakeTarget,
  ThrowingBufferContext,
  ThrowingGainContext,
  eventOf,
  flush,
  memoryStorage,
} from "./soundFakes.ts";

export async function runSoundSuite(reporter: TestReporter): Promise<void> {
  runCueMappingSuite(reporter);
  runSettingsSuite(reporter);
  runEngineSuite(reporter);
  runLateUnlockSuite(reporter);
  runUnlockListenerSuite(reporter);
  runAmbientRestartSuite(reporter);
  await runAsyncUnlockSuite(reporter);
  await runRearmSuite(reporter);
  await runDisabledEngineSuite(reporter);
  await runActivationSuite(reporter);
}

function runCueMappingSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("10. Sound cue mapping");
  check(
    "task.created plays the two soft blips",
    cueForEvent({ type: "task.created" }) === "taskCreated",
  );
  check(
    "task.assigned and agent.message play the speaker ping",
    cueForEvent({ type: "task.assigned" }) === "ping" &&
      cueForEvent({ type: "agent.message" }) === "ping",
  );
  check(
    "plan.created plays the triad arpeggio",
    cueForEvent({ type: "plan.created" }) === "arpeggio",
  );
  check(
    "research.completed plays the noise sweep",
    cueForEvent({ type: "research.completed" }) === "researchSweep",
  );
  check(
    "implementation start and submit play the keyboard and whoosh",
    cueForEvent({ type: "implementation.started" }) === "keyboard" &&
      cueForEvent({ type: "implementation.submitted" }) === "whoosh",
  );
  check(
    "qa.passed and review.approved play the success chime",
    cueForEvent({ type: "qa.passed" }) === "successChime" &&
      cueForEvent({ type: "review.approved" }) === "successChime",
  );
  check(
    "qa.failed and review.changes_requested play the error buzz",
    cueForEvent({ type: "qa.failed" }) === "errorBuzz" &&
      cueForEvent({ type: "review.changes_requested" }) === "errorBuzz",
  );
  check(
    "the completed and failed tasks play the fanfare and the failure",
    cueForEvent({ type: "task.completed" }) === "fanfare" &&
      cueForEvent({ type: "task.failed" }) === "failure",
  );
  check(
    "blocked and paused play the downward blips",
    cueForEvent({ type: "task.blocked" }) === "downBlips" &&
      cueForEvent({ type: "agent.paused" }) === "downBlips",
  );
  check(
    "unblocked and resumed play the upward blips",
    cueForEvent({ type: "task.unblocked" }) === "upBlips" &&
      cueForEvent({ type: "agent.resumed" }) === "upBlips",
  );
  check(
    "system start/resume rise, pause falls and reset sweeps down",
    cueForEvent({ type: "system.started" }) === "rise" &&
      cueForEvent({ type: "system.resumed" }) === "rise" &&
      cueForEvent({ type: "system.paused" }) === "fall" &&
      cueForEvent({ type: "system.reset" }) === "resetSweep",
  );
  check(
    "an arrival with a task plays the footstep, without one it is silent",
    cueForEvent({ type: "agent.arrived", taskId: "T-001" }) === "footstep" &&
      cueForEvent({ type: "agent.arrived" }) === null,
  );
  check(
    "ambient wanderings and bookkeeping events are silent",
    cueForEvent({ type: "agent.ambient" }) === null &&
      cueForEvent({ type: "qa.started" }) === null &&
      cueForEvent({ type: "review.started" }) === null &&
      cueForEvent({ type: "task.status_changed" }) === null &&
      cueForEvent({ type: "system.ready" }) === null,
  );

  check(
    "speaker pitches match the spec table",
    speakerPitch("orion") === 523 &&
      speakerPitch("piper") === 659 &&
      speakerPitch("iris") === 587 &&
      speakerPitch("kai") === 440 &&
      speakerPitch("quinn") === 698 &&
      speakerPitch("rex") === 392,
    [
      speakerPitch("orion"),
      speakerPitch("piper"),
      speakerPitch("iris"),
      speakerPitch("kai"),
      speakerPitch("quinn"),
      speakerPitch("rex"),
    ].join(", "),
  );
}

function runSettingsSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("11. Sound throttling and settings");
  check(
    "the throttle window is 120 ms, 160 ms for arrivals",
    throttleWindowMs("task.created") === CUE_THROTTLE_MS &&
      throttleWindowMs("agent.arrived") === ARRIVAL_THROTTLE_MS &&
      CUE_THROTTLE_MS === 120 &&
      ARRIVAL_THROTTLE_MS === 160,
  );
  check(
    "message throttle keys are per agent, everything else per type",
    throttleKey({ type: "agent.message", agentId: "orion" }) !==
      throttleKey({ type: "agent.message", agentId: "piper" }) &&
      throttleKey({ type: "task.created" }) === "task.created",
  );
  check(
    "the first cue passes and the window blocks until it expires",
    throttleAllows(undefined, 0, 120) &&
      !throttleAllows(1000, 1119, 120) &&
      throttleAllows(1000, 1120, 120) &&
      !throttleAllows(1000, 1159, 160) &&
      throttleAllows(1000, 1160, 160),
  );

  const roundTrip = parseSoundSettings(
    serializeSoundSettings({ enabled: false, volume: 0.35, ambient: false }),
  );
  check(
    "settings survive a serialise/parse round trip",
    roundTrip.enabled === false &&
      roundTrip.volume === 0.35 &&
      roundTrip.ambient === false,
  );
  check(
    "invalid JSON, null and non-objects fall back to the defaults",
    JSON.stringify(parseSoundSettings(null)) ===
      JSON.stringify(DEFAULT_SOUND_SETTINGS) &&
      JSON.stringify(parseSoundSettings("{")) ===
        JSON.stringify(DEFAULT_SOUND_SETTINGS) &&
      JSON.stringify(parseSoundSettings("null")) ===
        JSON.stringify(DEFAULT_SOUND_SETTINGS),
  );
  const partial = parseSoundSettings(
    '{"enabled":"yes","volume":0.42,"ambient":false}',
  );
  check(
    "a bad field falls back while good siblings survive",
    partial.enabled === true &&
      partial.volume === 0.42 &&
      partial.ambient === false,
    JSON.stringify(partial),
  );
  const outOfRange = parseSoundSettings(
    '{"enabled":false,"volume":1.4,"ambient":"yes"}',
  );
  check(
    "an out-of-range volume and wrong types fall back field by field",
    outOfRange.enabled === false &&
      outOfRange.volume === DEFAULT_SOUND_SETTINGS.volume &&
      outOfRange.ambient === DEFAULT_SOUND_SETTINGS.ambient &&
      normaliseSoundSettings(undefined).volume ===
        DEFAULT_SOUND_SETTINGS.volume,
    JSON.stringify(outOfRange),
  );
  check(
    "clampVolume clamps to 0..1 and rejects non-finite values",
    clampVolume(1.4) === 1 &&
      clampVolume(-0.4) === 0 &&
      clampVolume(0.3) === 0.3 &&
      clampVolume(Number.NaN) === DEFAULT_SOUND_SETTINGS.volume,
  );

  const storage = memoryStorage();
  writeSoundSettings(storage, { enabled: false, volume: 0.5, ambient: true });
  check(
    "settings persist under aaw.sound.v1 and read back",
    storage.data.get(SOUND_STORAGE_KEY) !== undefined &&
      readSoundSettings(storage).enabled === false &&
      readSoundSettings(storage).volume === 0.5,
  );
  storage.data.set(SOUND_STORAGE_KEY, "not json");
  check(
    "corrupt storage loads the defaults field by field",
    JSON.stringify(readSoundSettings(storage)) ===
      JSON.stringify(DEFAULT_SOUND_SETTINGS),
  );
  const throwingStorage: StorageLike = {
    getItem: () => {
      throw new Error("private mode");
    },
    setItem: () => {
      throw new Error("private mode");
    },
  };
  let storageThrew = false;
  try {
    readSoundSettings(throwingStorage);
    writeSoundSettings(throwingStorage, DEFAULT_SOUND_SETTINGS);
  } catch {
    storageThrew = true;
  }
  check(
    "private-mode storage fails quietly on read and write",
    !storageThrew &&
      JSON.stringify(readSoundSettings(null)) ===
        JSON.stringify(DEFAULT_SOUND_SETTINGS),
  );
}

function runEngineSuite(reporter: TestReporter): void {
  const { check, group } = reporter;

  group("12. Sound engine core");
  const fake = new FakeAudioContext();
  let now = 1000;
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => now,
  );
  engine.configure({ enabled: true, volume: 0.6, ambient: true });
  engine.setRunning(true);
  engine.play(eventOf("task.created"));
  check(
    "no AudioContext exists before unlock and play is a silent no-op",
    engine.getDebugSnapshot().context === "none" && fake.nodes.length === 0,
  );

  engine.unlock();
  const unlocked = engine.getDebugSnapshot();
  check(
    "unlock creates and resumes the context",
    unlocked.context === "running" && fake.state === "running",
  );
  const compressor = fake.nodes.find(
    (node): node is FakeCompressor => node instanceof FakeCompressor,
  );
  check(
    "the master gain feeds a -18 dB, ratio 6 compressor",
    compressor !== undefined &&
      compressor.threshold.value === -18 &&
      compressor.ratio.value === 6,
  );
  check(
    "the running ambient bed loops noise and hums at 58 Hz",
    unlocked.ambient &&
      fake.bufferSources.some((source) => source.loop) &&
      fake.oscillators.some((oscillator) => oscillator.frequency.value === 58),
  );

  const beforeCue = fake.sources.length;
  engine.play(eventOf("task.created"));
  const cueSources = fake.sources.slice(beforeCue);
  check(
    "a cue creates its own nodes and disconnects them when they end",
    cueSources.length === 2 &&
      cueSources.every((source) => source.started && source.disconnected),
    `${cueSources.length} sources`,
  );

  const ambientBefore = fake.sources.length;
  engine.play(eventOf("agent.ambient", { agentId: "iris" }));
  check(
    "ambient wander events create no nodes",
    fake.sources.length === ambientBefore,
  );
  engine.play(eventOf("agent.arrived", { agentId: "kai" }));
  const arrivedQuiet = fake.sources.length;
  engine.play(
    eventOf("agent.arrived", { agentId: "kai", taskId: "T-001" }),
  );
  check(
    "arrivals only thump when they carry a task",
    fake.sources.length > arrivedQuiet,
  );

  now = 2000;
  engine.play(eventOf("task.created"));
  const firstAt = fake.sources.length;
  now = 2100;
  engine.play(eventOf("task.created"));
  const stillThrottled = fake.sources.length === firstAt;
  now = 2120;
  engine.play(eventOf("task.created"));
  check(
    "the engine throttles a cue type for 120 ms",
    stillThrottled && fake.sources.length > firstAt,
  );

  now = 3000;
  engine.play(eventOf("agent.message", { agentId: "orion" }));
  const afterOrion = fake.sources.length;
  engine.play(eventOf("agent.message", { agentId: "piper" }));
  const afterPiper = fake.sources.length;
  engine.play(eventOf("agent.message", { agentId: "orion" }));
  check(
    "message throttling is per speaking agent",
    afterPiper > afterOrion && fake.sources.length === afterPiper,
  );

  engine.configure({ enabled: false, volume: 0.6, ambient: true });
  const mutedAt = fake.sources.length;
  engine.play(eventOf("task.completed"));
  check(
    "muting silences new cues and stops the ambient bed",
    fake.sources.length === mutedAt && engine.getDebugSnapshot().ambient === false,
  );

  engine.configure({ enabled: true, volume: 0.6, ambient: true });
  check(
    "unmuting while running starts the ambient bed again",
    engine.getDebugSnapshot().ambient === true,
  );
  engine.setRunning(false);
  check(
    "pausing stops the ambient bed",
    engine.getDebugSnapshot().ambient === false,
  );

  const idleFake = new FakeAudioContext();
  const idle = new SoundEngine(
    () => idleFake as unknown as AudioContext,
    () => 0,
  );
  idle.configure({ enabled: true, volume: 0.6, ambient: true });
  idle.setRunning(false);
  idle.unlock();
  check(
    "no ambient bed starts while the simulation is not running",
    idle.getDebugSnapshot().ambient === false,
  );
}

function runLateUnlockSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("13. Sound engine with a context that is not running");
  const fake = new FakeAudioContext();
  fake.resumePlan.push("suspended");
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => 0,
  );
  engine.configure({ enabled: true, volume: 0.6, ambient: true });
  engine.setRunning(true);
  void engine.unlock();
  const nodesBefore = fake.nodes.length;
  engine.play(eventOf("task.created"));
  check(
    "play() while the context is suspended creates no nodes",
    fake.sources.length === 0 && fake.nodes.length === nodesBefore,
  );
  check(
    "no ambient bed starts while the context is suspended",
    engine.getDebugSnapshot().ambient === false && fake.sources.length === 0,
  );
  fake.setState("running");
  check(
    "the ambient bed starts when the context later becomes running",
    engine.getDebugSnapshot().ambient === true && fake.bufferSources.length === 1,
  );
  const before = fake.sources.length;
  engine.play(eventOf("task.created"));
  check(
    "cues create nodes again once the context is running",
    fake.sources.length > before,
  );
}

function runUnlockListenerSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("14. Gesture unlock listeners");
  const fake = new FakeAudioContext();
  fake.resumePlan.push("suspended");
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => 0,
  );
  const target = new FakeTarget();
  const detach = attachUnlockListeners(target, engine);
  check(
    "listens for pointerdown, pointerup, click and keydown",
    UNLOCK_EVENTS.every((type) => (target.listeners.get(type)?.size ?? 0) === 1) &&
      target.count === UNLOCK_EVENTS.length &&
      ["pointerdown", "pointerup", "click", "keydown"].every((type) =>
        UNLOCK_EVENTS.includes(type),
      ),
  );
  target.fire("keydown");
  check(
    "listeners stay when resume() leaves the context suspended",
    !engine.isRunning() && target.count === UNLOCK_EVENTS.length,
  );
  target.fire("click");
  check(
    "a second gesture retries resume() and the listeners go once running",
    fake.resumeCalls === 2 && engine.isRunning() && target.count === 0,
  );
  detach();

  const lateFake = new FakeAudioContext();
  lateFake.resumePlan.push("suspended");
  const lateEngine = new SoundEngine(
    () => lateFake as unknown as AudioContext,
    () => 0,
  );
  const lateTarget = new FakeTarget();
  attachUnlockListeners(lateTarget, lateEngine);
  lateTarget.fire("pointerdown");
  lateFake.setState("running");
  check(
    "a statechange to running also removes the listeners",
    lateTarget.count === 0,
  );

  const cleanTarget = new FakeTarget();
  const cleanFake = new FakeAudioContext();
  cleanFake.resumePlan.push("suspended");
  const cleanEngine = new SoundEngine(
    () => cleanFake as unknown as AudioContext,
    () => 0,
  );
  const first = attachUnlockListeners(cleanTarget, cleanEngine);
  first();
  const second = attachUnlockListeners(cleanTarget, cleanEngine);
  check(
    "a StrictMode remount leaves exactly one listener set and one subscription",
    cleanTarget.count === UNLOCK_EVENTS.length &&
      UNLOCK_EVENTS.every((type) => (cleanTarget.listeners.get(type)?.size ?? 0) === 1) &&
      cleanEngine.changeListenerCount === 1 &&
      cleanFake.stateListenerCount === 0,
  );
  cleanTarget.fire("keydown");
  second();
  check(
    "cleanup removes every unlock listener and the engine subscription",
    cleanTarget.count === 0 && cleanEngine.changeListenerCount === 0,
  );
}

function runAmbientRestartSuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("15. Ambient bed restart");
  const fake = new FakeAudioContext();
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => 0,
  );
  engine.configure({ enabled: true, volume: 0.6, ambient: true });
  engine.setRunning(true);
  void engine.unlock();
  engine.setRunning(false);
  engine.setRunning(true);
  const beds = fake.nodes.filter(
    (node): node is FakeGain => node instanceof FakeGain,
  );
  const liveNoise = fake.bufferSources.filter((source) => !source.stopped);
  const liveHum = fake.oscillators.filter((source) => !source.stopped);
  check(
    "start, stop, start again leaves exactly one live bed",
    fake.bufferSources.length === 2 &&
      fake.bufferSources.filter((source) => source.stopped).length === 1 &&
      liveNoise.length === 1 &&
      liveHum.length === 1 &&
      engine.getDebugSnapshot().ambient === true,
  );
  const bedGains = beds.filter((gain) =>
    gain.outputs.some((target) => target !== undefined) && gain.gain.events.some(
      (event) => event.kind === "linear" && event.value === 1,
    ),
  );
  const liveBed = bedGains[bedGains.length - 1];
  check(
    "the new bed is not disconnected by the old bed's fade-out",
    liveBed !== undefined && !liveBed.disconnected &&
      bedGains.length === 2 && bedGains[0]?.disconnected === true,
  );
  engine.setRunning(false);
  check(
    "stopping releases the bed from the sources ending, not from a timer",
    fake.sources.every((source) => source.stopped) &&
      bedGains.every((gain) => gain.disconnected),
  );
}

async function runAsyncUnlockSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("16. Unlock listeners follow the async resume result");
  const total = UNLOCK_EVENTS.length;

  const fake = new FakeAudioContext();
  fake.deferResume = true;
  fake.resumePlan.push("suspended", "running");
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => 0,
  );
  const target = new FakeTarget();
  attachUnlockListeners(target, engine);
  target.fire("pointerup");
  await flush();
  check(
    "listeners stay while resume() is still pending",
    target.count === total && fake.resumeCalls === 1,
  );
  fake.settleResume(false);
  await flush();
  check(
    "listeners stay after a resume that resolves but leaves the context suspended",
    !engine.isRunning() && target.count === total,
  );
  target.fire("pointerup");
  fake.settleResume(false);
  check(
    "no listener is removed before the async result is processed",
    target.count === total,
  );
  await flush();
  check(
    "listeners go once the state is running via the async path alone",
    engine.isRunning() && target.count === 0 && fake.stateListenerCount === 1,
  );
}

async function runRearmSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("17. Unlock listeners re-arm when the context leaves running");
  const total = UNLOCK_EVENTS.length;

  const fake = new FakeAudioContext();
  const engine = new SoundEngine(
    () => fake as unknown as AudioContext,
    () => 0,
  );
  const target = new FakeTarget();
  const detach = attachUnlockListeners(target, engine);
  target.fire("click");
  await flush();
  check("listeners are removed once running", engine.isRunning() && target.count === 0);
  fake.setState("interrupted");
  check(
    "running -> interrupted re-arms exactly one listener set",
    target.count === total &&
      UNLOCK_EVENTS.every((type) => (target.listeners.get(type)?.size ?? 0) === 1) &&
      engine.changeListenerCount === 1,
  );
  fake.setState("suspended");
  check("a further non-running change does not duplicate the set", target.count === total);
  target.fire("keydown");
  await flush();
  check(
    "a gesture resumes the interrupted context and the listeners go again",
    fake.resumeCalls === 2 && engine.isRunning() && target.count === 0,
  );
  fake.setState("interrupted");
  detach();
  check(
    "cleanup removes the re-armed listeners and the subscription",
    target.count === 0 && engine.changeListenerCount === 0,
  );

  const mountFake = new FakeAudioContext();
  const mountEngine = new SoundEngine(
    () => mountFake as unknown as AudioContext,
    () => 0,
  );
  await mountEngine.unlock();
  const mountTarget = new FakeTarget();
  const mountDetach = attachUnlockListeners(mountTarget, mountEngine);
  check(
    "remounting with an already running engine attaches nothing",
    mountEngine.isRunning() && mountTarget.count === 0,
  );
  mountFake.setState("suspended");
  check(
    "a remount on a running engine still re-arms when it leaves running",
    mountTarget.count === total,
  );
  mountDetach();
  check("cleanup after a remount removes everything", mountTarget.count === 0);
}

async function runDisabledEngineSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("18. Disabled engine");
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", onRejection);

  const throwing = new ThrowingGainContext();
  const throwingEngine = new SoundEngine(
    () => throwing as unknown as AudioContext,
    () => 0,
  );
  const throwingTarget = new FakeTarget();
  attachUnlockListeners(throwingTarget, throwingEngine);
  const result = await throwingEngine.unlock();
  throwingEngine.play(eventOf("task.created"));
  throwingTarget.fire("pointerdown");
  await flush();
  check(
    "a throwing context construction resolves false and disables quietly",
    result === false && throwingEngine.isDisabled(),
  );
  check(
    "the half-built context is closed exactly once",
    throwing.closeCalls === 1,
  );
  const okFake = new FakeAudioContext();
  const okEngine = new SoundEngine(() => okFake as unknown as AudioContext, () => 0);
  await okEngine.unlock();
  await flush();
  check(
    "a successfully built context is not closed",
    okEngine.isRunning() && okFake.closeCalls === 0,
  );
  check(
    "no unhandled rejection from a throwing construction",
    rejections.length === 0,
  );
  check(
    "a disabled engine detaches the unlock listeners and its subscription",
    throwingTarget.count === 0 && throwingEngine.changeListenerCount === 0,
  );

  const noneEngine = new SoundEngine(() => null, () => 0);
  const noneTarget = new FakeTarget();
  attachUnlockListeners(noneTarget, noneEngine);
  const armed = noneTarget.count === UNLOCK_EVENTS.length;
  noneTarget.fire("keydown");
  await flush();
  check(
    "without Web Audio the first gesture detaches everything",
    armed && noneTarget.count === 0 && noneEngine.changeListenerCount === 0,
  );

  const bufferFake = new ThrowingBufferContext();
  const bufferEngine = new SoundEngine(
    () => bufferFake as unknown as AudioContext,
    () => 0,
  );
  bufferEngine.configure({ enabled: true, volume: 0.6, ambient: true });
  bufferEngine.setRunning(true);
  let bufferResult: boolean | "rejected" = "rejected";
  try {
    bufferResult = await bufferEngine.unlock();
  } catch {
    bufferResult = "rejected";
  }
  await flush();
  check(
    "unlock() resolves when the ambient bed cannot start",
    bufferResult !== "rejected" && rejections.length === 0,
  );

  process.off("unhandledRejection", onRejection);
}

async function runActivationSuite(reporter: TestReporter): Promise<void> {
  const { check, group } = reporter;
  group("19. Only activating gestures create or resume the context");
  const table: Array<[string, Parameters<typeof isActivatingGesture>[0], boolean]> = [
    ["Escape keydown", { type: "keydown", key: "Escape" }, false],
    ["Enter keydown", { type: "keydown", key: "Enter" }, true],
    ["keydown without a key", { type: "keydown" }, true],
    ["touch pointerdown", { type: "pointerdown", pointerType: "touch" }, false],
    ["pen pointerdown", { type: "pointerdown", pointerType: "pen" }, false],
    ["mouse pointerdown", { type: "pointerdown", pointerType: "mouse" }, true],
    ["pointerdown without a type", { type: "pointerdown" }, true],
    ["touch pointerup", { type: "pointerup", pointerType: "touch" }, true],
    ["click", { type: "click" }, true],
    ["mousemove", { type: "mousemove" }, false],
  ];
  for (const [name, event, expected] of table) {
    check(`isActivatingGesture: ${name} is ${expected}`, isActivatingGesture(event) === expected);
  }

  let created = 0;
  const fake = new FakeAudioContext();
  const engine = new SoundEngine(
    () => {
      created += 1;
      return fake as unknown as AudioContext;
    },
    () => 0,
  );
  const target = new FakeTarget();
  attachUnlockListeners(target, engine);
  const total = UNLOCK_EVENTS.length;
  target.fire("keydown", { key: "Escape" });
  await flush();
  check(
    "Escape as the first input creates no context and keeps the listeners armed",
    created === 0 && fake.resumeCalls === 0 && target.count === total,
  );
  target.fire("pointerdown", { pointerType: "touch" });
  await flush();
  check(
    "a touch pointerdown creates no context and keeps the listeners armed",
    created === 0 && fake.resumeCalls === 0 && target.count === total,
  );
  target.fire("pointerup", { pointerType: "touch" });
  await flush();
  check(
    "the touch pointerup then unlocks and disarms",
    created === 1 && engine.isRunning() && target.count === 0,
  );

  let mouseCreated = 0;
  const mouseEngine = new SoundEngine(
    () => {
      mouseCreated += 1;
      return new FakeAudioContext() as unknown as AudioContext;
    },
    () => 0,
  );
  const mouseTarget = new FakeTarget();
  attachUnlockListeners(mouseTarget, mouseEngine);
  mouseTarget.fire("pointerdown", { pointerType: "mouse" });
  await flush();
  check("a mouse pointerdown creates the context", mouseCreated === 1);

  let clickCreated = 0;
  const clickEngine = new SoundEngine(
    () => {
      clickCreated += 1;
      return new FakeAudioContext() as unknown as AudioContext;
    },
    () => 0,
  );
  const clickTarget = new FakeTarget();
  attachUnlockListeners(clickTarget, clickEngine);
  clickTarget.fire("click");
  await flush();
  check("a click creates the context", clickCreated === 1);
}
