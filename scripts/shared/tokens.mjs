import { MODULE_ID, MODULE_TITLE } from "../constants.mjs";
import { clamp, errorMessage, wait } from "./context.mjs";

const pendingSocketRequests = new Map();

export async function onSocketMessage(message) {
  if (!message || message.moduleId !== MODULE_ID) return;

  if (message.type === "move-token-response") {
    const pending = pendingSocketRequests.get(message.requestId);
    if (!pending || message.requesterId !== game.user?.id) return;
    window.clearTimeout(pending.timeout);
    pendingSocketRequests.delete(message.requestId);
    pending.resolve({
      success: Boolean(message.success),
      attempts: Array.isArray(message.attempts) ? message.attempts : [],
      errors: Array.isArray(message.errors) ? message.errors : []
    });
    return;
  }

  if (message.type !== "move-token-request" || !isPrimaryGm()) return;

  const response = {
    moduleId: MODULE_ID,
    type: "move-token-response",
    requestId: message.requestId,
    requesterId: message.requesterId,
    success: false,
    attempts: [],
    errors: []
  };

  try {
    const document = await fromUuid(message.tokenUuid);
    if (!document) throw new Error(`Token not found: ${message.tokenUuid}`);
    const token = document.object ?? { document };
    const result = await moveTokenLocally(token, message.destination);
    response.success = result.success;
    response.attempts = result.attempts;
    response.errors = result.errors.map(errorMessage);
  } catch (error) {
    response.errors.push(errorMessage(error));
  }

  game.socket?.emit?.(`module.${MODULE_ID}`, response);
}

async function requestGmTokenMove(token, destination) {
  const gm = primaryGmUser();
  if (!gm) {
    return {
      success: false,
      attempts: [{ method: "gm-socket", skipped: "no-active-gm" }],
      errors: ["没有在线 GM 可以代为移动 Token。"]
    };
  }

  const document = tokenDocument(token);
  const requestId = foundry.utils.randomID();
  const timeoutMs = clamp(Number(destination.settleMs ?? 720) * 4 + 1000, 6000, 12000);
  const payload = {
    moduleId: MODULE_ID,
    type: "move-token-request",
    requestId,
    requesterId: game.user?.id,
    tokenUuid: document.uuid,
    destination: {
      x: destination.x,
      y: destination.y,
      ignoreCollision: Boolean(destination.ignoreCollision),
      settleMs: Number(destination.settleMs ?? 0)
    }
  };

  const response = new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingSocketRequests.delete(requestId);
      resolve({
        success: false,
        attempts: [{ method: "gm-socket", gm: gm.name, timeout: true }],
        errors: ["等待 GM 客户端移动 Token 超时。"]
      });
    }, timeoutMs);
    pendingSocketRequests.set(requestId, { resolve, timeout });
  });

  game.socket?.emit?.(`module.${MODULE_ID}`, payload);
  return response;
}

