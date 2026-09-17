import test from "node:test";
import assert from "node:assert/strict";
import { interactionAnimations, randomInteractionAnimation } from "../src/interaction.js";

test("collects both interact and special animations", () => {
  assert.deepEqual(
    interactionAnimations(["Idle", "Interact", "Special", "Special_2", "Touch"]),
    ["Interact", "Special", "Special_2"],
  );
});

test("uses touch-style animations only when interact and special are absent", () => {
  assert.deepEqual(interactionAnimations(["Idle", "Touch", "Tap_Head"]), ["Touch", "Tap_Head"]);
});

test("selects an interaction using the supplied random value", () => {
  const names = ["Interact", "Special"];
  assert.equal(randomInteractionAnimation(names, () => 0), "Interact");
  assert.equal(randomInteractionAnimation(names, () => 0.999), "Special");
  assert.equal(randomInteractionAnimation([], () => 0.5), null);
});
