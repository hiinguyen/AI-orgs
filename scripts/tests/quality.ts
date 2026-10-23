/**
 * Phase 6 checks for the pure quality policy: the `?quality=` flag, the
 * device rules and the auto-fallback guard.
 */
import {
  AUTO_LOW_CORES,
  MOBILE_BREAKPOINT,
  describeQuality,
  pickInitialQuality,
  shouldAutoFallback,
} from "../../src/state/qualityPolicy.ts";
import type { TestReporter } from "./harness.ts";

const STRONG = {
  search: "",
  width: 1440,
  reducedMotion: false,
  hardwareConcurrency: 8,
};

export function runQualitySuite(reporter: TestReporter): void {
  const { check, group } = reporter;
  group("Render quality policy");

  check(
    "?quality=high forces high and turns auto off even on a phone",
    pickInitialQuality({
      ...STRONG,
      search: "?quality=high",
      width: 360,
      reducedMotion: true,
      hardwareConcurrency: 2,
    }).quality === "high",
  );
  check(
    "?quality=low forces low and turns auto off on a strong desktop",
    (() => {
      const decision = pickInitialQuality({ ...STRONG, search: "?quality=low" });
      return decision.quality === "low" && decision.auto === false;
    })(),
  );
  check(
    "an invalid ?quality=ultra is ignored",
    pickInitialQuality({ ...STRONG, search: "?quality=ultra" }).quality ===
      "high",
  );
  check(
    "an invalid flag still lets the device rules pick low",
    pickInitialQuality({
      ...STRONG,
      search: "?quality=ultra",
      width: 360,
    }).quality === "low",
  );
  check(
    "a viewport just under the mobile breakpoint picks low",
    pickInitialQuality({
      ...STRONG,
      width: MOBILE_BREAKPOINT - 1,
    }).quality === "low",
  );
  check(
    "a viewport at the mobile breakpoint stays high",
    pickInitialQuality({ ...STRONG, width: MOBILE_BREAKPOINT }).quality ===
      "high",
  );
  check(
    "reduced motion picks low on a strong desktop",
    pickInitialQuality({ ...STRONG, reducedMotion: true }).quality === "low",
  );
  check(
    `hardwareConcurrency <= ${AUTO_LOW_CORES} picks low`,
    pickInitialQuality({
      ...STRONG,
      hardwareConcurrency: AUTO_LOW_CORES,
    }).quality === "low",
  );
  check(
    `hardwareConcurrency above ${AUTO_LOW_CORES} stays high`,
    pickInitialQuality({
      ...STRONG,
      hardwareConcurrency: AUTO_LOW_CORES + 1,
    }).quality === "high",
  );
  check(
    "a missing hardwareConcurrency is treated as a normal machine",
    pickInitialQuality({
      ...STRONG,
      hardwareConcurrency: undefined,
    }).quality === "high",
  );
  check(
    "device decisions set auto true",
    pickInitialQuality({
      ...STRONG,
      width: 360,
    }).auto === true &&
      pickInitialQuality({
        ...STRONG,
        reducedMotion: true,
      }).auto === true,
  );

  check(
    "auto fallback may lower an automatic high session",
    shouldAutoFallback("high", true),
  );
  check(
    "auto fallback never overrides a forced high session",
    !shouldAutoFallback("high", false),
  );
  check(
    "auto fallback is a no-op once low",
    !shouldAutoFallback("low", true) && !shouldAutoFallback("low", false),
  );

  check(
    "describeQuality names the mode and whether it is auto or forced",
    describeQuality("high", true) === "High (auto)" &&
      describeQuality("high", false) === "High (forced)" &&
      describeQuality("low", true) === "Low (auto)" &&
      describeQuality("low", false) === "Low (forced)",
  );
}
