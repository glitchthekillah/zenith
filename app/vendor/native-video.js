// Air native video adapter (MIT OR Apache-2.0). Source and licenses: third-party/air-native-video.

// third-party/air-native-video/guest-js/native-ended.ts
function isNativeEnded(snapshot) {
  if (!snapshot) return false;
  return snapshot.ended ?? Boolean(!snapshot.live && snapshot.durationSeconds > 0 && snapshot.currentTimeSeconds >= snapshot.durationSeconds);
}

// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}
var Channel = class {
  constructor(onmessage) {
    _Channel_onmessage.set(this, void 0);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, void 0);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
    }), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  /**
   * The handler called for every message sent by the Rust side of this channel.
   *
   * Assigning a new handler replaces the previous one; messages that arrived
   * before a handler was set are not replayed, so set it (or pass it to the
   * constructor) before sending the channel to the backend.
   */
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
var Resource = class {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, void 0);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  /**
   * Destroys and cleans up this resource from memory.
   * **You should not call any method on this object anymore and should drop any reference to it.**
   *
   * @remarks Uses the `core:resources:allow-close` permission, which is part of
   * the `core:resources:default` permission set enabled by default.
   */
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
  async [(_Resource_rid = /* @__PURE__ */ new WeakMap(), Symbol.asyncDispose)]() {
    await this.close();
  }
};

// third-party/air-native-video/guest-js/models.ts
function nativePlatform() {
  if (/Android/i.test(navigator.userAgent)) return "android";
  if (/Windows/i.test(navigator.userAgent)) return "windows";
  return "linux";
}
function nativeOpenSettings(options, platform) {
  const playback = options.playback;
  const android = platform === "android";
  const tv = options.deviceProfile === "tv" || (options.deviceProfile === void 0 || options.deviceProfile === "auto") && /\bTV\b|AFT|BRAVIA|SHIELD|GoogleTV/i.test(navigator.userAgent);
  const androidOptions = android ? { ...playback?.android, ...tv ? playback?.androidTv : void 0 } : void 0;
  const buffer = androidOptions?.buffer ?? (platform === "linux" ? playback?.linux?.buffer : void 0) ?? (platform === "windows" ? playback?.windows?.buffer : void 0);
  return {
    backend: playback?.engine,
    minBufferMs: secondsToMilliseconds(buffer?.minSeconds),
    maxBufferMs: secondsToMilliseconds(buffer?.maxSeconds),
    playbackBufferMs: secondsToMilliseconds(buffer?.playSeconds),
    rebufferMs: secondsToMilliseconds(buffer?.rebufferSeconds),
    targetBufferBytes: buffer?.maxBytes,
    decoderFallback: androidOptions?.decoderFallback,
    dolbyVisionMode: androidOptions?.dolbyVision,
    tunneling: androidOptions?.tunneling
  };
}
function secondsToMilliseconds(value) {
  return value === void 0 ? void 0 : Math.max(0, Math.round(value * 1e3));
}

// third-party/air-native-video/guest-js/native-surface-layout.ts
function snapNativeSurfaceLayout(rect, android, scale) {
  const snap = android ? Math.trunc : Math.round;
  return {
    x: snap(rect.left * scale),
    y: snap(rect.top * scale),
    width: Math.max(1, snap(rect.width * scale)),
    height: Math.max(1, snap(rect.height * scale))
  };
}
function visibleSurfaceBounds(layout, scale, viewport) {
  return {
    left: clamp(layout.x / scale, 0, viewport.width),
    top: clamp(layout.y / scale, 0, viewport.height),
    right: clamp((layout.x + layout.width) / scale, 0, viewport.width),
    bottom: clamp((layout.y + layout.height) / scale, 0, viewport.height)
  };
}
function sameNativeSurfacePosition(left, right, android) {
  if (!right) return false;
  const leftX = android ? left.x + left.scrollX : left.x;
  const leftY = android ? left.y + left.scrollY : left.y;
  const rightX = android ? right.x + right.scrollX : right.x;
  const rightY = android ? right.y + right.scrollY : right.y;
  return Math.abs(leftX - rightX) < 0.5 && Math.abs(leftY - rightY) < 0.5 && Math.abs(left.width - right.width) < 0.5 && Math.abs(left.height - right.height) < 0.5;
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

// third-party/air-native-video/guest-js/native-surface-geometry.ts
var ZERO_RADIUS = Object.freeze({ x: 0, y: 0 });
var ZERO_RADII = Object.freeze([
  ZERO_RADIUS,
  ZERO_RADIUS,
  ZERO_RADIUS,
  ZERO_RADIUS
]);
var ZERO_RADIUS_STYLES = Object.freeze(["0px", "0px", "0px", "0px"]);
function outsidePanels(ancestor, hole) {
  const right = ancestor.left + ancestor.width;
  const bottom = ancestor.top + ancestor.height;
  const intersectionLeft = clamp2(hole.left, ancestor.left, right);
  const intersectionTop = clamp2(hole.top, ancestor.top, bottom);
  const intersectionRight = clamp2(hole.right, ancestor.left, right);
  const intersectionBottom = clamp2(hole.bottom, ancestor.top, bottom);
  if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) {
    return [
      { left: 0, top: 0, width: ancestor.width, height: ancestor.height },
      EMPTY_PANEL,
      EMPTY_PANEL,
      EMPTY_PANEL
    ];
  }
  const left = intersectionLeft - ancestor.left;
  const top = intersectionTop - ancestor.top;
  const localRight = intersectionRight - ancestor.left;
  const localBottom = intersectionBottom - ancestor.top;
  return [
    { left: 0, top: 0, width: ancestor.width, height: top },
    { left: 0, top: localBottom, width: ancestor.width, height: ancestor.height - localBottom },
    { left: 0, top, width: left, height: localBottom - top },
    { left: localRight, top, width: ancestor.width - localRight, height: localBottom - top }
  ];
}
function intersectBounds(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  return {
    left,
    top,
    right: Math.max(left, Math.min(first.right, second.right)),
    bottom: Math.max(top, Math.min(first.bottom, second.bottom))
  };
}
function subtractRadius(radius, horizontal, vertical) {
  return { x: Math.max(0, radius.x - horizontal), y: Math.max(0, radius.y - vertical) };
}
function parseCornerRadii(styles, bounds) {
  const width = Math.max(0, bounds.right - bounds.left);
  const height = Math.max(0, bounds.bottom - bounds.top);
  return styles.map((style) => {
    const [horizontal = "0", vertical = horizontal] = style.trim().split(/\s+/);
    return { x: radiusPixels(horizontal, width), y: radiusPixels(vertical, height) };
  });
}
function radiiForIntersection(bounds, shape, radii) {
  return [
    sameEdge(bounds.left, shape.left) && sameEdge(bounds.top, shape.top) ? radii[0] : ZERO_RADIUS,
    sameEdge(bounds.right, shape.right) && sameEdge(bounds.top, shape.top) ? radii[1] : ZERO_RADIUS,
    sameEdge(bounds.right, shape.right) && sameEdge(bounds.bottom, shape.bottom) ? radii[2] : ZERO_RADIUS,
    sameEdge(bounds.left, shape.left) && sameEdge(bounds.bottom, shape.bottom) ? radii[3] : ZERO_RADIUS
  ];
}
function mergeIntersectionRadii(previousBounds, previousRadii, bounds, shape, shapeRadii) {
  const introduced = radiiForIntersection(bounds, shape, shapeRadii);
  return radiiForIntersection(bounds, previousBounds, previousRadii).map((radius, index) => ({
    x: Math.max(radius.x, introduced[index].x),
    y: Math.max(radius.y, introduced[index].y)
  }));
}
function cornerPanels(bounds, radii) {
  return [
    { left: bounds.left, top: bounds.top, width: radii[0].x, height: radii[0].y },
    { left: bounds.right - radii[1].x, top: bounds.top, width: radii[1].x, height: radii[1].y },
    {
      left: bounds.right - radii[2].x,
      top: bounds.bottom - radii[2].y,
      width: radii[2].x,
      height: radii[2].y
    },
    { left: bounds.left, top: bounds.bottom - radii[3].y, width: radii[3].x, height: radii[3].y }
  ];
}
function cornerClipPath(outer, center, startDegrees, endDegrees) {
  const points = [outer];
  for (let step = 0; step <= 8; step += 1) {
    const angle = (startDegrees + (endDegrees - startDegrees) * step / 8) * Math.PI / 180;
    points.push([center[0] + 100 * Math.cos(angle), center[1] + 100 * Math.sin(angle)]);
  }
  return `polygon(${points.map(([x, y]) => `${cleanPercent(x)}% ${cleanPercent(y)}%`).join(",")})`;
}
function radiusPixels(value, extent) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, value.endsWith("%") ? extent * parsed / 100 : parsed);
}
function sameEdge(first, second) {
  return Math.abs(first - second) < 0.01;
}
function cleanPercent(value) {
  if (Math.abs(value) < 1e-4) return 0;
  if (Math.abs(value - 100) < 1e-4) return 100;
  return Math.round(value * 1e3) / 1e3;
}
function clamp2(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
var EMPTY_PANEL = Object.freeze({ left: 0, top: 0, width: 0, height: 0 });
var CORNER_CLIP_PATHS = Object.freeze([
  cornerClipPath([0, 0], [100, 100], -90, -180),
  cornerClipPath([100, 0], [0, 100], -90, 0),
  cornerClipPath([100, 100], [0, 0], 90, 0),
  cornerClipPath([0, 100], [100, 0], 90, 180)
]);

// third-party/air-native-video/guest-js/controls.ts
var VIDEO_CONTROLS_ATTRIBUTE = "data-air-video-controls";
var controlRegistrations = /* @__PURE__ */ new WeakMap();
function registerVideoControls(target) {
  const elements = target instanceof Element ? [target] : [...target];
  for (const element of elements) {
    const existing = controlRegistrations.get(element);
    if (existing) {
      existing.count += 1;
      continue;
    }
    controlRegistrations.set(element, {
      count: 1,
      previousValue: element.getAttribute(VIDEO_CONTROLS_ATTRIBUTE)
    });
    element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, "");
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const element of elements) {
      const existing = controlRegistrations.get(element);
      if (!existing) continue;
      existing.count -= 1;
      if (existing.count > 0) continue;
      controlRegistrations.delete(element);
      if (existing.previousValue === null) element.removeAttribute(VIDEO_CONTROLS_ATTRIBUTE);
      else element.setAttribute(VIDEO_CONTROLS_ATTRIBUTE, existing.previousValue);
    }
  };
}

