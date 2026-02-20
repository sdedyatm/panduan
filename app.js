/**
 * ProPWA — app.js
 * Core application module: router, permissions, viewer, state management
 * ES6+ vanilla JS, no external dependencies
 * @version 1.0.0
 */

"use strict";

/* ═══════════════════════════════════════════════════════
   STATE MANAGER — Simple observable state
═══════════════════════════════════════════════════════ */
const State = (() => {
  const _state = {
    currentPage: "/",
    online: navigator.onLine,
    installPrompt: null,
    permissions: {}, // { permName: 'granted'|'denied'|'prompt'|'unsupported'|'unknown' }
    geoWatchId: null,
    mediaStream: null,
    wakeLock: null
  };

  const _listeners = {};

  return {
    get(key) {
      return _state[key];
    },
    set(key, value) {
      _state[key] = value;
      (_listeners[key] || []).forEach((fn) => fn(value, key));
    },
    subscribe(key, fn) {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(fn);
      return () => {
        _listeners[key] = _listeners[key].filter((l) => l !== fn);
      };
    },
    getAll() {
      return { ..._state };
    }
  };
})();

/* ═══════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════ */
const Utils = {
  /** Show a toast notification */
  toast(message, type = "info", duration = 3500) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    const icon =
      { success: "✅", error: "❌", warn: "⚠️", info: "ℹ️" }[type] || "ℹ️";
    toast.className = "toast";
    toast.textContent = `${icon} ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("out");
      toast.addEventListener("animationend", () => toast.remove());
    }, duration);
  },

  /** Show/hide page loader overlay */
  setLoading(active) {
    document.getElementById("page-loader").classList.toggle("active", active);
  },

  /** Format bytes to human-readable */
  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024,
      sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },

  /** Debounce a function */
  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  /** Clamp a value */
  clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  },

  /** Generate unique ID */
  uid() {
    return Math.random().toString(36).slice(2, 9);
  }
};

/* ═══════════════════════════════════════════════════════
   PERMISSION MANAGER
═══════════════════════════════════════════════════════ */
const PermissionManager = (() => {
  /** All permissions with metadata */
  const PERMISSIONS = [
    {
      id: "geolocation",
      name: "Geolocation",
      icon: "📍",
      desc:
        "Access your real-time GPS location for mapping and location services.",
      api: "geolocation",
      queryName: "geolocation"
    },
    {
      id: "camera",
      name: "Camera",
      icon: "📷",
      desc: "Access the device camera for photos and video conferencing.",
      api: "mediaDevices",
      queryName: "camera"
    },
    {
      id: "microphone",
      name: "Microphone",
      icon: "🎤",
      desc: "Access the microphone for audio recording and voice input.",
      api: "mediaDevices",
      queryName: "microphone"
    },
    {
      id: "notifications",
      name: "Notifications",
      icon: "🔔",
      desc: "Show push notifications and system alerts.",
      api: "notifications",
      queryName: "notifications"
    },
    {
      id: "clipboard-read",
      name: "Clipboard Read",
      icon: "📋",
      desc: "Read text and content from the system clipboard.",
      api: "clipboard",
      queryName: "clipboard-read"
    },
    {
      id: "clipboard-write",
      name: "Clipboard Write",
      icon: "✏️",
      desc: "Write text and content to the system clipboard.",
      api: "clipboard",
      queryName: "clipboard-write"
    },
    {
      id: "nfc",
      name: "NFC",
      icon: "📶",
      desc: "Access Near-Field Communication for contactless data exchange.",
      api: "nfc",
      queryName: "nfc"
    },
    {
      id: "wake-lock",
      name: "Screen Wake Lock",
      icon: "☀️",
      desc: "Prevent the screen from sleeping during active use.",
      api: "wakeLock",
      queryName: "screen-wake-lock"
    },
    {
      id: "device-orientation",
      name: "Device Orientation",
      icon: "🧭",
      desc: "Access gyroscope and accelerometer for motion tracking.",
      api: "orientation",
      queryName: null
    },
    {
      id: "contacts",
      name: "Contacts Picker",
      icon: "👤",
      desc: "Select contacts from the address book (ContactsPicker API).",
      api: "contacts",
      queryName: null
    },
    {
      id: "file-system",
      name: "File System Access",
      icon: "📂",
      desc: "Open and save files directly from the local file system.",
      api: "fileSystem",
      queryName: null
    },
    {
      id: "fullscreen",
      name: "Fullscreen",
      icon: "⛶",
      desc: "Display the app in fullscreen mode.",
      api: "fullscreen",
      queryName: "fullscreen"
    }
  ];

  /** Detect API support */
  function isSupported(perm) {
    switch (perm.api) {
      case "geolocation":
        return "geolocation" in navigator;
      case "mediaDevices":
        return (
          "mediaDevices" in navigator &&
          "getUserMedia" in navigator.mediaDevices
        );
      case "notifications":
        return "Notification" in window;
      case "clipboard":
        return "clipboard" in navigator;
      case "nfc":
        return "NDEFReader" in window;
      case "wakeLock":
        return "wakeLock" in navigator;
      case "orientation":
        return "DeviceOrientationEvent" in window;
      case "contacts":
        return "contacts" in navigator && "ContactsManager" in window;
      case "fileSystem":
        return "showOpenFilePicker" in window;
      case "fullscreen":
        return "requestFullscreen" in document.documentElement;
      default:
        return false;
    }
  }

  /** Query current permission status via Permissions API where possible */
  async function queryStatus(perm) {
    if (!isSupported(perm)) return "unsupported";
    if (!perm.queryName) return "unknown";
    try {
      if ("permissions" in navigator) {
        const result = await navigator.permissions.query({
          name: perm.queryName
        });
        return result.state; // 'granted'|'denied'|'prompt'
      }
    } catch (_) {}
    return "unknown";
  }

  /** Request a specific permission */
  async function request(id) {
    const perm = PERMISSIONS.find((p) => p.id === id);
    if (!perm) return "unknown";
    if (!isSupported(perm)) return "unsupported";

    try {
      switch (perm.api) {
        case "geolocation": {
          return await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve("granted"),
              (e) => resolve(e.code === 1 ? "denied" : "prompt")
            );
          });
        }
        case "mediaDevices": {
          const constraints =
            perm.id === "camera" ? { video: true } : { audio: true };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          stream.getTracks().forEach((t) => t.stop());
          return "granted";
        }
        case "notifications": {
          const result = await Notification.requestPermission();
          return result === "granted"
            ? "granted"
            : result === "denied"
            ? "denied"
            : "prompt";
        }
        case "clipboard": {
          if (perm.id === "clipboard-write") {
            await navigator.clipboard.writeText("ProPWA test");
            return "granted";
          } else {
            await navigator.clipboard.readText();
            return "granted";
          }
        }
        case "nfc": {
          const ndef = new NDEFReader();
          await ndef.scan();
          return "granted";
        }
        case "wakeLock": {
          const wl = await navigator.wakeLock.request("screen");
          wl.release();
          return "granted";
        }
        case "orientation": {
          if (typeof DeviceOrientationEvent.requestPermission === "function") {
            const result = await DeviceOrientationEvent.requestPermission();
            return result === "granted" ? "granted" : "denied";
          }
          return "granted"; // Android grants automatically
        }
        case "contacts": {
          await navigator.contacts.select(["name"], { multiple: false });
          return "granted";
        }
        case "fileSystem": {
          const [handle] = await window.showOpenFilePicker();
          return handle ? "granted" : "prompt";
        }
        case "fullscreen": {
          await document.documentElement.requestFullscreen();
          return "granted";
        }
        default:
          return "unknown";
      }
    } catch (e) {
      if (e.name === "NotAllowedError" || e.name === "SecurityError")
        return "denied";
      console.warn(`Permission ${id} error:`, e);
      return "denied";
    }
  }

  /** Initialize all statuses */
  async function initAll() {
    const statuses = {};
    await Promise.all(
      PERMISSIONS.map(async (perm) => {
        statuses[perm.id] = await queryStatus(perm);
      })
    );
    State.set("permissions", statuses);
    return statuses;
  }

  return { PERMISSIONS, isSupported, queryStatus, request, initAll };
})();

/* ═══════════════════════════════════════════════════════
   IMAGE VIEWER
═══════════════════════════════════════════════════════ */
const ImageViewer = (() => {
  let scale = 1,
    minScale = 0.1,
    maxScale = 10;
  let offsetX = 0,
    offsetY = 0;
  let isDragging = false;
  let lastX = 0,
    lastY = 0;
  let lastTouchDist = 0;
  let pinchStartScale = 1;
  const stage = () => document.getElementById("viewer-stage");
  const img = () => document.getElementById("viewer-img");
  const label = () => document.getElementById("zoom-label");

  function applyTransform(animated = false) {
    const el = img();
    if (!el) return;
    if (animated)
      el.style.transition = "transform 0.25s cubic-bezier(0.23,1,0.32,1)";
    else el.style.transition = "";
    el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    if (label()) label().textContent = Math.round(scale * 100) + "%";
  }

  function resetView(animated = true) {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    applyTransform(animated);
  }

  function zoom(factor, cx = 0, cy = 0) {
    const newScale = Utils.clamp(scale * factor, minScale, maxScale);
    const ds = newScale / scale;
    offsetX = cx + (offsetX - cx) * ds;
    offsetY = cy + (offsetY - cy) * ds;
    scale = newScale;
    applyTransform();
  }

  function getCenter(touches) {
    const t1 = touches[0],
      t2 = touches[1];
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
      dist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
    };
  }

  function bindEvents() {
    const s = stage();
    // Mouse wheel zoom
    s.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = s.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
      },
      { passive: false }
    );

    // Mouse drag
    s.addEventListener("mousedown", (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      s.classList.add("dragging");
    });
    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      offsetX += e.clientX - lastX;
      offsetY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      applyTransform();
    });
    window.addEventListener("mouseup", () => {
      isDragging = false;
      s.classList.remove("dragging");
    });

    // Touch pinch + drag
    s.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          const c = getCenter(e.touches);
          lastTouchDist = c.dist;
          pinchStartScale = scale;
          lastX = c.x;
          lastY = c.y;
        } else if (e.touches.length === 1) {
          isDragging = true;
          lastX = e.touches[0].clientX;
          lastY = e.touches[0].clientY;
        }
      },
      { passive: true }
    );

    s.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        if (e.touches.length === 2) {
          const c = getCenter(e.touches);
          const rect = s.getBoundingClientRect();
          const cx = c.x - rect.left - rect.width / 2;
          const cy = c.y - rect.top - rect.height / 2;
          const newScale = Utils.clamp(
            pinchStartScale * (c.dist / lastTouchDist),
            minScale,
            maxScale
          );
          const ds = newScale / scale;
          offsetX = cx + (offsetX - cx) * ds;
          offsetY = cy + (offsetY - cy) * ds;
          scale = newScale;
          // Pan while pinching
          offsetX += c.x - lastX;
          offsetY += c.y - lastY;
          lastX = c.x;
          lastY = c.y;
          applyTransform();
        } else if (e.touches.length === 1 && isDragging) {
          offsetX += e.touches[0].clientX - lastX;
          offsetY += e.touches[0].clientY - lastY;
          lastX = e.touches[0].clientX;
          lastY = e.touches[0].clientY;
          applyTransform();
        }
      },
      { passive: false }
    );

    s.addEventListener("touchend", () => {
      isDragging = false;
      lastTouchDist = 0;
    });

    // Toolbar buttons
    document
      .getElementById("btn-zoom-in")
      .addEventListener("click", () => zoom(1.25));
    document
      .getElementById("btn-zoom-out")
      .addEventListener("click", () => zoom(1 / 1.25));
    document
      .getElementById("btn-zoom-reset")
      .addEventListener("click", () => resetView(true));
    document
      .getElementById("btn-viewer-close")
      .addEventListener("click", close);

    // Escape key
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  function open(src, filename = "Image") {
    const overlay = document.getElementById("viewer-overlay");
    const el = img();
    document.getElementById("viewer-filename").textContent = filename;
    el.src = src;
    el.style.transform = "";
    resetView(false);
    overlay.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function close() {
    document.getElementById("viewer-overlay").classList.remove("show");
    document.body.style.overflow = "";
    // Stop any active media
    const v = img();
    if (v) v.src = "";
  }

  function init() {
    bindEvents();
  }

  return { init, open, close };
})();

/* ═══════════════════════════════════════════════════════
   PAGE TEMPLATES (inline SPA pages)
═══════════════════════════════════════════════════════ */
const Pages = {
  /** Home page */
  "/": () => `
    <div class="page">
      <div class="hero">
        <span class="hero-kicker">⚡ Progressive Web App</span>
        <h1>Enterprise<br/>PWA Platform</h1>
        <p>A production-grade, offline-capable application with hardware access, modern UI, and zero dependencies.</p>
        <div class="hero-actions">
          <button class="btn btn-primary" onclick="router.navigate('/permissions')">🔐 Permission Center</button>
          <button class="btn btn-ghost" onclick="router.navigate('/viewer')">🖼️ Image Viewer</button>
        </div>
      </div>

      <div class="stat-strip">
        <div class="stat-item">
          <div class="stat-value" id="stat-perms">—</div>
          <div class="stat-label">Permissions</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="stat-apis">10</div>
          <div class="stat-label">Browser APIs</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">0</div>
          <div class="stat-label">Dependencies</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="stat-online">${
            navigator.onLine ? "🟢" : "🔴"
          }</div>
          <div class="stat-label">Network</div>
        </div>
      </div>

      <p class="section-label">Core Features</p>
      <div class="grid-2" style="margin-bottom:40px">
        <div class="feature-card" onclick="router.navigate('/permissions')">
          <span class="fi">🔐</span>
          <h3>Permission Center</h3>
          <p>Request and monitor all hardware and browser API permissions with live status updates.</p>
        </div>
        <div class="feature-card" onclick="router.navigate('/viewer')">
          <span class="fi">🔍</span>
          <h3>Image Viewer</h3>
          <p>High-fidelity zoom viewer with pinch, pan, and mouse wheel — no pixelation.</p>
        </div>
        <div class="feature-card" onclick="router.navigate('/device')">
          <span class="fi">📱</span>
          <h3>Device Info</h3>
          <p>Real-time device orientation, battery, connection type, and hardware capabilities.</p>
        </div>
        <div class="feature-card" onclick="router.navigate('/offline')">
          <span class="fi">📡</span>
          <h3>Offline Ready</h3>
          <p>Service worker caching with stale-while-revalidate strategy for seamless offline use.</p>
        </div>
      </div>

      <footer>
        <p>Built with Vanilla JS ES6+ · No frameworks · No dependencies</p>
        <p style="margin-top:6px;font-size:0.68rem;opacity:0.5">ProPWA Enterprise Platform v1.0.0</p>
      </footer>
    </div>
  `,

  /** Permission center page */
  "/permissions": () => {
    const perms = State.get("permissions");
    const cards = PermissionManager.PERMISSIONS.map((p) => {
      const status = perms[p.id] || "unknown";
      const supported = PermissionManager.isSupported(p);
      const finalStatus = supported ? status : "unsupported";
      return `
        <div class="perm-card ${finalStatus}" id="pcard-${
        p.id
      }" data-perm-id="${p.id}">
          <div class="perm-card-header">
            <div class="perm-icon-wrap">${p.icon}</div>
            <div class="perm-meta">
              <div class="perm-name">${p.name}</div>
              <div class="perm-desc">${p.desc}</div>
            </div>
          </div>
          <div class="perm-card-footer">
            <div class="perm-status-wrap" id="pstatus-${p.id}">
              <div class="dot dot-${finalStatus}"></div>
              <span class="badge badge-${finalStatus}">${finalStatus.toUpperCase()}</span>
            </div>
            ${
              supported
                ? `<button class="btn btn-ghost btn-sm" onclick="PermCenter.request('${p.id}')">Request</button>`
                : `<span class="text-xs text-faint">Not supported</span>`
            }
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="page">
        <p class="section-label">Hardware & Browser APIs</p>
        <h2 class="section-title">Permission Center</h2>
        <p style="color:var(--text2);margin-bottom:28px;font-size:0.9rem;line-height:1.6">
          Request access to device hardware and browser capabilities. All permissions follow standard browser security policies — you control what you allow.
        </p>
        <div class="grid-2">${cards}</div>
      </div>
    `;
  },

  /** Image viewer page */
  "/viewer": () => `
    <div class="page">
      <p class="section-label">High-Fidelity Rendering</p>
      <h2 class="section-title">Image Viewer</h2>
      <p style="color:var(--text2);margin-bottom:28px;font-size:0.9rem;line-height:1.6">
        Zoom, pan, and inspect images at full resolution without any pixelation. Supports pinch-to-zoom on touch devices and mouse wheel on desktop.
      </p>

      <!-- Demo images -->
      <p class="section-label mt-8 mb-8">Sample Images — click to open viewer</p>
      <div class="grid-3" style="margin-bottom:32px">
        ${[
          {
            label: "Gradient A",
            colors: ["#6c63ff", "#38bdf8"],
            shape: "circle"
          },
          {
            label: "Gradient B",
            colors: ["#f87171", "#fbbf24"],
            shape: "diamond"
          },
          {
            label: "Gradient C",
            colors: ["#34d399", "#6c63ff"],
            shape: "triangle"
          }
        ]
          .map(
            (item, i) => `
          <div class="card" style="cursor:pointer;text-align:center"
               onclick="ViewerPage.openDemo(${i})" title="Open ${item.label}">
            <div style="height:140px;background:linear-gradient(135deg,${
              item.colors[0]
            },${
              item.colors[1]
            });border-radius:10px;margin-bottom:12px;display:flex;align-items:center;justify-content:center">
              <span style="font-size:2.5rem">${["🌊", "🔥", "🌿"][i]}</span>
            </div>
            <div style="font-size:0.85rem;font-weight:600">${item.label}</div>
            <div style="font-size:0.72rem;color:var(--text3);margin-top:4px">Click to inspect</div>
          </div>
        `
          )
          .join("")}
      </div>

      <!-- Upload your own -->
      <div class="card">
        <h3 style="font-size:1rem;font-weight:600;margin-bottom:8px">📂 Upload Your Image</h3>
        <p style="font-size:0.82rem;color:var(--text2);margin-bottom:16px">
          Open any PNG, JPG, or WebP image in the high-fidelity viewer. The original resolution is preserved during zoom.
        </p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label class="btn btn-primary" style="cursor:pointer">
            Choose Image
            <input type="file" accept="image/*" style="display:none" onchange="ViewerPage.openFile(this)">
          </label>
          <span class="text-xs text-faint" id="viewer-file-name">No file selected</span>
        </div>
        <div style="margin-top:16px;padding:14px;background:var(--surface2);border-radius:10px;font-size:0.78rem;color:var(--text3);line-height:1.6">
          <strong style="color:var(--text2)">Controls:</strong><br>
          🖱️ Mouse wheel — zoom in/out<br>
          ✋ Drag — pan around<br>
          👆 Pinch — pinch-to-zoom (touch)<br>
          ⌨️ Escape — close viewer
        </div>
      </div>
    </div>
  `,

  /** Device info page */
  "/device": () => `
    <div class="page">
      <p class="section-label">Hardware Diagnostics</p>
      <h2 class="section-title">Device Info</h2>

      <div class="grid-2">
        <!-- Orientation -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:16px">🧭 Device Orientation</h3>
          <div style="text-align:center;margin-bottom:16px">
            <div id="orientation-visual">
              <span style="font-size:1.6rem">📱</span>
            </div>
          </div>
          <div class="geo-display" id="orientation-data">
            alpha: — °<br>beta:  — °<br>gamma: — °
          </div>
          <button class="btn btn-ghost btn-sm full-width mt-16" onclick="DevicePage.startOrientation()">
            Start Tracking
          </button>
        </div>

        <!-- Geolocation -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:16px">📍 Geolocation</h3>
          <div class="geo-display" id="geo-data">
            latitude:  —<br>longitude: —<br>accuracy:  —<br>altitude:  —
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-primary btn-sm" onclick="DevicePage.startGeo()" style="flex:1">Watch Position</button>
            <button class="btn btn-ghost btn-sm" onclick="DevicePage.stopGeo()">Stop</button>
          </div>
        </div>

        <!-- Camera + Mic preview -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:16px">📷 Camera Preview</h3>
          <video id="camera-preview" autoplay muted playsinline></video>
          <div id="audio-bar-wrap" style="display:none">
            <div id="audio-bar"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="DevicePage.startCamera()">Camera</button>
            <button class="btn btn-ghost btn-sm" onclick="DevicePage.startMic()">Mic Level</button>
            <button class="btn btn-ghost btn-sm" onclick="DevicePage.stopMedia()">Stop</button>
          </div>
        </div>

        <!-- System info -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:16px">💻 System Info</h3>
          <div class="geo-display" id="system-info">
            ${DevicePage ? DevicePage.getSystemInfo() : ""}
          </div>
          <button class="btn btn-ghost btn-sm full-width mt-16" onclick="DevicePage.refreshSystemInfo()">
            Refresh
          </button>
        </div>

        <!-- Wake lock -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">☀️ Screen Wake Lock</h3>
          <p style="font-size:0.8rem;color:var(--text2);margin-bottom:14px;line-height:1.5">
            Prevent the screen from sleeping while this page is active.
          </p>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-primary btn-sm" onclick="DevicePage.requestWakeLock()">Enable</button>
            <button class="btn btn-ghost btn-sm" onclick="DevicePage.releaseWakeLock()">Release</button>
            <span class="text-xs text-faint" id="wakelock-status">Inactive</span>
          </div>
        </div>

        <!-- Notifications -->
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">🔔 Notifications</h3>
          <p style="font-size:0.8rem;color:var(--text2);margin-bottom:14px;line-height:1.5">
            Test system notifications with title, body, and icon.
          </p>
          <div class="notification-preview">
            <span style="font-size:1.4rem">📣</span>
            <div>
              <div style="font-size:0.85rem;font-weight:600">ProPWA Notification</div>
              <div style="font-size:0.75rem;color:var(--text3)">This is a test notification</div>
            </div>
          </div>
          <button class="btn btn-primary btn-sm full-width mt-16" onclick="DevicePage.sendNotification()">
            Send Test Notification
          </button>
        </div>
      </div>
    </div>
  `,

  /** Offline demo page */
  "/offline": () => `
    <div class="page">
      <p class="section-label">Service Worker</p>
      <h2 class="section-title">Offline Capabilities</h2>
      <p style="color:var(--text2);margin-bottom:28px;font-size:0.9rem;line-height:1.6">
        This PWA uses a service worker with stale-while-revalidate caching. All pages and assets are cached locally — try turning off your internet connection.
      </p>

      <div class="grid-2">
        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">📡 Network Status</h3>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <div class="dot dot-${
              navigator.onLine ? "granted" : "denied"
            }" id="net-dot" style="width:10px;height:10px"></div>
            <span style="font-weight:600" id="net-status">${
              navigator.onLine ? "Online" : "Offline"
            }</span>
          </div>
          <div class="geo-display">
            Connection: <span id="net-type">${
              "connection" in navigator
                ? navigator.connection.effectiveType || "—"
                : "—"
            }</span><br>
            Downlink: <span id="net-dl">${
              "connection" in navigator
                ? (navigator.connection.downlink || "—") + " Mbps"
                : "—"
            }</span><br>
            RTT: <span id="net-rtt">${
              "connection" in navigator
                ? (navigator.connection.rtt || "—") + " ms"
                : "—"
            }</span>
          </div>
        </div>

        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">🗃️ Cache Storage</h3>
          <div class="geo-display" id="cache-info">Loading cache info...</div>
          <button class="btn btn-ghost btn-sm full-width mt-16" onclick="OfflinePage.refreshCache()">
            Refresh Cache Info
          </button>
        </div>

        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">⚙️ Service Worker</h3>
          <div class="geo-display" id="sw-info">Checking...</div>
        </div>

        <div class="card">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:12px">🔄 Cache Actions</h3>
          <p style="font-size:0.8rem;color:var(--text2);margin-bottom:14px;line-height:1.5">
            Manually clear or refresh the cache. The service worker will rebuild it on next load.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="OfflinePage.clearCache()">Clear Cache</button>
            <button class="btn btn-primary btn-sm" onclick="location.reload()">Hard Reload</button>
          </div>
        </div>
      </div>
    </div>
  `
};

/* ═══════════════════════════════════════════════════════
   AJAX ROUTER — SPA navigation with History API
═══════════════════════════════════════════════════════ */
const router = (() => {
  const ROUTES = Object.keys(Pages);

  async function navigate(path, pushState = true) {
    if (!ROUTES.includes(path)) path = "/";
    State.set("currentPage", path);

    // Close menu
    menuToggle(false);

    // Show loader briefly
    Utils.setLoading(true);
    await new Promise((r) => setTimeout(r, 120));

    // Render page
    const content = document.getElementById("page-content");
    content.style.opacity = "0";
    content.style.transform = "translateY(10px)";

    setTimeout(() => {
      content.innerHTML = Pages[path]();
      content.style.transition =
        "opacity 0.3s var(--easing), transform 0.3s var(--easing)";
      content.style.opacity = "1";
      content.style.transform = "translateY(0)";
      Utils.setLoading(false);

      // Update nav active states
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.page === path);
      });

      // Update browser history
      if (pushState) {
        window.history.pushState(
          { path },
          "",
          path === "/" ? "./" : path.slice(1) + ".html"
        );
      }

      // Page-specific init
      afterPageRender(path);
    }, 80);
  }

  function afterPageRender(path) {
    if (path === "/") {
      // Update stat counts
      const perms = State.get("permissions");
      const granted = Object.values(perms).filter((v) => v === "granted")
        .length;
      const el = document.getElementById("stat-perms");
      if (el)
        el.textContent = `${granted}/${PermissionManager.PERMISSIONS.length}`;
    }
    if (path === "/device") {
      DevicePage.renderSystemInfo();
      DevicePage.initNetworkListener();
    }
    if (path === "/offline") {
      OfflinePage.init();
    }
  }

  // Handle browser back/forward
  window.addEventListener("popstate", (e) => {
    if (e.state?.path) navigate(e.state.path, false);
    else navigate("/", false);
  });

  return { navigate };
})();

/* ═══════════════════════════════════════════════════════
   MENU TOGGLE
═══════════════════════════════════════════════════════ */
function menuToggle(forceState) {
  const fab = document.getElementById("fab");
  const menu = document.getElementById("nav-menu");
  const isOpen =
    typeof forceState === "boolean"
      ? forceState
      : !menu.classList.contains("open");
  fab.classList.toggle("open", isOpen);
  menu.classList.toggle("open", isOpen);
  fab.setAttribute("aria-expanded", isOpen);
}

/* ═══════════════════════════════════════════════════════
   PERMISSION CENTER CONTROLLER
═══════════════════════════════════════════════════════ */
const PermCenter = {
  async request(id) {
    Utils.toast(`Requesting ${id}...`, "info", 1800);
    const status = await PermissionManager.request(id);

    // Update state
    const perms = { ...State.get("permissions"), [id]: status };
    State.set("permissions", perms);

    // Update card UI
    const card = document.getElementById(`pcard-${id}`);
    const statusWrap = document.getElementById(`pstatus-${id}`);
    if (card) {
      card.className = `perm-card ${status}`;
      statusWrap.innerHTML = `
        <div class="dot dot-${status}"></div>
        <span class="badge badge-${status}">${status.toUpperCase()}</span>
      `;
    }

    const msgs = {
      granted: `✅ ${id} access granted`,
      denied: `❌ ${id} access denied`,
      prompt: `⚠️ ${id} awaiting decision`
    };
    Utils.toast(
      msgs[status] || `${id}: ${status}`,
      status === "granted" ? "success" : status === "denied" ? "error" : "warn"
    );
  }
};

/* ═══════════════════════════════════════════════════════
   VIEWER PAGE CONTROLLER
═══════════════════════════════════════════════════════ */
const ViewerPage = {
  DEMO_SVGS: [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><defs><radialGradient id="g" cx="50%" cy="50%"><stop offset="0%" stop-color="#6c63ff"/><stop offset="100%" stop-color="#38bdf8"/></radialGradient></defs><rect width="1200" height="900" fill="url(#g)"/><circle cx="600" cy="450" r="280" fill="rgba(255,255,255,0.08)"/><circle cx="600" cy="450" r="180" fill="rgba(255,255,255,0.06)"/><circle cx="600" cy="450" r="80" fill="rgba(255,255,255,0.12)"/><text x="600" y="460" font-size="48" fill="rgba(255,255,255,0.7)" text-anchor="middle" font-family="Georgia">Gradient A</text></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f87171"/><stop offset="100%" stop-color="#fbbf24"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><polygon points="600,100 900,800 300,800" fill="rgba(255,255,255,0.1)"/><text x="600" y="460" font-size="48" fill="rgba(255,255,255,0.7)" text-anchor="middle" font-family="Georgia">Gradient B</text></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#6c63ff"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/><rect x="300" y="200" width="600" height="500" rx="40" fill="rgba(255,255,255,0.08)"/><text x="600" y="460" font-size="48" fill="rgba(255,255,255,0.7)" text-anchor="middle" font-family="Georgia">Gradient C</text></svg>`
  ],

  openDemo(index) {
    const svg = this.DEMO_SVGS[index];
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    ImageViewer.open(url, `Gradient ${["A", "B", "C"][index]}.svg`);
  },

  openFile(input) {
    const file = input.files[0];
    if (!file) return;
    const el = document.getElementById("viewer-file-name");
    if (el) el.textContent = file.name;
    const url = URL.createObjectURL(file);
    ImageViewer.open(url, file.name);
  }
};

