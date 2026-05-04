import assert from "node:assert/strict";
import test from "node:test";

import { buildWaveformBars } from "./timelineRender.js";

test("buildWaveformBars scales amplitudes down with clip volume", () => {
  const full = buildWaveformBars({
    width: 30,
    peaks: [0.8, 0.8, 0.8, 0.8],
    inPoint: 0,
    outPoint: 4,
    sourceDuration: 4,
    volume: 1,
    minBars: 4,
  });
  const quiet = buildWaveformBars({
    width: 30,
    peaks: [0.8, 0.8, 0.8, 0.8],
    inPoint: 0,
    outPoint: 4,
    sourceDuration: 4,
    volume: 0.25,
    minBars: 4,
  });

  assert.ok(quiet[1].height < full[1].height);
  assert.equal(quiet[1].height, 20);
});

test("buildWaveformBars applies visual fade envelope to waveform heights", () => {
  const bars = buildWaveformBars({
    width: 18,
    peaks: [1, 1, 1, 1, 1, 1],
    inPoint: 0,
    outPoint: 6,
    sourceDuration: 6,
    volume: 1,
    fadeIn: 2,
    fadeOut: 2,
    minBars: 6,
  });

  assert.equal(bars[0].height, 0);
  assert.ok(bars[1].height < bars[2].height);
  assert.ok(bars[4].height > bars[5].height);
  assert.equal(bars[5].height, 0);
});