// third-party/air-native-video/guest-js/native-surface-compositor.ts
function registerVideoControls2(target) {
  const release = registerVideoControls(target);
  refreshActiveOccluders();
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    release();
    refreshActiveOccluders();
  };
}
var BACKGROUND_PROPERTIES = [
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "background-origin",
  "background-clip",
  "background-attachment",
  "background-blend-mode",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style"
];
var nativeCssSurfaceScope = globalThis;
var NativeSurfaceCompositor = class {
  #owner;
  #anchor;
  constructor(owner, anchor) {
    this.#owner = owner;
    this.#anchor = anchor;
    claimSurface(owner, anchor);
  }
  measure(layout, scale) {
    const state = this.#state();
    const surfaceBounds = {
      left: layout.x / scale,
      top: layout.y / scale,
      right: (layout.x + layout.width) / scale,
      bottom: (layout.y + layout.height) / scale
    };
    let bounds = visibleSurfaceBounds(layout, scale, {
      width: window.innerWidth,
      height: window.innerHeight
    });
    let radii = radiiForIntersection(
      bounds,
      surfaceBounds,
      parseCornerRadii(state?.anchorRadii ?? ZERO_RADIUS_STYLES, surfaceBounds)
    );
    if (!state) return {
      bounds,
      width: layout.width / scale,
      height: layout.height / scale,
      radii,
      ancestors: [],
      occluders: []
    };
    const ancestors = state.drilled.map(({ element }) => ({
      element,
      rect: rectFrom(element.getBoundingClientRect())
    }));
    const occluders = state.occluders.map(({ element }) => ({
      element,
      rect: rectFrom(element.getBoundingClientRect())
    }));
    for (let index = 0; index < ancestors.length; index += 1) {
      const ancestor = state.drilled[index];
      const clip = ancestorClip(ancestors[index].rect, ancestor);
      if (!clip) continue;
      const nextBounds = intersectBounds(bounds, clip);
      radii = mergeIntersectionRadii(
        bounds,
        radii,
        nextBounds,
        clip,
        innerCornerRadii(ancestor, ancestors[index].rect)
      );
      bounds = nextBounds;
    }
    return {
      bounds,
      width: layout.width / scale,
      height: layout.height / scale,
      radii,
      ancestors,
      occluders
    };
  }
  commit(frame) {
    const state = this.#state();
    if (!state) return;
    state.lastBounds = frame.bounds;
    for (let index = 0; index < state.drilled.length; index += 1) {
      const ancestor = state.drilled[index];
      const measured = frame.ancestors[index];
      if (measured?.element !== ancestor.element) continue;
      commitAncestor(ancestor, measured.rect, frame.bounds, frame.radii);
    }
    for (let index = 0; index < state.occluders.length; index += 1) {
      const occluder = state.occluders[index];
      const measured = frame.occluders[index];
      if (measured?.element !== occluder.element) continue;
      commitOccluder(occluder, measured.rect, frame.bounds);
    }
    const root = document.documentElement;
    setProperty(root, "--tauri-native-video-left", `${frame.bounds.left}px`);
    setProperty(root, "--tauri-native-video-top", `${frame.bounds.top}px`);
    setProperty(root, "--tauri-native-video-right", `${frame.bounds.right}px`);
    setProperty(root, "--tauri-native-video-bottom", `${frame.bounds.bottom}px`);
    setProperty(root, "--tauri-native-video-width", `${frame.width}px`);
    setProperty(root, "--tauri-native-video-height", `${frame.height}px`);
  }
  /** Re-reads backgrounds and repairs the ancestor chain after DOM changes. */
  refresh() {
    const state = this.#state();
    if (!state) return;
    const elements = collectAncestors(this.#anchor);
    const chainChanged = elements.length !== state.drilled.length || elements.some((element, index) => state.drilled[index]?.element !== element);
    if (chainChanged) rebuildAncestors(state, elements);
    else refreshBackgrounds(state);
    rebuildOccluders(state);
  }
  /**
   * Watches only mutations that can move the anchor or change a drilled
   * background. Unrelated component updates do not enter the layout path.
   */
  observe(onInvalidated) {
    if (typeof MutationObserver === "undefined") return () => void 0;
    const observer = new MutationObserver((records) => {
      const state = this.#state();
      if (!state) return;
      let layoutChanged = false;
      let backgroundChanged = false;
      for (const record of records) {
        if (record.type === "attributes") {
          if (nativeCoordinateMutation(record)) continue;
          if (record.target === this.#anchor || state.drilled.some(({ element }) => element === record.target)) {
            layoutChanged = true;
            backgroundChanged = true;
          }
          continue;
        }
        if (stylesheetMutation(record) || structuralMutation(record, state)) backgroundChanged = true;
        if (state.drilled.some(({ element }) => element === record.target) || mutationContains(record, this.#anchor)) {
          layoutChanged = true;
        }
      }
      if (layoutChanged || backgroundChanged) onInvalidated(backgroundChanged);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style"],
      childList: true,
      subtree: true
    });
    return () => observer.disconnect();
  }
  release() {
    releaseSurface(this.#owner);
  }
  #state() {
    const state = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
    return state?.owner === this.#owner && state.anchor === this.#anchor ? state : void 0;
  }
};
function claimSurface(owner, anchor) {
  const existing = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
  if (existing?.anchor === anchor && existing.layer.isConnected) {
    for (const ancestor of existing.drilled) {
      if (ancestor.element.getAttribute("data-tauri-native-video-hole") === existing.owner) {
        ancestor.element.setAttribute("data-tauri-native-video-hole", owner);
      }
    }
    for (const occluder of existing.occluders) {
      if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) === existing.owner) {
        occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, owner);
      }
      occluder.owner = owner;
    }
    existing.owner = owner;
    existing.style.textContent = holeStyle(owner);
    document.documentElement.dataset.tauriNativeVideoSession = owner;
    return;
  }
  if (existing) releaseSurface(existing.owner);
  removeOrphanedSurfaceNodes();
  const root = document.documentElement;
  const layer = document.createElement("div");
  layer.dataset.tauriNativeVideoBackdrop = "";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    zIndex: "-2147483647",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    contain: "strict"
  });
  const style = document.createElement("style");
  style.dataset.tauriNativeVideoBackdropStyle = "";
  style.textContent = holeStyle(owner);
  layer.append(style);
  document.body.prepend(layer);
  const state = {
    owner,
    anchor,
    layer,
    style,
    drilled: [],
    rootHadClass: root.classList.contains("tauri-native-video"),
    previousSession: root.dataset.tauriNativeVideoSession,
    anchorRadii: readCornerRadiusStyles(anchor),
    occluders: [],
    protectedElements: /* @__PURE__ */ new Set()
  };
  rebuildAncestors(state, collectAncestors(anchor));
  root.dataset.tauriNativeVideoSession = owner;
  root.classList.add("tauri-native-video");
  nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__ = state;
  rebuildOccluders(state);
}
function rebuildAncestors(state, elements) {
  for (const ancestor of state.drilled) restoreAncestor(ancestor, state.owner);
  state.drilled = [];
  for (const element of [...elements].reverse()) {
    const ancestor = createAncestor(element, state.owner);
    state.drilled.unshift(ancestor);
    state.layer.append(ancestor.mirror);
  }
}
function rebuildOccluders(state) {
  for (const occluder of state.occluders) restoreOccluder(occluder);
  state.occluders = [];
  const protectedElements = /* @__PURE__ */ new Set();
  protectPath(state.anchor, protectedElements);
  for (const controls of document.querySelectorAll(`[${VIDEO_CONTROLS_ATTRIBUTE}]`)) {
    protectPath(controls, protectedElements);
  }
  state.protectedElements = protectedElements;
  const visit = (element) => {
    if (element === state.layer || !element.isConnected) return;
    if (element === state.anchor || element.hasAttribute(VIDEO_CONTROLS_ATTRIBUTE)) return;
    if (protectedElements.has(element)) {
      for (const child of element.children) {
        if (child instanceof HTMLElement) visit(child);
      }
      return;
    }
    if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) return;
    state.occluders.push({
      element,
      owner: state.owner,
      active: false,
      previousOwner: element.getAttribute(OCCLUDER_ATTRIBUTE),
      previousImage: inlineProperty(element, MASK_IMAGE_PROPERTY),
      previousPosition: inlineProperty(element, MASK_POSITION_PROPERTY),
      previousSize: inlineProperty(element, MASK_SIZE_PROPERTY)
    });
  };
  for (const child of document.body.children) {
    if (child instanceof HTMLElement) visit(child);
  }
  if (state.lastBounds) {
    for (const occluder of state.occluders) {
      commitOccluder(
        occluder,
        rectFrom(occluder.element.getBoundingClientRect()),
        state.lastBounds
      );
    }
  }
}
function protectPath(element, protectedElements) {
  for (let current = element; current; current = current.parentElement) {
    protectedElements.add(current);
  }
}
function refreshActiveOccluders() {
  const state = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
  if (state) rebuildOccluders(state);
}
function createAncestor(element, owner) {
  const mirror = document.createElement("div");
  mirror.dataset.tauriNativeVideoBackground = "";
  Object.assign(mirror.style, {
    position: "fixed",
    top: "0",
    left: "0",
    overflow: "hidden",
    pointerEvents: "none"
  });
  const ancestor = {
    element,
    previousOwner: element.getAttribute("data-tauri-native-video-hole"),
    mirror,
    panels: [],
    clipsX: false,
    clipsY: false,
    borderLeft: 0,
    borderTop: 0,
    borderRight: 0,
    borderBottom: 0,
    radii: ZERO_RADIUS_STYLES,
    paintsBackground: false
  };
  const background = readBackground(element);
  element.setAttribute("data-tauri-native-video-hole", owner);
  applyBackground(ancestor, background);
  return ancestor;
}
function refreshBackgrounds(state) {
  for (const ancestor of state.drilled) {
    if (ancestor.element.getAttribute("data-tauri-native-video-hole") === state.owner) {
      ancestor.element.removeAttribute("data-tauri-native-video-hole");
    }
  }
  const backgrounds = state.drilled.map(({ element }) => readBackground(element));
  state.anchorRadii = readCornerRadiusStyles(state.anchor);
  for (const ancestor of state.drilled) {
    ancestor.element.setAttribute("data-tauri-native-video-hole", state.owner);
  }
  for (let index = 0; index < state.drilled.length; index += 1) {
    applyBackground(state.drilled[index], backgrounds[index]);
  }
}
function readBackground(element) {
  const computed = getComputedStyle(element);
  return {
    properties: BACKGROUND_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)]),
    borderRadius: computed.borderRadius,
    clipsX: clipsOverflow(computed.overflowX),
    clipsY: clipsOverflow(computed.overflowY),
    borderLeft: cssPixels(computed.borderLeftWidth),
    borderTop: cssPixels(computed.borderTopWidth),
    borderRight: cssPixels(computed.borderRightWidth),
    borderBottom: cssPixels(computed.borderBottomWidth),
    radii: readCornerRadiusStyles(element, computed),
    paintsBackground: hasVisibleBackground(computed)
  };
}
function applyBackground(ancestor, snapshot) {
  ancestor.paintsBackground = snapshot.paintsBackground;
  if (snapshot.paintsBackground && ancestor.panels.length === 0) createBackgroundPanels(ancestor);
  setStyle(ancestor.mirror, "display", snapshot.paintsBackground ? "block" : "none");
  for (const panel of ancestor.panels) {
    for (const [property, value] of snapshot.properties) {
      setStyle(panel.paint, property, value);
    }
    setStyle(panel.paint, "border-color", "transparent");
  }
  setStyle(ancestor.mirror, "border-radius", snapshot.borderRadius);
  ancestor.clipsX = snapshot.clipsX;
  ancestor.clipsY = snapshot.clipsY;
  ancestor.borderLeft = snapshot.borderLeft;
  ancestor.borderTop = snapshot.borderTop;
  ancestor.borderRight = snapshot.borderRight;
  ancestor.borderBottom = snapshot.borderBottom;
  ancestor.radii = snapshot.radii;
}
function commitAncestor(ancestor, rect, hole, radii) {
  if (!ancestor.paintsBackground) return;
  setStyle(ancestor.mirror, "transform", `translate3d(${rect.left}px, ${rect.top}px, 0)`);
  setStyle(ancestor.mirror, "width", `${Math.max(0, rect.width)}px`);
  setStyle(ancestor.mirror, "height", `${Math.max(0, rect.height)}px`);
  const panels = outsidePanels(rect, hole);
  for (let index = 0; index < 4; index += 1) {
    const panel = ancestor.panels[index];
    const region = panels[index];
    setStyle(panel.clip, "transform", `translate3d(${region.left}px, ${region.top}px, 0)`);
    setStyle(panel.clip, "width", `${Math.max(0, region.width)}px`);
    setStyle(panel.clip, "height", `${Math.max(0, region.height)}px`);
    setStyle(panel.paint, "transform", `translate3d(${-region.left}px, ${-region.top}px, 0)`);
    setStyle(panel.paint, "width", `${Math.max(0, rect.width)}px`);
    setStyle(panel.paint, "height", `${Math.max(0, rect.height)}px`);
  }
  const corners = cornerPanels(hole, radii);
  for (let index = 0; index < 4; index += 1) {
    const panel = ancestor.panels[index + 4];
    const region = corners[index];
    const localLeft = region.left - rect.left;
    const localTop = region.top - rect.top;
    setStyle(panel.clip, "transform", `translate3d(${localLeft}px, ${localTop}px, 0)`);
    setStyle(panel.clip, "width", `${Math.max(0, region.width)}px`);
    setStyle(panel.clip, "height", `${Math.max(0, region.height)}px`);
    setStyle(panel.paint, "transform", `translate3d(${-localLeft}px, ${-localTop}px, 0)`);
    setStyle(panel.paint, "width", `${Math.max(0, rect.width)}px`);
    setStyle(panel.paint, "height", `${Math.max(0, rect.height)}px`);
  }
}
function commitOccluder(occluder, rect, hole) {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const left = Math.max(rect.left, hole.left);
  const top = Math.max(rect.top, hole.top);
  const clippedRight = Math.min(right, hole.right);
  const clippedBottom = Math.min(bottom, hole.bottom);
  if (rect.width <= 0 || rect.height <= 0 || clippedRight <= left || clippedBottom <= top) {
    restoreOccluder(occluder);
    return;
  }
  let image = "";
  let position = "";
  let size = "";
  for (const panel of outsidePanels(rect, hole)) {
    if (panel.width <= 0 || panel.height <= 0) continue;
    const separator = image ? "," : "";
    image += `${separator}linear-gradient(#000, #000)`;
    position += `${separator}${panel.left}px ${panel.top}px`;
    size += `${separator}${panel.width}px ${panel.height}px`;
  }
  if (!image) {
    image = "linear-gradient(transparent, transparent)";
    position = "0 0";
    size = "100% 100%";
  }
  if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) !== occluder.owner) {
    occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, occluder.owner);
  }
  occluder.active = true;
  setProperty(occluder.element, MASK_IMAGE_PROPERTY, image, "important");
  setProperty(occluder.element, MASK_POSITION_PROPERTY, position, "important");
  setProperty(occluder.element, MASK_SIZE_PROPERTY, size, "important");
}
function createBackgroundPanels(ancestor) {
  ancestor.panels = Array.from({ length: 8 }, (_, index) => {
    const clip = document.createElement("div");
    const paint = document.createElement("div");
    Object.assign(clip.style, { position: "absolute", overflow: "hidden" });
    Object.assign(paint.style, { position: "absolute", top: "0", left: "0" });
    if (index >= 4) clip.style.clipPath = CORNER_CLIP_PATHS[index - 4];
    clip.append(paint);
    ancestor.mirror.append(clip);
    return { clip, paint };
  });
}
function releaseSurface(owner) {
  const state = nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
  if (!state || state.owner !== owner) return;
  for (const ancestor of state.drilled) restoreAncestor(ancestor, owner);
  for (const occluder of state.occluders) restoreOccluder(occluder);
  state.layer.remove();
  const root = document.documentElement;
  if (state.previousSession === void 0) delete root.dataset.tauriNativeVideoSession;
  else root.dataset.tauriNativeVideoSession = state.previousSession;
  if (!state.rootHadClass) root.classList.remove("tauri-native-video");
  for (const property of NATIVE_VIDEO_CSS_PROPERTIES) root.style.removeProperty(property);
  delete nativeCssSurfaceScope.__TAURI_VIDEO_NATIVE_CSS_SURFACE__;
}
function restoreAncestor(ancestor, owner) {
  if (ancestor.element.getAttribute("data-tauri-native-video-hole") === owner) {
    if (ancestor.previousOwner === null) ancestor.element.removeAttribute("data-tauri-native-video-hole");
    else ancestor.element.setAttribute("data-tauri-native-video-hole", ancestor.previousOwner);
  }
  ancestor.mirror.remove();
}
function restoreOccluder(occluder) {
  if (!occluder.active) return;
  if (occluder.element.getAttribute(OCCLUDER_ATTRIBUTE) === occluder.owner) {
    if (occluder.previousOwner === null) occluder.element.removeAttribute(OCCLUDER_ATTRIBUTE);
    else occluder.element.setAttribute(OCCLUDER_ATTRIBUTE, occluder.previousOwner);
  }
  restoreInlineProperty(occluder.element, MASK_IMAGE_PROPERTY, occluder.previousImage);
  restoreInlineProperty(occluder.element, MASK_POSITION_PROPERTY, occluder.previousPosition);
  restoreInlineProperty(occluder.element, MASK_SIZE_PROPERTY, occluder.previousSize);
  occluder.active = false;
}
function collectAncestors(anchor) {
  const elements = [];
  for (let element = anchor.parentElement; element; element = element.parentElement) {
    elements.push(element);
  }
  return elements;
}
function removeOrphanedSurfaceNodes() {
  for (const orphan of document.querySelectorAll("[data-tauri-native-video-backdrop]")) orphan.remove();
  for (const orphan of document.querySelectorAll("[data-tauri-native-video-hole]")) {
    orphan.removeAttribute("data-tauri-native-video-hole");
  }
}
function holeStyle(owner) {
  return `
    [data-tauri-native-video-hole="${owner}"] { background: transparent !important; }
    body[data-tauri-native-video-hole="${owner}"] { position: relative !important; isolation: isolate !important; }
    [${OCCLUDER_ATTRIBUTE}="${owner}"] {
      -webkit-mask-image: var(${MASK_IMAGE_PROPERTY}) !important;
      -webkit-mask-position: var(${MASK_POSITION_PROPERTY}) !important;
      -webkit-mask-size: var(${MASK_SIZE_PROPERTY}) !important;
      -webkit-mask-repeat: no-repeat !important;
      -webkit-mask-origin: border-box !important;
      -webkit-mask-clip: border-box !important;
      -webkit-mask-composite: source-over !important;
      mask-image: var(${MASK_IMAGE_PROPERTY}) !important;
      mask-position: var(${MASK_POSITION_PROPERTY}) !important;
      mask-size: var(${MASK_SIZE_PROPERTY}) !important;
      mask-repeat: no-repeat !important;
      mask-origin: border-box !important;
      mask-clip: border-box !important;
      mask-composite: add !important;
      mask-mode: alpha !important;
    }
  `;
}
function rectFrom(rect) {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
function readCornerRadiusStyles(element, computed = getComputedStyle(element)) {
  return [
    computed.borderTopLeftRadius,
    computed.borderTopRightRadius,
    computed.borderBottomRightRadius,
    computed.borderBottomLeftRadius
  ];
}
function stylesheetMutation(record) {
  if (record.target instanceof HTMLStyleElement) return true;
  return someChangedNode(record, (node) => node instanceof HTMLStyleElement || node instanceof HTMLLinkElement && node.rel === "stylesheet");
}
function structuralMutation(record, state) {
  if (record.type !== "childList") return false;
  if (record.target instanceof HTMLElement && state.protectedElements.has(record.target)) return true;
  return someChangedNode(record, (node) => node === state.anchor || node instanceof Element && (node.contains(state.anchor) || node.matches(`[${VIDEO_CONTROLS_ATTRIBUTE}]`) || Boolean(node.querySelector(`[${VIDEO_CONTROLS_ATTRIBUTE}]`))));
}
function nativeCoordinateMutation(record) {
  if (record.target !== document.documentElement || record.attributeName !== "style") return false;
  return withoutNativeCoordinates(record.oldValue ?? "") === withoutNativeCoordinates(document.documentElement.getAttribute("style") ?? "");
}
function withoutNativeCoordinates(style) {
  return style.replace(/--tauri-native-video-(?:left|top|right|bottom|width|height)\s*:[^;]*(?:;|$)/gi, "").replace(/\s+/g, "");
}
function mutationContains(record, anchor) {
  if (record.target instanceof Node && record.target.contains(anchor)) return true;
  return someChangedNode(record, (node) => node === anchor || node instanceof Node && node.contains(anchor));
}
function someChangedNode(record, predicate) {
  for (const node of record.addedNodes) if (predicate(node)) return true;
  for (const node of record.removedNodes) if (predicate(node)) return true;
  return false;
}
function setStyle(element, property, value) {
  let values = committedStyleValues.get(element);
  if (!values) {
    values = /* @__PURE__ */ new Map();
    committedStyleValues.set(element, values);
  }
  if (values.get(property) === value) return;
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  values.set(property, value);
}
function setProperty(element, property, value, priority = "") {
  if (element.style.getPropertyValue(property) !== value || priority && element.style.getPropertyPriority(property) !== priority) {
    element.style.setProperty(property, value, priority);
  }
}
function inlineProperty(element, property) {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property)
  };
}
function restoreInlineProperty(element, property, snapshot) {
  if (snapshot.value) element.style.setProperty(property, snapshot.value, snapshot.priority);
  else element.style.removeProperty(property);
}
function ancestorClip(rect, ancestor) {
  if (!ancestor.clipsX && !ancestor.clipsY) return void 0;
  return {
    left: ancestor.clipsX ? rect.left + ancestor.borderLeft : Number.NEGATIVE_INFINITY,
    top: ancestor.clipsY ? rect.top + ancestor.borderTop : Number.NEGATIVE_INFINITY,
    right: ancestor.clipsX ? rect.left + rect.width - ancestor.borderRight : Number.POSITIVE_INFINITY,
    bottom: ancestor.clipsY ? rect.top + rect.height - ancestor.borderBottom : Number.POSITIVE_INFINITY
  };
}
function innerCornerRadii(ancestor, rect) {
  if (!ancestor.clipsX || !ancestor.clipsY) return ZERO_RADII;
  const radii = parseCornerRadii(ancestor.radii, {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height
  });
  return [
    subtractRadius(radii[0], ancestor.borderLeft, ancestor.borderTop),
    subtractRadius(radii[1], ancestor.borderRight, ancestor.borderTop),
    subtractRadius(radii[2], ancestor.borderRight, ancestor.borderBottom),
    subtractRadius(radii[3], ancestor.borderLeft, ancestor.borderBottom)
  ];
}
function clipsOverflow(value) {
  return value === "hidden" || value === "clip" || value === "scroll" || value === "auto";
}
function hasVisibleBackground(computed) {
  const image = computed.backgroundImage.trim();
  if (image && image !== "none") return true;
  const color = computed.backgroundColor.trim().toLowerCase();
  if (!color || color === "transparent") return false;
  if (/\/\s*0(?:\.0+)?\s*\)$/.test(color)) return false;
  if (/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color)) return false;
  return true;
}
function cssPixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
var NATIVE_VIDEO_CSS_PROPERTIES = [
  "--tauri-native-video-left",
  "--tauri-native-video-top",
  "--tauri-native-video-right",
  "--tauri-native-video-bottom",
  "--tauri-native-video-width",
  "--tauri-native-video-height"
];
var committedStyleValues = /* @__PURE__ */ new WeakMap();
var OCCLUDER_ATTRIBUTE = "data-tauri-native-video-occluder";
var MASK_IMAGE_PROPERTY = "--tauri-native-video-mask-image";
var MASK_POSITION_PROPERTY = "--tauri-native-video-mask-position";
var MASK_SIZE_PROPERTY = "--tauri-native-video-mask-size";

