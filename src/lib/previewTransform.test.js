import test from "node:test";
import assert from "node:assert/strict";
import {
  computePreviewResizeTransform,
  softMagnetTowardZero,
  smoothPreviewMove,
} from "./previewTransform.js";

test("softMagnetTowardZero leaves values outside magnet radius unchanged", () => {
  assert.equal(softMagnetTowardZero(40, 22), 40);
  assert.equal(softMagnetTowardZero(-40, 22), -40);
});

test("smoothPreviewMove passes through raw motion when snap disabled", () => {
  const r = smoothPreviewMove(12.3, -4.2, { width: 100, height: 100 }, false);
  assert.equal(r.positionX, 12.3);
  assert.equal(r.positionY, -4.2);
  assert.equal(r.guides, null);
});

test("smoothPreviewMove pulls gently toward center when snap enabled", () => {
  const r = smoothPreviewMove(10, 0, { width: 200, height: 100 }, true);
  assert.ok(Math.abs(r.positionX) < 10);
  assert.equal(r.positionY, 0);
  assert.ok(Number.isFinite(r.guides?.x));
});

test("corner resize keeps the opposite corner anchored by shifting position", () => {
  const result = computePreviewResizeTransform({
    mode: "resize-se",
    rect: { width: 200, height: 100 },
    dx: 100,
    dy: 50,
    clip: {
      positionX: 0,
      positionY: 0,
      scaleX: 100,
      scaleY: 100,
      scaleLocked: false,
      rotation: 0,
    },
  });

  assert.equal(result.scaleX, 150);
  assert.equal(result.scaleY, 150);
  assert.equal(result.positionX, 50);
  assert.equal(result.positionY, 25);
});

test("side resize stays centered", () => {
  const result = computePreviewResizeTransform({
    mode: "resize-right",
    rect: { width: 200, height: 100 },
    dx: 100,
    dy: 0,
    clip: {
      positionX: 10,
      positionY: 20,
      scaleX: 100,
      scaleY: 100,
      scaleLocked: false,
    },
  });

  assert.equal(result.scaleX, 150);
  assert.equal(result.positionX, undefined);
  assert.equal(result.positionY, undefined);
});

test("alt keeps corner resize centered", () => {
  const result = computePreviewResizeTransform({
    mode: "resize-ne",
    rect: { width: 200, height: 100 },
    dx: 100,
    dy: -50,
    altKey: true,
    clip: {
      positionX: 0,
      positionY: 0,
      scaleX: 100,
      scaleY: 100,
      scaleLocked: false,
    },
  });

  assert.equal(result.scaleX, 150);
  assert.equal(result.scaleY, 150);
  assert.equal(result.positionX, undefined);
  assert.equal(result.positionY, undefined);
});

test("flipped horizontal corner resize follows the visible handle direction", () => {
  const result = computePreviewResizeTransform({
    mode: "resize-ne",
    rect: { width: 200, height: 100 },
    dx: -100,
    dy: -50,
    clip: {
      positionX: 0,
      positionY: 0,
      scaleX: 100,
      scaleY: 100,
      scaleLocked: false,
      flipH: true,
      rotation: 0,
    },
  });

  assert.equal(result.scaleX, 150);
  assert.equal(result.scaleY, 150);
  assert.equal(result.positionX, -50);
  assert.equal(result.positionY, -25);
});

test("flipped vertical corner resize follows the visible handle direction", () => {
  const result = computePreviewResizeTransform({
    mode: "resize-sw",
    rect: { width: 200, height: 100 },
    dx: -100,
    dy: -50,
    clip: {
      positionX: 0,
      positionY: 0,
      scaleX: 100,
      scaleY: 100,
      scaleLocked: false,
      flipV: true,
      rotation: 0,
    },
  });

  assert.equal(result.scaleX, 150);
  assert.equal(result.scaleY, 150);
  assert.equal(result.positionX, -50);
  assert.equal(result.positionY, -25);
});