function primaryGmUser() {
  return Array.from(game.users ?? [])
    .filter((user) => user.active && user.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function isPrimaryGm() {
  return Boolean(game.user?.isGM && primaryGmUser()?.id === game.user.id);
}

export function findChargeDestination(source, target, maxDistanceFeet) {
  const strict = bestChargeDestination(source, target, maxDistanceFeet);
  if (strict) return strict;

  const collisionFallback = bestChargeDestination(source, target, maxDistanceFeet, { ignoreCollision: true });
  if (collisionFallback) {
    collisionFallback.ignoreCollision = true;
    return collisionFallback;
  }

  return null;
}

function bestChargeDestination(source, target, maxDistanceFeet, options = {}) {
  const ignoreCollision = Boolean(options.ignoreCollision);
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const gridDistance = canvas.dimensions?.distance ?? canvas.scene?.grid?.distance ?? 5;
  const sourceDoc = source.document;
  const targetDoc = target.document;
  const sw = Math.max(1, Number(sourceDoc.width ?? 1));
  const sh = Math.max(1, Number(sourceDoc.height ?? 1));
  const tw = Math.max(1, Number(targetDoc.width ?? 1));
  const th = Math.max(1, Number(targetDoc.height ?? 1));
  const candidates = [];

  for (let gx = -sw; gx <= tw; gx += 1) {
    for (let gy = -sh; gy <= th; gy += 1) {
      if (rectsOverlap(gx, gy, sw, sh, 0, 0, tw, th)) continue;
      const raw = snapPosition(targetDoc.x + gx * gridSize, targetDoc.y + gy * gridSize);
      const center = {
        x: raw.x + (sw * gridSize) / 2,
        y: raw.y + (sh * gridSize) / 2
      };
      const distanceFeet = pixelDistance(tokenCenter(source), center) * gridDistance / gridSize;
      if (distanceFeet > maxDistanceFeet + 0.01) continue;
      if (!ignoreCollision && hasMovementCollision(tokenCenter(source), center)) continue;
      candidates.push({
        x: raw.x,
        y: raw.y,
        distanceFeet,
        occupied: destinationOccupied(raw, source, target),
        score: distanceFeet,
        ignoreCollision
      });
    }
  }

  const clear = candidates.filter((candidate) => !candidate.occupied);
  const pool = clear.length ? clear : candidates;
  pool.sort((a, b) => a.score - b.score);
  return pool[0] ?? null;
}

export function chargeAnimationTiming(source, destination) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const gridDistance = canvas.dimensions?.distance ?? canvas.scene?.grid?.distance ?? 5;
  const from = tokenCenter(source);
  const to = destination ? tokenCenterFromPosition(source, destination) : null;
  const feet = to ? pixelDistance(from, to) * gridDistance / gridSize : 30;
  return {
    moveDelay: 340,
    moveDuration: clamp(Math.round(feet * 14), 560, 980)
  };
}

export async function moveToken(token, destination) {
  if (!token?.document || !destination) return false;
  if (tokenAtDestination(token, destination)) return true;
  const actorName = token.actor?.name ?? token.document?.actor?.name ?? token.document?.name ?? "角色";

  const local = await moveTokenLocally(token, destination);
  if (local.success) return true;

  if (!game.user?.isGM) {
    const gm = await requestGmTokenMove(token, destination);
    if (gm.success) return true;
    local.errors.push(...gm.errors);
    local.attempts.push(...gm.attempts);
  }

  console.warn(`${MODULE_TITLE} | ${actorName} 狂热冲锋 Token 移动失败`, {
    token,
    destination,
    attempts: local.attempts,
    errors: local.errors
  });
  return false;
}

async function moveTokenLocally(token, destination) {
  const document = tokenDocument(token);
  if (!document || !destination) return { success: false, attempts: [], errors: [] };
  if (tokenAtDestination(token, destination)) return { success: true, attempts: [{ method: "already-at-destination" }], errors: [] };

  const center = tokenCenterFromPosition(token, destination);
  const ignoreWalls = Boolean(destination.ignoreCollision);
  const settleMs = clamp(Number(destination.settleMs ?? 720), 180, 2400);
  const errors = [];
  const attempts = [];
  const objectToken = document.object ?? (token?.actor ? token : null);

  if (objectToken?.document && typeof globalThis.MidiQOL?.moveToken === "function") {
    try {
      await globalThis.MidiQOL.moveToken(objectToken, center, {
        animate: true,
        ignoreWalls,
        ignoreTokens: true
      });
      attempts.push(movementAttempt("MidiQOL.moveToken", token, destination));
      if (await waitForTokenDestination(token, destination, settleMs)) return { success: true, attempts, errors };
    } catch (error) {
      errors.push(error);
      attempts.push({ method: "MidiQOL.moveToken", error: errorMessage(error) });
    }
  }

  if (typeof document.move === "function") {
    try {
      const snappedCenter = canvas.grid?.getSnappedPoint
        ? canvas.grid.getSnappedPoint(center, { mode: CONST.GRID_SNAPPING_MODES.CENTER })
        : center;
      const waypoint = {
        x: snappedCenter.x - tokenPixelWidth(token) / 2,
        y: snappedCenter.y - tokenPixelHeight(token) / 2,
        action: CONFIG.Token?.movement?.defaultAction ?? "walk",
        forced: true,
        snapped: true
      };
      await document.move(waypoint, {
        constrainOptions: {
          ignoreWalls,
          ignoreCost: true,
          ignoreTokens: true
        },
        autoRotate: true,
        animate: true
      });
      attempts.push(movementAttempt("TokenDocument.move", token, destination));
      if (await waitForTokenDestination(token, destination, settleMs)) return { success: true, attempts, errors };
    } catch (error) {
      errors.push(error);
      attempts.push({ method: "TokenDocument.move", error: errorMessage(error) });
    }
  }

  try {
    const updated = await updateTokenDocumentPosition(document, destination, { animate: true });
    attempts.push(movementAttempt("Scene.updateEmbeddedDocuments.animate", token, destination, updated));
    if (await waitForTokenDestination(token, destination, settleMs) || updatedAtDestination(updated, destination)) {
      return { success: true, attempts, errors };
    }
  } catch (error) {
    errors.push(error);
    attempts.push({ method: "Scene.updateEmbeddedDocuments.animate", error: errorMessage(error) });
  }

  try {
    const updated = await updateTokenDocumentPosition(document, destination);
    attempts.push(movementAttempt("Scene.updateEmbeddedDocuments", token, destination, updated));
    if (await waitForTokenDestination(token, destination, settleMs) || updatedAtDestination(updated, destination)) {
      return { success: true, attempts, errors };
    }
  } catch (error) {
    errors.push(error);
    attempts.push({ method: "Scene.updateEmbeddedDocuments", error: errorMessage(error) });
  }

  return { success: false, attempts, errors };
}

function tokenAtDestination(token, destination) {
  const document = liveTokenDocument(token);
  const dx = Math.abs((document?.x ?? token?.x ?? 0) - destination.x);
  const dy = Math.abs((document?.y ?? token?.y ?? 0) - destination.y);
  return dx < 1 && dy < 1;
}

function liveTokenDocument(token) {
  const document = tokenDocument(token);
  if (!document) return null;
  return canvas?.scene?.tokens?.get?.(document.id) ?? document;
}

export function tokenCenterFromPosition(token, position) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const document = tokenDocument(token);
  return {
    x: (position?.x ?? document?.x ?? 0) + Math.max(1, Number(document?.width ?? 1)) * gridSize / 2,
    y: (position?.y ?? document?.y ?? 0) + Math.max(1, Number(document?.height ?? 1)) * gridSize / 2
  };
}

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function tokenPixelWidth(token) {
  const document = tokenDocument(token);
  return token?.w ?? Math.max(1, Number(document?.width ?? 1)) * (canvas.grid?.size ?? canvas.dimensions?.size ?? 100);
}