// third-party/air-native-video/guest-js/runtime-errors.ts
var LeanNativeVideoError = class extends Error {
  _tag;
  constructor(tag, details) {
    super(details.message);
    this.name = tag;
    this._tag = tag;
    Object.assign(this, details);
    Object.defineProperty(this, Symbol.for("@get-air/video/VideoPlayerError"), {
      value: true,
      enumerable: false
    });
  }
};
var factories = {
  protocolMismatch: async (details) => new LeanNativeVideoError(
    "VideoNativeProtocolMismatchError",
    details
  ),
  featureUnavailable: async (details) => new LeanNativeVideoError(
    "VideoFeatureUnavailableError",
    details
  )
};
function nativeProtocolMismatchError(details) {
  return factories.protocolMismatch(details);
}
function nativeFeatureUnavailableError(details) {
  return factories.featureUnavailable(details);
}

// third-party/air-native-video/guest-js/protocol.ts
var COMMAND = "plugin:video|";
var TAURI_VIDEO_PROTOCOL_VERSION = 1;
var TAURI_VIDEO_PACKAGE_NAME = "@get-air/video-tauri";
var TAURI_VIDEO_PACKAGE_VERSION = "0.4.0";
var verifiedProtocol;
async function getTauriVideoDiagnostics() {
  const native = decodeNativeDiagnostics(
    await invoke(`${COMMAND}native_diagnostics`)
  );
  return {
    ...native,
    packageName: TAURI_VIDEO_PACKAGE_NAME,
    packageVersion: TAURI_VIDEO_PACKAGE_VERSION
  };
}
function verifyTauriVideoProtocol() {
  if (verifiedProtocol) return verifiedProtocol;
  const attempt = verifyTauriVideoProtocolUncached().catch((error) => {
    if (verifiedProtocol === attempt) verifiedProtocol = void 0;
    throw error;
  });
  verifiedProtocol = attempt;
  return attempt;
}
async function verifyTauriVideoProtocolUncached() {
  let diagnostics;
  try {
    diagnostics = await getTauriVideoDiagnostics();
  } catch (cause) {
    throw await protocolMismatch({
      message: `${TAURI_VIDEO_PACKAGE_NAME}@${TAURI_VIDEO_PACKAGE_VERSION} could not verify the native video protocol. Update @get-air/video-tauri and tauri-plugin-video to a compatible pair.`,
      cause: errorMessage(cause)
    });
  }
  if (diagnostics.protocolVersion !== TAURI_VIDEO_PROTOCOL_VERSION) {
    throw await protocolMismatch({
      actualProtocolVersion: diagnostics.protocolVersion,
      crateName: diagnostics.crateName,
      crateVersion: diagnostics.crateVersion,
      message: `${TAURI_VIDEO_PACKAGE_NAME}@${TAURI_VIDEO_PACKAGE_VERSION} expects native video protocol ${TAURI_VIDEO_PROTOCOL_VERSION}, but ${diagnostics.crateName}@${diagnostics.crateVersion} reports ${diagnostics.protocolVersion}. Update the npm package and Rust crate to a compatible pair.`
    });
  }
  return diagnostics;
}
async function protocolMismatch(details) {
  return await nativeProtocolMismatchError({
    expectedProtocolVersion: TAURI_VIDEO_PROTOCOL_VERSION,
    packageName: TAURI_VIDEO_PACKAGE_NAME,
    packageVersion: TAURI_VIDEO_PACKAGE_VERSION,
    ...details
  });
}
function decodeNativeDiagnostics(value) {
  if (!isRecord(value) || !Number.isInteger(value.protocolVersion) || typeof value.crateName !== "string" || value.crateName.length === 0 || typeof value.crateVersion !== "string" || value.crateVersion.length === 0) {
    throw new TypeError("native_diagnostics returned an invalid response");
  }
  return {
    protocolVersion: value.protocolVersion,
    crateName: value.crateName,
    crateVersion: value.crateVersion
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    for (const key of ["message", "error", "detail", "cause"]) {
      if (key in error) {
        const value = error[key];
        if (value === error) continue;
        const message = errorMessage(value);
        if (message && message !== "[object Object]") return message;
      }
    }
    try {
      return JSON.stringify(error);
    } catch {
    }
  }
  return String(error);
}