/* ═══════════════════════════════════════════════════════
   DEVICE PAGE CONTROLLER
═══════════════════════════════════════════════════════ */
const DevicePage = {
  _orientationHandler: null,
  _audioCtx: null,
  _analyser: null,
  _audioRAF: null,

  getSystemInfo() {
    const na = navigator;
    const mem = na.deviceMemory ? na.deviceMemory + " GB" : "—";
    const cores = na.hardwareConcurrency || "—";
    const lang = na.language || "—";
    const ua = na.userAgent.slice(0, 60) + "...";
    return `memory:   ${mem}\ncores:    ${cores}\nlanguage: ${lang}\nplatform: ${
      na.platform || "—"
    }\nua: ${ua}`;
  },

  renderSystemInfo() {
    const el = document.getElementById("system-info");
    if (el) el.textContent = this.getSystemInfo();
  },

  refreshSystemInfo() {
    this.renderSystemInfo();
    Utils.toast("System info refreshed", "success", 2000);
  },

  initNetworkListener() {
    const update = () => {
      const dot = document.getElementById("net-dot");
      const stat = document.getElementById("net-status");
      if (dot) {
        dot.className = `dot dot-${navigator.onLine ? "granted" : "denied"}`;
        dot.style.width = "10px";
        dot.style.height = "10px";
      }
      if (stat) stat.textContent = navigator.onLine ? "Online" : "Offline";
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
  },

  startOrientation() {
    if (!("DeviceOrientationEvent" in window)) {
      Utils.toast("DeviceOrientationEvent not supported", "error");
      return;
    }

    const request = async () => {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm !== "granted") {
          Utils.toast("Orientation permission denied", "error");
          return;
        }
      }
      this._orientationHandler = (e) => {
        const a = e.alpha?.toFixed(1) ?? "—";
        const b = e.beta?.toFixed(1) ?? "—";
        const g = e.gamma?.toFixed(1) ?? "—";
        const el = document.getElementById("orientation-data");
        if (el) el.textContent = `alpha: ${a} °\nbeta:  ${b} °\ngamma: ${g} °`;
        const visual = document.getElementById("orientation-visual");
        if (visual && e.beta !== null) {
          visual.style.transform = `rotateX(${Utils.clamp(
            e.beta,
            -40,
            40
          )}deg) rotateZ(${Utils.clamp(e.gamma, -40, 40)}deg)`;
        }
      };
      window.addEventListener("deviceorientation", this._orientationHandler);
      Utils.toast("Orientation tracking started", "success", 2000);
    };
    request();
  },

  startGeo() {
    if (!navigator.geolocation) {
      Utils.toast("Geolocation not supported", "error");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const el = document.getElementById("geo-data");
        if (el)
          el.textContent = [
            `latitude:  ${pos.coords.latitude.toFixed(6)}`,
            `longitude: ${pos.coords.longitude.toFixed(6)}`,
            `accuracy:  ${pos.coords.accuracy?.toFixed(1)} m`,
            `altitude:  ${pos.coords.altitude?.toFixed(1) ?? "—"} m`,
            `speed:     ${pos.coords.speed?.toFixed(2) ?? "—"} m/s`
          ].join("\n");
      },
      (err) => Utils.toast(`Geo error: ${err.message}`, "error"),
      { enableHighAccuracy: true }
    );
    State.set("geoWatchId", watchId);
    Utils.toast("Watching position...", "success", 2000);
  },

  stopGeo() {
    const id = State.get("geoWatchId");
    if (id) {
      navigator.geolocation.clearWatch(id);
      State.set("geoWatchId", null);
    }
    Utils.toast("Stopped geolocation", "info", 2000);
  },

  async startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      State.set("mediaStream", stream);
      const video = document.getElementById("camera-preview");
      if (video) {
        video.srcObject = stream;
      }
      Utils.toast("Camera started", "success", 2000);
    } catch (e) {
      Utils.toast(`Camera error: ${e.message}`, "error");
    }
  },

  async startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      State.set("mediaStream", stream);
      this._audioCtx = new AudioContext();
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 256;
      const src = this._audioCtx.createMediaStreamSource(stream);
      src.connect(this._analyser);
      document.getElementById("audio-bar-wrap").style.display = "block";
      const data = new Uint8Array(this._analyser.frequencyBinCount);
      const tick = () => {
        this._analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b) / data.length;
        const bar = document.getElementById("audio-bar");
        if (bar) bar.style.width = Utils.clamp(avg * 2, 0, 100) + "%";
        this._audioRAF = requestAnimationFrame(tick);
      };
      tick();
      Utils.toast("Microphone active", "success", 2000);
    } catch (e) {
      Utils.toast(`Mic error: ${e.message}`, "error");
    }
  },

  stopMedia() {
    const stream = State.get("mediaStream");
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      State.set("mediaStream", null);
    }
    if (this._audioRAF) cancelAnimationFrame(this._audioRAF);
    if (this._audioCtx) this._audioCtx.close();
    const v = document.getElementById("camera-preview");
    if (v) v.srcObject = null;
    const bar = document.getElementById("audio-bar-wrap");
    if (bar) bar.style.display = "none";
    Utils.toast("Media stopped", "info", 2000);
  },

  async requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      Utils.toast("Wake Lock not supported", "error");
      return;
    }
    try {
      const wl = await navigator.wakeLock.request("screen");
      State.set("wakeLock", wl);
      const el = document.getElementById("wakelock-status");
      if (el) el.textContent = "Active ✅";
      wl.addEventListener("release", () => {
        if (el) el.textContent = "Released";
        State.set("wakeLock", null);
      });
      Utils.toast("Screen wake lock acquired", "success");
    } catch (e) {
      Utils.toast(`Wake lock error: ${e.message}`, "error");
    }
  },

  releaseWakeLock() {
    const wl = State.get("wakeLock");
    if (wl) {
      wl.release();
      State.set("wakeLock", null);
    }
    const el = document.getElementById("wakelock-status");
    if (el) el.textContent = "Inactive";
    Utils.toast("Wake lock released", "info", 2000);
  },

  async sendNotification() {
    if (!("Notification" in window)) {
      Utils.toast("Notifications not supported", "error");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      new Notification("ProPWA", {
        body: "This is a test notification from ProPWA Enterprise Platform.",
        icon: "icon-192.png",
        badge: "icon-192.png",
        tag: "propwa-test",
        renotify: true
      });
      Utils.toast("Notification sent!", "success");
    } else {
      Utils.toast("Notification permission denied", "error");
    }
  }
};