function tokenPixelHeight(token) {
  const document = tokenDocument(token);
  return token?.h ?? Math.max(1, Number(document?.height ?? 1)) * (canvas.grid?.size ?? canvas.dimensions?.size ?? 100);
}

async function updateTokenDocumentPosition(document, destination, options = {}) {
  const update = { _id: document.id, x: destination.x, y: destination.y };
  if (document.parent && typeof document.parent.updateEmbeddedDocuments === "function") {
    return document.parent.updateEmbeddedDocuments("Token", [update], options);
  }
  return document.update({ x: destination.x, y: destination.y }, options);
}

function updatedAtDestination(updated, destination) {
  const documents = Array.isArray(updated) ? updated : [updated];
  return documents.some((document) => {
    if (!document) return false;
    const dx = Math.abs((document.x ?? 0) - destination.x);
    const dy = Math.abs((document.y ?? 0) - destination.y);
    return dx < 1 && dy < 1;
  });
}

async function waitForTokenDestination(token, destination, timeoutMs = 720) {
  const deadline = Date.now() + clamp(Number(timeoutMs ?? 720), 120, 2400);
  while (Date.now() <= deadline) {
    if (tokenAtDestination(token, destination)) return true;
    await wait(60);
  }
  return tokenAtDestination(token, destination);
}