// third-party/air-native-video/guest-js/index.ts
var COMMAND2 = "plugin:video|";
function webView2TextureStream() {
  const scope = globalThis;
  const getTextureStream = scope.chrome?.webview?.getTextureStream;
  return typeof getTextureStream === "function" ? { getTextureStream: getTextureStream.bind(scope.chrome?.webview) } : void 0;
}
async function attachTauriBackend(element, options) {
  if (!(element instanceof HTMLVideoElement)) {
    throw new TypeError("attachVideo requires an HTMLVideoElement");
  }
  if (!/Android|Linux|Windows/i.test(navigator.userAgent)) {
    throw new Error("Native video playback is currently supported only on Android, Linux, and Windows");
  }
  await verifyTauriVideoProtocol();
  const controller = new NativeSurfaceVideoController(element, options);
  try {
    await controller.start();
    return controller;
  } catch (error) {
    await controller.destroy().catch(() => void 0);
    throw error;
  }
}
var nativeSurfaceSequence = 0;
var nativeMediaElementStates = /* @__PURE__ */ new WeakMap();
var NativeSurfaceVideoController = class extends EventTarget {
  element;
  #options;
  #snapshot;
  #media = { seekable: true, live: false, tracks: [], chapters: [] };
  #timer;
  #visibilityObserver;
  #intersectionVisible = true;
  #suspendedForVisibility = false;
  #requestedPlaying;
  #visibilityMutation = Promise.resolve();
  #resize;
  #layoutFrame;
  #layoutInFlight = false;
  #layoutDirty = false;
  #scrollTargets = [];
  #compositor;
  #textureStream;
  #stopCompositorObserver;
  #controlCleanups = /* @__PURE__ */ new Set();
  #lastLayout;
  #pendingSeek;
  #polling = false;
  #waiting = false;
  #destroyed = false;
  #volume = 1;
  #rate = 1;
  #trackChanges = 0;
  #metadataReady = false;
  #endedNotified = false;
  #muted = false;
  #videoFit = "fit";
  #videoZoom = 1;
  #originalObjectFit;
  #originalTransform;
  #originalTransformOrigin;
  #removeAbortListener;
  #platform = nativePlatform();
  #capabilities;
  #sessionKey = globalThis.crypto?.randomUUID?.() ?? `native-${Date.now()}-${++nativeSurfaceSequence}`;
  #sessionId = `${this.#platform}-native-surface-${this.#sessionKey}`;
  constructor(element, options) {
    super();
    this.element = element;
    this.#options = options;
    const initialVolume = Number(element.volume);
    this.#volume = Number.isFinite(initialVolume) ? Math.min(1, Math.max(0, initialVolume)) : 1;
    this.#muted = Boolean(element.muted);
    this.#originalObjectFit = element.style.objectFit;
    this.#originalTransform = element.style.transform;
    this.#originalTransformOrigin = element.style.transformOrigin;
    this.#requestedPlaying = options.autoplay ?? false;
  }
  get sessionId() {
    return this.#sessionId;
  }
  get capabilities() {
    if (this.#capabilities) return this.#capabilities;
    const completeVideoGeometry = this.#supportsCompleteVideoGeometry();
    return this.#capabilities = {
      backend: "tauri",
      containers: "platform",
      codecs: "platform",
      drm: "platform",
      hdr: "platform",
      playbackRate: this.#platform === "linux",
      volume: true,
      // GStreamer can preserve or stretch the aspect ratio, but its current
      // sinks cannot implement the common API's crop-to-cover mode.
      videoFit: completeVideoGeometry,
      videoZoom: completeVideoGeometry,
      audioTrackSelection: true,
      subtitleTrackSelection: true,
      customHeaders: true,
      frameAccurateSeeking: false
    };
  }
  get media() {
    return this.#media;
  }
  get tracks() {
    return this.#media.tracks;
  }
  on(type, listener, options) {
    const eventListener = listener;
    this.addEventListener(type, eventListener, options);
    return () => this.removeEventListener(type, eventListener, options);
  }
  async start() {
    if (this.#options.signal?.aborted) throw this.#options.signal.reason;
    this.#claimMediaElement();
    this.#claimCssSurface();
    if (this.#options.controlRegions) this.registerControls(this.#options.controlRegions);
    let textureStream;
    if (this.#platform === "windows") {
      const api = webView2TextureStream();
      if (!api) {
        throw new Error("This WebView2 runtime does not expose GPU texture streams");
      }
      const streamId = await invoke(`${COMMAND2}native_prepare_texture_stream`, {
        sessionKey: this.#sessionKey
      });
      textureStream = api.getTextureStream(streamId);
    }
    this.element.style.visibility = "hidden";
    const source = typeof this.#options.source === "string" ? { uri: this.#options.source } : this.#options.source;
    const requestedAutoplay = this.#options.autoplay ?? false;
    const textureBootstrap = textureStream !== void 0 && !requestedAutoplay;
    const { layout, frame } = this.#measureLayout();
    this.#lastLayout = layout;
    try {
      this.#snapshot = await invoke(`${COMMAND2}native_open`, {
        payload: {
          protocolVersion: TAURI_VIDEO_PROTOCOL_VERSION,
          packageVersion: TAURI_VIDEO_PACKAGE_VERSION,
          sessionKey: this.#sessionKey,
          ...source,
          ...layout,
          autoplay: textureStream !== void 0 || requestedAutoplay,
          volume: textureBootstrap ? 0 : this.#volume,
          muted: this.#muted,
          ...nativeOpenSettings(this.#options, this.#platform)
        }
      });
    } catch (error) {
      await invoke(`${COMMAND2}native_close`, {
        payload: { sessionKey: this.#sessionKey }
      }).catch(() => void 0);
      if (this.#removeMediaFacade()) this.element.style.removeProperty("visibility");
      this.#releaseCssSurface();
      throw error;
    }
    if (!this.#ownsMediaElement()) {
      await invoke(`${COMMAND2}native_close`, {
        payload: { sessionKey: this.#sessionKey }
      }).catch(() => void 0);
      throw new DOMException("native video controller was superseded", "AbortError");
    }
    if (textureStream) {
      this.#textureStream = await textureStream;
      this.element.srcObject = this.#textureStream;
      this.element.autoplay = true;
      this.element.playsInline = true;
      this.#applyWindowsVideoGeometry();
      this.element.style.visibility = "visible";
      this.#playWindowsTextureStream();
      if (textureBootstrap) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.#snapshot = await this.#control("pause");
        this.#snapshot = await this.#control(
          "seek",
          typeof this.#options.source === "string" ? 0 : this.#options.source.startPositionSeconds ?? 0
        );
        this.#snapshot = await this.#control("volume", this.#muted ? 0 : this.#volume);
      }
    }
    this.#publishCssLayout(frame);
    this.#updateMedia(this.#snapshot);
    this.#installMediaFacade();
    this.#publishMetadata();
    this.element.dispatchEvent(new Event("progress"));
    if (this.#snapshot.playing) {
      this.element.dispatchEvent(new Event("play"));
      this.element.dispatchEvent(new Event("playing"));
    }
    if (this.#platform !== "windows") {
      this.#resize = new ResizeObserver(() => this.#requestLayout());
      this.#resize.observe(this.element);
      this.#stopCompositorObserver = this.#compositor?.observe((backgroundChanged) => {
        if (backgroundChanged) this.#compositor?.refresh();
        this.#requestLayout();
      });
      this.#scrollTargets = nativeScrollTargets(this.element);
      for (const target of this.#scrollTargets) {
        target.addEventListener("scroll", this.#handleViewportChange, { capture: true, passive: true });
      }
      window.addEventListener("wheel", this.#handleViewportChange, { capture: true, passive: true });
      window.addEventListener("resize", this.#handleViewportChange, { passive: true });
      window.visualViewport?.addEventListener("scroll", this.#handleViewportChange, { passive: true });
      window.visualViewport?.addEventListener("resize", this.#handleViewportChange, { passive: true });
      this.#requestLayout();
    }
    this.#startPolling();
    if (this.#options.suspendWhenHidden ?? true) {
      this.#visibilityObserver = new IntersectionObserver(([entry]) => {
        this.#intersectionVisible = entry.isIntersecting;
        this.#queueVisibilitySync();
      });
      this.#visibilityObserver.observe(this.element);
      document.addEventListener("visibilitychange", this.#handleDocumentVisibility);
      this.#queueVisibilitySync();
    }
    if (this.#options.signal?.aborted) throw this.#options.signal.reason;
    this.#bindAbortSignal();
  }
  async play() {
    this.#requestedPlaying = true;
    this.#playWindowsTextureStream();
    if (this.#suspendedForVisibility) {
      this.element.dispatchEvent(new Event("play"));
      return;
    }
    this.#acceptSnapshot(await this.#control("play"));
    this.#stopPolling();
    this.#startPolling();
    this.element.dispatchEvent(new Event("play"));
    if (this.#snapshot) this.#publishBuffering(this.#snapshot, true);
  }
  pause() {
    this.#requestedPlaying = false;
    this.#runDetached(this.#control("pause").then((snapshot) => {
      this.#acceptSnapshot(snapshot);
      this.element.dispatchEvent(new Event("pause"));
    }));
  }
  async setVolume(volume) {
    const clamped = Math.min(1, Math.max(0, volume));
    this.#volume = clamped;
    this.#acceptSnapshot(await this.#control("volume", this.#muted ? 0 : clamped));
    this.element.dispatchEvent(new Event("volumechange"));
  }
  async setPlaybackRate(rate) {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new RangeError("Invalid playback rate");
    if (this.#platform !== "linux") return unsupported("playbackRate", "Native rate control is Linux-only");
    const previous = this.#rate;
    this.#rate = rate;
    try {
      this.#acceptSnapshot(await this.#control("rate", rate));
    } catch (error) {
      if (this.#rate === rate) this.#rate = previous;
      throw error;
    }
    this.element.dispatchEvent(new Event("ratechange"));
  }
  async seek(positionSeconds) {
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
      throw new RangeError("positionSeconds must be a finite, non-negative number");
    }
    if (this.#snapshot?.seekable === false) {
      return unsupported("seeking", "The active media does not expose a seekable window");
    }
    const wasPlaying = this.#snapshot?.playing ?? false;
    const minimum = this.#snapshot?.seekableStartSeconds ?? 0;
    const maximum = this.#snapshot?.seekableEndSeconds ?? (this.#snapshot?.live ? Number.POSITIVE_INFINITY : this.#snapshot?.durationSeconds || Number.POSITIVE_INFINITY);
    const target = Math.max(minimum, Math.min(maximum, positionSeconds));
    this.#pendingSeek = { target, deadline: performance.now() + 3e4 };
    if (this.#snapshot) this.#snapshot.currentTimeSeconds = target;
    this.element.dispatchEvent(new Event("seeking"));
    this.dispatchEvent(new CustomEvent("timeupdate", {
      detail: { currentTime: target }
    }));
    this.element.dispatchEvent(new Event("timeupdate"));
    try {
      const snapshot = this.#acceptSnapshot(await this.#control("seek", target));
      this.#updateMedia(snapshot);
      if (wasPlaying && !snapshot.playing) {
        this.element.dispatchEvent(new Event("pause"));
      }
    } catch (error) {
      this.#pendingSeek = void 0;
      throw error;
    } finally {
      this.element.dispatchEvent(new Event("seeked"));
    }
  }
  async selectTrack(kind, trackId) {
    if (trackId !== void 0) {
      const selected = this.#snapshot?.tracks.find(
        (track) => track.id === trackId && track.kind === kind
      );
      if (!selected) throw new Error(`Unknown ${kind} track: ${trackId}`);
      if (selected.selected && this.#trackChanges === 0) return;
      this.#trackChanges++;
      try {
        this.#acceptSnapshot(await this.#control("track", 0, selected.index));
      } finally {
        this.#trackChanges--;
      }
    } else if (kind === "subtitle") {
      const active = this.#media.tracks.find((track) => track.kind === kind && track.selected);
      if (active) {
        this.#trackChanges++;
        try {
          this.#acceptSnapshot(await this.#control("deselectTrack", 0, active.streamIndex));
        } finally {
          this.#trackChanges--;
        }
      }
    } else {
      return unsupported(
        `${kind}TrackDisable`,
        `The Tauri native engines cannot disable the selected ${kind} track through the common API`
      );
    }
    for (const track of this.#media.tracks) {
      if (track.kind === kind) track.selected = track.id === trackId;
    }
    this.dispatchEvent(new CustomEvent("trackchange", { detail: { kind, trackId } }));
  }
  async stats() {
    const snapshot = await this.#readStats();
    this.#acceptSnapshot(snapshot);
    return {
      sessionId: this.sessionId,
      encodedBytesBuffered: snapshot.encodedBytesBuffered ?? 0,
      bufferedAheadSeconds: Math.max(0, snapshot.bufferedSeconds - snapshot.currentTimeSeconds),
      hardwareBackend: snapshot.hardwareBackend || (this.#platform === "android" ? "android-mediaplayer-surface" : "gstreamer-va-gl-gtk"),
      decodedFrameCopies: 0,
      droppedFrames: snapshot.droppedFrames ?? 0,
      averageFrameProcessingUs: snapshot.averageFrameProcessingUs,
      videoCodec: snapshot.tracks.find((track) => track.kind === "video" && track.selected)?.codec,
      audioCodec: snapshot.tracks.find((track) => track.kind === "audio" && track.selected)?.codec,
      visible: true,
      playing: snapshot.playing
    };
  }
  bufferedAhead() {
    if (!this.#snapshot) return 0;
    return Math.max(0, this.#snapshot.bufferedSeconds - this.#snapshot.currentTimeSeconds);
  }
  playbackQuality() {
    return {
      presentedFrames: this.#snapshot?.presentedFrames ?? 0,
      mediaTimeSeconds: this.#snapshot?.currentTimeSeconds,
      measuredFps: this.#snapshot?.measuredFps ?? 0,
      totalVideoFrames: (this.#snapshot?.presentedFrames ?? 0) + (this.#snapshot?.droppedFrames ?? 0),
      droppedVideoFrames: this.#snapshot?.droppedFrames ?? 0,
      droppedFramePercent: this.#snapshot?.presentedFrames ? 100 * (this.#snapshot.droppedFrames ?? 0) / (this.#snapshot.presentedFrames + (this.#snapshot.droppedFrames ?? 0)) : 0
    };
  }
  refreshLayout() {
    this.#requestLayout();
  }
  async setVideoFit(mode) {
    if (mode === "cover" && !this.#supportsCompleteVideoGeometry()) {
      return unsupported(
        "videoFit",
        "The active GStreamer sink cannot crop video to the common cover fit mode"
      );
    }
    this.#acceptSnapshot(await this.#control(mode === "cover" ? "crop" : mode));
    this.#videoFit = mode;
    this.#applyWindowsVideoGeometry();
  }
  async setVideoZoom(scale) {
    if (!this.#supportsCompleteVideoGeometry()) {
      return unsupported(
        "videoZoom",
        "The active GStreamer sink does not expose portable video-surface zoom"
      );
    }
    const clamped = Math.min(2, Math.max(1, scale));
    this.#acceptSnapshot(await this.#control("zoom", clamped));
    this.#videoZoom = clamped;
    this.#applyWindowsVideoGeometry();
  }
  registerControls(target) {
    const unregister = registerVideoControls2(target);
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      this.#controlCleanups.delete(cleanup);
      unregister();
    };
    this.#controlCleanups.add(cleanup);
    if (this.#snapshot) this.#requestLayout();
    return cleanup;
  }
  async destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#removeAbortListener?.();
    this.#removeAbortListener = void 0;
    this.#stopPolling();
    this.#visibilityObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.#handleDocumentVisibility);
    if (this.#layoutFrame !== void 0) cancelAnimationFrame(this.#layoutFrame);
    this.#resize?.disconnect();
    this.#stopCompositorObserver?.();
    this.#stopCompositorObserver = void 0;
    for (const target of this.#scrollTargets) {
      target.removeEventListener("scroll", this.#handleViewportChange, true);
    }
    this.#scrollTargets = [];
    window.removeEventListener("wheel", this.#handleViewportChange, true);
    window.removeEventListener("resize", this.#handleViewportChange);
    window.visualViewport?.removeEventListener("scroll", this.#handleViewportChange);
    window.visualViewport?.removeEventListener("resize", this.#handleViewportChange);
    for (const cleanup of this.#controlCleanups) cleanup();
    for (const track of this.#textureStream?.getTracks() ?? []) track.stop();
    this.#textureStream = void 0;
    this.element.srcObject = null;
    await invoke(`${COMMAND2}native_close`, {
      payload: { sessionKey: this.#sessionKey }
    }).catch(() => void 0);
    if (this.#removeMediaFacade()) {
      this.element.volume = this.#volume;
      this.element.muted = this.#muted;
      this.element.style.removeProperty("visibility");
      this.element.style.objectFit = this.#originalObjectFit;
      this.element.style.transform = this.#originalTransform;
      this.element.style.transformOrigin = this.#originalTransformOrigin;
    }
    this.#releaseCssSurface();
  }
  #control(action, value = 0, index = -1) {
    return invoke(`${COMMAND2}native_control`, {
      // Session ownership prevents delayed cleanup from a prior React render
      // from controlling the replacement native player.
      payload: { sessionKey: this.#sessionKey, action, value, index }
    });
  }
  #readStats() {
    return invoke(`${COMMAND2}native_stats`, { payload: { sessionKey: this.#sessionKey } });
  }
  async #poll() {
    if (this.#destroyed || this.#polling || this.#suspendedForVisibility) return;
    this.#requestLayout();
    this.#polling = true;
    try {
      const previous = this.#snapshot;
      const snapshot = await this.#readStats();
      if (this.#destroyed) return;
      const visibleSnapshot = this.#acceptSnapshot(snapshot);
      this.#updateMedia(visibleSnapshot);
      this.#publishMetadata();
      this.dispatchEvent(new CustomEvent("timeupdate", {
        detail: { currentTime: visibleSnapshot.currentTimeSeconds }
      }));
      this.dispatchEvent(new CustomEvent("bufferprogress", {
        detail: { bufferedAhead: this.bufferedAhead() }
      }));
      this.element.dispatchEvent(new Event("timeupdate"));
      if (previous?.bufferedSeconds !== snapshot.bufferedSeconds) {
        this.element.dispatchEvent(new Event("progress"));
      }
      if (previous?.durationSeconds !== snapshot.durationSeconds || previous?.live !== snapshot.live) {
        this.element.dispatchEvent(new Event("durationchange"));
      }
      if (previous?.playing !== snapshot.playing) {
        this.element.dispatchEvent(new Event(snapshot.playing ? "play" : "pause"));
      }
      this.#publishBuffering(snapshot, previous?.playing !== snapshot.playing && snapshot.playing);
      const isEnded = isNativeEnded(snapshot);
      if (!this.#endedNotified && isEnded) {
        this.#endedNotified = true;
        this.#requestedPlaying = false;
        this.element.dispatchEvent(new Event("ended"));
      }
    } catch (error) {
      if (!this.#destroyed) this.#publishError(error);
    } finally {
      this.#polling = false;
    }
  }
  #publishBuffering(snapshot, playStarted = false) {
    const waiting = snapshot.playing && snapshot.buffering === true;
    if (waiting !== this.#waiting) {
      this.#waiting = waiting;
      if (waiting) this.element.dispatchEvent(new Event("waiting"));
      else if (snapshot.playing) this.element.dispatchEvent(new Event("playing"));
    } else if (playStarted && snapshot.playing && !waiting) {
      this.element.dispatchEvent(new Event("playing"));
    }
  }
  #publishMetadata() {
    if (this.#metadataReady || !this.#snapshot?.videoWidth) return;
    this.#metadataReady = true;
    this.element.dispatchEvent(new Event("loadedmetadata"));
    this.element.dispatchEvent(new Event("durationchange"));
    if (!this.#snapshot.buffering) this.element.dispatchEvent(new Event("canplay"));
  }
  #updateMedia(snapshot) {
    const live = snapshot.live ?? false;
    this.#media.durationSeconds = live ? void 0 : snapshot.durationSeconds;
    this.#media.seekable = snapshot.seekable ?? !live;
    this.#media.seekableStartSeconds = this.#media.seekable ? snapshot.seekableStartSeconds ?? 0 : void 0;
    this.#media.seekableEndSeconds = this.#media.seekable ? snapshot.seekableEndSeconds ?? (live ? void 0 : snapshot.durationSeconds) : void 0;
    this.#media.live = live;
    this.#media.container = snapshot.container ?? "unknown";
    const tracksChanged = snapshot.tracks.length !== this.#media.tracks.length || snapshot.tracks.some((track, index) => {
      const cached = this.#media.tracks[index];
      return !cached || cached.id !== track.id || cached.kind !== track.kind || cached.streamIndex !== track.index || cached.codec !== track.codec || cached.label !== track.label || cached.language !== track.language || cached.selected !== track.selected || track.kind === "video" && (cached.width !== snapshot.videoWidth || cached.height !== snapshot.videoHeight);
    });
    if (tracksChanged) {
      this.#media.tracks = snapshot.tracks.map((track) => ({
        id: track.id,
        kind: track.kind,
        streamIndex: track.index,
        codec: track.codec,
        caps: track.codec,
        label: track.label,
        language: track.language,
        selected: track.selected,
        default: false,
        forced: false,
        width: track.kind === "video" ? snapshot.videoWidth : void 0,
        height: track.kind === "video" ? snapshot.videoHeight : void 0
      }));
    }
  }
  #acceptSnapshot(snapshot) {
    if (!isNativeEnded(snapshot)) this.#endedNotified = false;
    else this.#requestedPlaying = false;
    const pending = this.#pendingSeek;
    if (pending) {
      if (Math.abs(snapshot.currentTimeSeconds - pending.target) <= 1 || performance.now() >= pending.deadline) this.#pendingSeek = void 0;
      else snapshot.currentTimeSeconds = pending.target;
    }
    return this.#snapshot = snapshot;
  }
  #installMediaFacade() {
    const state = nativeMediaElementStates.get(this.element);
    if (!state || state.owner !== this.#sessionKey) return;
    const source = typeof this.#options.source === "string" ? this.#options.source : this.#options.source.uri;
    const define = (key, descriptor) => {
      if (!state.originals.has(key)) {
        state.originals.set(key, Object.getOwnPropertyDescriptor(this.element, key));
      }
      Object.defineProperty(this.element, key, { configurable: true, ...descriptor });
    };
    const ranges = (start, end) => ({
      length: end > start ? 1 : 0,
      start: (index) => {
        if (index !== 0 || end <= start) throw new DOMException("Index out of bounds", "IndexSizeError");
        return start;
      },
      end: (index) => {
        if (index !== 0 || end <= start) throw new DOMException("Index out of bounds", "IndexSizeError");
        return end;
      }
    });
    define("play", { value: () => this.play() });
    define("pause", { value: () => this.pause() });
    define("playbackRate", { get: () => this.#rate, set: (rate) => {
      this.#runDetached(this.setPlaybackRate(Number(rate)));
    } });
    define("currentTime", {
      get: () => this.#snapshot?.currentTimeSeconds ?? 0,
      set: (value) => {
        this.#runDetached(this.seek(Number(value)));
      }
    });
    define("duration", {
      get: () => this.#snapshot?.live ? Number.POSITIVE_INFINITY : this.#snapshot?.durationSeconds ?? Number.NaN
    });
    define("paused", { get: () => !this.#requestedPlaying });
    define("ended", { get: () => isNativeEnded(this.#snapshot) });
    define("volume", {
      get: () => this.#volume,
      set: (value) => {
        this.#runDetached(this.setVolume(Number(value)));
      }
    });
    define("muted", {
      get: () => this.#muted,
      set: (value) => {
        this.#muted = Boolean(value);
        this.#runDetached(this.#control("volume", this.#muted ? 0 : this.#volume).then((snapshot) => {
          this.#acceptSnapshot(snapshot);
        }));
        this.element.dispatchEvent(new Event("volumechange"));
      }
    });
    define("buffered", {
      get: () => {
        const snapshot = this.#snapshot;
        if (!snapshot) return ranges(0, 0);
        const start = snapshot.live ? snapshot.seekableStartSeconds ?? snapshot.currentTimeSeconds : 0;
        return ranges(Math.min(start, snapshot.currentTimeSeconds), snapshot.bufferedSeconds);
      }
    });
    define("seekable", {
      get: () => {
        const snapshot = this.#snapshot;
        if (!snapshot || snapshot.seekable === false) return ranges(0, 0);
        return ranges(
          snapshot.seekableStartSeconds ?? 0,
          snapshot.seekableEndSeconds ?? (snapshot.live ? 0 : snapshot.durationSeconds)
        );
      }
    });
    define("readyState", { get: () => this.#snapshot?.videoWidth ? HTMLMediaElement.HAVE_ENOUGH_DATA : HTMLMediaElement.HAVE_NOTHING });
    define("networkState", { get: () => this.#snapshot ? HTMLMediaElement.NETWORK_IDLE : HTMLMediaElement.NETWORK_LOADING });
    define("currentSrc", { get: () => source });
    define("videoWidth", { get: () => this.#snapshot?.videoWidth ?? 0 });
    define("videoHeight", { get: () => this.#snapshot?.videoHeight ?? 0 });
  }
  #removeMediaFacade() {
    const state = nativeMediaElementStates.get(this.element);
    if (!state || state.owner !== this.#sessionKey) return false;
    for (const [key, descriptor] of state.originals) {
      if (descriptor) Object.defineProperty(this.element, key, descriptor);
      else delete this.element[key];
    }
    nativeMediaElementStates.delete(this.element);
    return true;
  }
  #measureLayout() {
    const rect = this.element.getBoundingClientRect();
    const android = this.#platform === "android";
    const scale = android ? window.devicePixelRatio || 1 : 1;
    const layout = snapNativeSurfaceLayout(rect, android, scale);
    const scrollX = Number(window.scrollX);
    const scrollY = Number(window.scrollY);
    layout.scrollX = android && Number.isFinite(scrollX) ? Math.round(scrollX * scale) : 0;
    layout.scrollY = android && Number.isFinite(scrollY) ? Math.round(scrollY * scale) : 0;
    return { layout, frame: this.#compositor?.measure(layout, scale) };
  }
  #claimCssSurface() {
    if (this.#platform === "windows") return;
    this.#compositor = new NativeSurfaceCompositor(this.#sessionKey, this.element);
  }
  #applyWindowsVideoGeometry() {
    if (this.#platform !== "windows") return;
    this.element.style.objectFit = this.#videoFit === "fit" ? "contain" : this.#videoFit === "cover" ? "cover" : "fill";
    this.element.style.transformOrigin = "center";
    this.element.style.transform = this.#videoZoom === 1 ? "none" : `scale(${this.#videoZoom})`;
  }
  #playWindowsTextureStream() {
    if (!this.#textureStream) return;
    void HTMLMediaElement.prototype.play.call(this.element).catch(() => void 0);
  }
  #claimMediaElement() {
    const state = nativeMediaElementStates.get(this.element);
    if (state) state.owner = this.#sessionKey;
    else nativeMediaElementStates.set(this.element, {
      owner: this.#sessionKey,
      originals: /* @__PURE__ */ new Map()
    });
  }
  #ownsMediaElement() {
    return nativeMediaElementStates.get(this.element)?.owner === this.#sessionKey;
  }
  #publishCssLayout(frame) {
    if (frame) this.#compositor?.commit(frame);
  }
  #releaseCssSurface() {
    this.#compositor?.release();
    this.#compositor = void 0;
  }
  #bindAbortSignal() {
    const signal = this.#options.signal;
    if (!signal) return;
    const abort = () => this.#runDetached(this.destroy());
    signal.addEventListener("abort", abort, { once: true });
    this.#removeAbortListener = () => signal.removeEventListener("abort", abort);
  }
  #runDetached(operation) {
    void operation.catch((error) => this.#publishError(error));
  }
  #publishError(error) {
    if (!this.#destroyed) {
      this.dispatchEvent(new CustomEvent("error", { detail: normalizeError(error) }));
    }
  }
  #supportsCompleteVideoGeometry() {
    if (this.#platform === "android" || this.#platform === "windows") return true;
    if (this.#platform !== "linux") return false;
    return this.#options.playback?.engine === "mpv" || /\bmpv\b/i.test(this.#snapshot?.hardwareBackend ?? "");
  }
  #handleViewportChange = () => this.#requestLayout();
  #handleDocumentVisibility = () => this.#queueVisibilitySync();
  #startPolling() {
    if (this.#timer === void 0 && !this.#destroyed && !this.#suspendedForVisibility) {
      this.#schedulePoll(0);
    }
  }
  #schedulePoll(delayMs) {
    if (this.#timer !== void 0 || this.#destroyed || this.#suspendedForVisibility) return;
    this.#timer = window.setTimeout(async () => {
      this.#timer = void 0;
      await this.#poll();
      this.#schedulePoll(this.#requestedPlaying ? 250 : 1e3);
    }, delayMs);
  }
  #stopPolling() {
    if (this.#timer !== void 0) {
      clearTimeout(this.#timer);
      this.#timer = void 0;
    }
  }
  #queueVisibilitySync() {
    this.#visibilityMutation = this.#visibilityMutation.catch(() => void 0).then(() => this.#syncVisibility()).catch((error) => this.#publishError(error));
  }
  async #syncVisibility() {
    if (this.#destroyed || !(this.#options.suspendWhenHidden ?? true)) return;
    const visible = this.#intersectionVisible && document.visibilityState === "visible";
    if (!visible && !this.#suspendedForVisibility) {
      this.#suspendedForVisibility = true;
      this.#stopPolling();
      if (this.#requestedPlaying) await this.#control("pause");
      return;
    }
    if (visible && this.#suspendedForVisibility) {
      this.#suspendedForVisibility = false;
      this.#requestLayout();
      this.#startPolling();
      if (this.#requestedPlaying) {
        this.#acceptSnapshot(await this.#control("play"));
      }
    }
  }
  #requestLayout() {
    if (this.#destroyed || this.#platform === "windows") return;
    this.#layoutDirty = true;
    if (this.#layoutFrame !== void 0 || this.#layoutInFlight) return;
    this.#layoutFrame = requestAnimationFrame(() => {
      this.#layoutFrame = void 0;
      void this.#flushLayout();
    });
  }
  async #flushLayout() {
    if (this.#destroyed || this.#layoutInFlight) return;
    this.#layoutInFlight = true;
    try {
      if (!this.#layoutDirty) return;
      this.#layoutDirty = false;
      const { layout, frame } = this.#measureLayout();
      if (sameNativeSurfacePosition(layout, this.#lastLayout, this.#platform === "android")) {
        this.#publishCssLayout(frame);
        return;
      }
      await invoke(`${COMMAND2}native_layout`, {
        payload: { sessionKey: this.#sessionKey, ...layout }
      });
      this.#lastLayout = layout;
      this.#publishCssLayout(frame);
    } catch (error) {
      this.#publishError(error);
    } finally {
      this.#layoutInFlight = false;
      if (this.#layoutDirty && !this.#destroyed) this.#requestLayout();
    }
  }
};
function nativeScrollTargets(anchor) {
  const targets = /* @__PURE__ */ new Set([window, document]);
  for (let element = anchor.parentElement; element; element = element.parentElement) {
    targets.add(element);
  }
  return [...targets];
}
async function unsupported(feature, message) {
  throw await nativeFeatureUnavailableError({ backend: "tauri", feature, message });
}
function normalizeError(error) {
  if (typeof error === "object" && error && "code" in error && "message" in error) {
    return error;
  }
  return { code: "transport", message: errorMessage(error) };
}
export {
  TAURI_VIDEO_PACKAGE_NAME,
  TAURI_VIDEO_PACKAGE_VERSION,
  TAURI_VIDEO_PROTOCOL_VERSION,
  VIDEO_CONTROLS_ATTRIBUTE,
  attachTauriBackend,
  getTauriVideoDiagnostics,
  registerVideoControls2 as registerVideoControls,
  verifyTauriVideoProtocol
};