/* ═══════════════════════════════════════════════════════
   OFFLINE PAGE CONTROLLER
═══════════════════════════════════════════════════════ */
const OfflinePage = {
  async init() {
    await this.refreshCache();
    this.updateSWInfo();
  },

  async refreshCache() {
    const el = document.getElementById("cache-info");
    if (!el) return;
    try {
      if (!("caches" in window)) {
        el.textContent = "Cache API not supported";
        return;
      }
      const keys = await caches.keys();
      let total = "";
      for (const key of keys) {
        const cache = await caches.open(key);
        const reqs = await cache.keys();
        total += `${key}\n  ${reqs.length} items cached\n`;
      }
      el.textContent = total || "No caches found";
    } catch (e) {
      el.textContent = "Error reading cache: " + e.message;
    }
  },

  updateSWInfo() {
    const el = document.getElementById("sw-info");
    if (!el) return;
    if (!("serviceWorker" in navigator)) {
      el.textContent = "Service Worker not supported";
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      el.textContent = [
        `state:    active`,
        `scope:    ${reg.scope}`,
        `update:   ${reg.active?.scriptURL?.split("/").pop() || "sw.js"}`
      ].join("\n");
    });
  },

  async clearCache() {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      Utils.toast("All caches cleared", "success");
      await this.refreshCache();
    } catch (e) {
      Utils.toast("Error clearing cache: " + e.message, "error");
    }
  }
};

