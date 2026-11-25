(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  const SJ = (root.SJ = root.SJ || {});
  SJ.lightFieldDrag = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function shouldStartDrag(deltaX, deltaY, threshold) {
    return Math.hypot(deltaX, deltaY) >= (threshold == null ? 8 : threshold);
  }

  function dragBubbleTo(bubble, clientX, clientY, viewport) {
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const radius = Math.max(1, bubble.radius || bubble.size / 2 || 20);
    const margin = 8;
    const minX = (radius + margin) / width * 100;
    const minY = (radius + margin) / height * 100;
    return Object.assign({}, bubble, {
      x: Math.max(minX, Math.min(100 - minX, clientX / width * 100)),
      y: Math.max(minY, Math.min(100 - minY, clientY / height * 100)),
    });
  }

  function releaseVelocity(velocityX, velocityY, reducedMotion) {
    if (reducedMotion) return { x: 0, y: 0 };
    const scale = 0.12;
    const x = (Number(velocityX) || 0) * scale;
    const y = (Number(velocityY) || 0) * scale;
    const speed = Math.hypot(x, y);
    const limit = 60;
    const ratio = speed > limit ? limit / speed : 1;
    return { x: x * ratio, y: y * ratio };
  }

  function inertiaStep(bubble, velocity, deltaTime, viewport) {
    const dt = Math.max(0, Math.min(0.05, Number(deltaTime) || 0));
    const damping = Math.exp(-4.8 * dt);
    const nextVelocity = { x: velocity.x * damping, y: velocity.y * damping };
    const next = dragBubbleTo(
      bubble,
      (bubble.x / 100 * viewport.width) + nextVelocity.x * dt,
      (bubble.y / 100 * viewport.height) + nextVelocity.y * dt,
      viewport
    );
    const radius = bubble.radius || bubble.size / 2 || 20;
    const expectedX = bubble.x / 100 * viewport.width + nextVelocity.x * dt;
    const expectedY = bubble.y / 100 * viewport.height + nextVelocity.y * dt;
    const actualX = next.x / 100 * viewport.width;
    const actualY = next.y / 100 * viewport.height;
    if (Math.abs(expectedX - actualX) > 0.5 || Math.abs(expectedY - actualY) > 0.5 || radius <= 0) {
      nextVelocity.x = 0;
      nextVelocity.y = 0;
    }
    return { bubble: next, velocity: nextVelocity };
  }

  return { shouldStartDrag, dragBubbleTo, releaseVelocity, inertiaStep };
});