function movementAttempt(method, token, destination, updated = null) {
  const document = tokenDocument(token);
  const result = {
    method,
    current: { x: document?.x, y: document?.y },
    target: { x: destination.x, y: destination.y }
  };
  if (Array.isArray(updated)) result.updated = updated.map((doc) => ({ id: doc?.id, x: doc?.x, y: doc?.y }));
  else if (updated) result.updated = { id: updated.id, x: updated.x, y: updated.y };
  return result;
}

function destinationOccupied(destination, source, target) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const sw = Math.max(1, Number(source.document?.width ?? 1));
  const sh = Math.max(1, Number(source.document?.height ?? 1));
  return Array.from(canvas.tokens?.placeables ?? []).some((token) => {
    if (!token?.document || token === source || token === target) return false;
    return rectsOverlap(
      destination.x,
      destination.y,
      sw * gridSize,
      sh * gridSize,
      token.document.x,
      token.document.y,
      Math.max(1, Number(token.document.width ?? 1)) * gridSize,
      Math.max(1, Number(token.document.height ?? 1)) * gridSize
    );
  });
}

function hasMovementCollision(from, to) {
  try {
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if (backend?.testCollision) return Boolean(backend.testCollision(from, to, { type: "move", mode: "any" }));
    const RayClass = foundry.canvas?.geometry?.Ray ?? globalThis.Ray;
    if (canvas.walls?.checkCollision && RayClass) return Boolean(canvas.walls.checkCollision(new RayClass(from, to), { type: "move", mode: "any" }));
  } catch (error) {
    return false;
  }
  return false;
}

export function resolveChargeTarget(context = {}, source = null) {
  const explicit = (context.targets ?? []).map(normalizeToken).find(Boolean);
  if (explicit && explicit !== source) return explicit;
  return Array.from(game.user?.targets ?? []).map(normalizeToken).find((target) => target && target !== source) ?? null;
}

export function tokenForActor(actor) {
  if (!actor || !canvas?.tokens) return null;
  const controlled = canvas.tokens.controlled?.find((token) => token.actor?.uuid === actor.uuid || token.actor?.id === actor.id);
  if (controlled) return controlled;
  return Array.from(canvas.tokens.placeables ?? []).find((token) => token.actor?.uuid === actor.uuid || token.actor?.id === actor.id) ?? null;
}

export function normalizeToken(value) {
  if (!value) return null;
  if (value.document?.object) return value.document.object;
  if (value.object) return value.object;
  if (value.actor && value.document) return value;
  return null;
}

function snapPosition(x, y) {
  try {
    if (typeof canvas.grid?.getSnappedPoint === "function") {
      const point = canvas.grid.getSnappedPoint({ x, y });
      return { x: point.x, y: point.y };
    }
    if (typeof canvas.grid?.getSnappedPosition === "function") return canvas.grid.getSnappedPosition(x, y, 1);
  } catch (error) {
    // Fall through to simple grid snapping.
  }
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize
  };
}

function tokenCenter(token) {
  const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  return {
    x: (token.document?.x ?? token.x ?? 0) + Math.max(1, Number(token.document?.width ?? 1)) * gridSize / 2,
    y: (token.document?.y ?? token.y ?? 0) + Math.max(1, Number(token.document?.height ?? 1)) * gridSize / 2
  };
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function pixelDistance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}