/* ═══════════════════════════════════════════════════════
   APP MAIN — initialization
═══════════════════════════════════════════════════════ */
const App = {
  async init() {
    // Register service worker
    await this.registerSW();

    // Init permission statuses
    await PermissionManager.initAll();

    // Init image viewer
    ImageViewer.init();

    // Bind global events
    this.bindEvents();

    // Navigate to current page
    const path = location.pathname.endsWith(".html")
      ? "/" + location.pathname.split("/").pop().replace(".html", "")
      : "/";
    router.navigate(
      ["/", "/permissions", "/viewer", "/device", "/offline"].includes(path)
        ? path
        : "/",
      false
    );

    // Online/offline detection
    window.addEventListener("online", () => {
      State.set("online", true);
      this.updateOfflineBar();
    });
    window.addEventListener("offline", () => {
      State.set("offline", false);
      this.updateOfflineBar();
    });
    this.updateOfflineBar();
  },

  async registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", {
        scope: "./"
      });
      console.info("[ProPWA] SW registered:", reg.scope);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            Utils.toast(
              "Update available — reload for new version",
              "info",
              6000
            );
          }
        });
      });
    } catch (e) {
      console.warn("[ProPWA] SW registration failed:", e);
    }
  },

  bindEvents() {
    // FAB toggle
    document.getElementById("fab").addEventListener("click", (e) => {
      e.stopPropagation();
      menuToggle();
    });

    // Nav items (event delegation)
    document.getElementById("nav-menu").addEventListener("click", (e) => {
      const item = e.target.closest("[data-page]");
      if (item) router.navigate(item.dataset.page);
    });

    // Close menu on outside click
    document.addEventListener("click", (e) => {
      const fab = document.getElementById("fab");
      const menu = document.getElementById("nav-menu");
      if (!fab.contains(e.target) && !menu.contains(e.target)) {
        menuToggle(false);
      }
    });

    // Install prompt
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      State.set("installPrompt", e);
      document.getElementById("install-banner").classList.add("show");
    });

    document
      .getElementById("btn-install")
      .addEventListener("click", async () => {
        const prompt = State.get("installPrompt");
        if (!prompt) return;
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === "accepted") {
          Utils.toast("ProPWA installed successfully! 🎉", "success", 5000);
          document.getElementById("install-banner").classList.remove("show");
        }
        State.set("installPrompt", null);
      });

    document
      .getElementById("btn-install-dismiss")
      .addEventListener("click", () => {
        document.getElementById("install-banner").classList.remove("show");
      });

    window.addEventListener("appinstalled", () => {
      Utils.toast("ProPWA is installed 🎉", "success", 5000);
      document.getElementById("install-banner").classList.remove("show");
    });
  },

  updateOfflineBar() {
    document
      .getElementById("offline-bar")
      .classList.toggle("show", !navigator.onLine);
  }
};
