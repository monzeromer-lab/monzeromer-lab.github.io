"use strict";
// WebFluent Runtime v1.0
// Fine-grained reactivity + DOM helpers + Router + Store + Fetch

const WF = (() => {
  // ─── Reactivity ──────────────────────────────────────
  let currentEffect = null;

  function signal(value) {
    const subs = new Set();
    const get = () => {
      if (currentEffect) subs.add(currentEffect);
      return value;
    };
    const set = (v) => {
      if (typeof v === "function") v = v(value);
      if (v !== value) {
        value = v;
        for (const fn of [...subs]) fn();
      }
    };
    get.set = set;
    get.update = (fn) => set(fn(value));
    get.subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
    return get;
  }

  function effect(fn) {
    const run = () => {
      const prev = currentEffect;
      currentEffect = run;
      try { fn(); } finally { currentEffect = prev; }
    };
    run();
    return run;
  }

  function computed(fn) {
    const s = signal(undefined);
    effect(() => s.set(fn()));
    return s;
  }

  // ─── DOM Helpers ─────────────────────────────────────
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("on:")) {
          el.addEventListener(k.slice(3), v);
        } else if (k === "className" || k === "class") {
          if (typeof v === "function") {
            effect(() => { el.className = v(); });
          } else {
            el.className = v;
          }
        } else if (k === "style" && typeof v === "object") {
          Object.assign(el.style, v);
        } else if (k === "checked") {
          if (typeof v === "function") {
            effect(() => { el.checked = v(); });
          } else {
            el.checked = v;
          }
        } else if (k === "value") {
          if (typeof v === "function") {
            effect(() => { el.value = v(); });
          } else {
            el.value = v;
          }
        } else if (k === "disabled" || k === "multiple" || k === "required" || k === "readOnly") {
          if (typeof v === "function") {
            effect(() => { el[k] = !!v(); });
          } else {
            el[k] = !!v;
          }
        } else if (k === "min" || k === "max" || k === "step") {
          if (typeof v === "function") {
            effect(() => { el[k] = String(v()); });
          } else {
            el[k] = String(v);
          }
        } else if (k === "data-icon") {
          // Render icon as inline SVG or text emoji/symbol
          const iconName = typeof v === "function" ? v() : v;
          _renderIcon(el, iconName);
        } else if (typeof v === "function") {
          effect(() => { el.setAttribute(k, v()); });
        } else if (v != null && v !== false) {
          el.setAttribute(k, v);
        }
      }
    }
    appendChildren(el, children);
    return el;
  }

  function appendChildren(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      if (typeof child === "string" || typeof child === "number") {
        el.appendChild(document.createTextNode(String(child)));
      } else if (child instanceof Node) {
        el.appendChild(child);
      } else if (typeof child === "function") {
        reactiveText(el, child);
      }
    }
  }

  function reactiveText(parent, fn) {
    const node = document.createTextNode("");
    parent.appendChild(node);
    effect(() => { node.textContent = String(fn()); });
    return node;
  }

  function text(fn) {
    if (typeof fn === "function") {
      const node = document.createTextNode("");
      effect(() => { node.textContent = String(fn()); });
      return node;
    }
    return document.createTextNode(String(fn));
  }

  // ─── Animation helpers ──────────────────────────────
  const ANIM_REVERSE = {
    fadeIn: "fadeOut", fadeOut: "fadeIn",
    slideUp: "slideDown", slideDown: "slideUp",
    slideLeft: "slideRight", slideRight: "slideLeft",
    scaleIn: "scaleOut", scaleOut: "scaleIn",
    bounce: "fadeOut", shake: "fadeOut", pulse: "fadeOut",
  };

  function animateIn(el, name, duration, delay) {
    if (!name) return Promise.resolve();
    const cls = "wf-animate-" + name;
    if (duration) el.style.animationDuration = duration;
    if (delay) el.style.animationDelay = delay;
    el.classList.add(cls);
    return new Promise(resolve => {
      const done = () => { el.classList.remove(cls); el.style.animationDuration = ""; el.style.animationDelay = ""; resolve(); };
      el.addEventListener("animationend", done, { once: true });
      // Fallback timeout
      setTimeout(done, (parseInt(duration) || 300) + (parseInt(delay) || 0) + 100);
    });
  }

  function animateOut(el, name, duration) {
    if (!name) return Promise.resolve();
    const cls = "wf-animate-" + name;
    if (duration) el.style.animationDuration = duration;
    el.classList.add(cls);
    return new Promise(resolve => {
      const done = () => { el.classList.remove(cls); el.style.animationDuration = ""; resolve(); };
      el.addEventListener("animationend", done, { once: true });
      setTimeout(done, (parseInt(duration) || 300) + 100);
    });
  }

  function animateEl(target, name, duration) {
    const el = typeof target === "string" ? document.querySelector(`[data-ref="${target}"]`) : target;
    if (!el) return;
    return animateIn(el, name, duration);
  }

  function replayAnimation(el, name, duration) {
    // Remove then re-add the animation class to restart it
    const cls = "wf-animate-" + name;
    el.classList.remove(cls);
    // Force reflow to reset animation
    void el.offsetWidth;
    el.classList.add(cls);
    if (duration) el.style.animationDuration = duration;
  }

  // ─── Conditional rendering ───────────────────────────
  function removeNodes(nodes) {
    for (const n of nodes) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
  }

  function condRender(parent, condFn, thenFn, elseFn, animConfig) {
    const marker = document.createComment("wf-if");
    parent.appendChild(marker);
    let currentNodes = [];
    let lastShow = undefined;
    let pendingRemoval = null; // Track in-progress exit animations

    // Only track the condition signal — not signals read during rendering
    effect(() => {
      const show = !!condFn();
      if (show === lastShow) return;
      lastShow = show;

      // Cancel any pending removal animation
      if (pendingRemoval) {
        removeNodes(pendingRemoval);
        pendingRemoval = null;
      }

      // Remove old nodes
      const toRemove = [...currentNodes];
      currentNodes = [];

      if (animConfig && animConfig.exit && toRemove.length) {
        pendingRemoval = toRemove;
        const exitName = animConfig.exit;
        const promises = toRemove.map(n =>
          n instanceof Element ? animateOut(n, exitName, animConfig.duration) : Promise.resolve()
        );
        Promise.all(promises).then(() => {
          // Only remove if this is still the pending removal (not cancelled by a new toggle)
          if (pendingRemoval === toRemove) {
            removeNodes(toRemove);
            pendingRemoval = null;
          }
        });
      } else {
        removeNodes(toRemove);
      }

      // Add new nodes (untracked so rendering doesn't subscribe this effect to state signals)
      const renderFn = show ? thenFn : elseFn;
      if (renderFn) {
        const prev = currentEffect;
        currentEffect = null; // Untrack: don't subscribe to signals during render
        try {
          const result = renderFn();
          // Collect actual child nodes — DocumentFragments lose children when appended
          let nodes;
          if (result instanceof DocumentFragment) {
            nodes = [...result.childNodes];
          } else {
            nodes = [].concat(result).flat().filter(n => n instanceof Node);
          }
          currentNodes = nodes.slice();
          const frag = document.createDocumentFragment();
          for (const n of nodes) frag.appendChild(n);
          if (marker.parentNode) marker.parentNode.insertBefore(frag, marker.nextSibling);
          if (animConfig && animConfig.enter) {
            nodes.forEach(n => { if (n instanceof Element) animateIn(n, animConfig.enter, animConfig.duration, animConfig.delay); });
          }
        } finally {
          currentEffect = prev;
        }
      }
    });
  }

  // ─── List rendering ─────────────────────────────────
  function listRender(parent, listFn, itemFn, animConfig) {
    const marker = document.createComment("wf-for");
    parent.appendChild(marker);
    let currentNodes = [];

    effect(() => {
      const items = listFn(); // Track the list signal

      // Remove old
      if (animConfig && animConfig.exit && currentNodes.length) {
        const toRemove = [...currentNodes];
        toRemove.forEach((n, i) => {
          if (n instanceof Element) {
            animateOut(n, animConfig.exit, animConfig.duration).then(() => { if (n.parentNode) n.parentNode.removeChild(n); });
          } else {
            if (n.parentNode) n.parentNode.removeChild(n);
          }
        });
      } else {
        removeNodes(currentNodes);
      }
      currentNodes = [];

      // Render items untracked
      const prev = currentEffect;
      currentEffect = null;
      try {
        const frag = document.createDocumentFragment();
        if (items && items.length) {
          items.forEach((item, index) => {
            const result = itemFn(item, index);
            let nodes;
            if (result instanceof DocumentFragment) {
              nodes = [...result.childNodes];
            } else {
              nodes = [].concat(result).flat().filter(n => n instanceof Node);
            }
            for (const n of nodes) {
              frag.appendChild(n);
              currentNodes.push(n);
              if (animConfig && animConfig.enter && n instanceof Element) {
                const delay = animConfig.stagger ? (parseInt(animConfig.stagger) * index) + "ms" : animConfig.delay;
                animateIn(n, animConfig.enter, animConfig.duration, delay);
              }
            }
          });
        }
        if (marker.parentNode) marker.parentNode.insertBefore(frag, marker.nextSibling);
      } finally {
        currentEffect = prev;
      }
    });
  }

  // ─── Show/Hide ───────────────────────────────────────
  function showRender(parent, condFn, contentFn, animConfig) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "contents";
    const nodes = [].concat(contentFn()).flat();
    for (const n of nodes) {
      if (n instanceof Node) wrapper.appendChild(n);
    }
    parent.appendChild(wrapper);

    if (animConfig) {
      effect(() => {
        if (condFn()) {
          wrapper.style.display = "contents";
          if (animConfig.enter) {
            for (const n of wrapper.children) animateIn(n, animConfig.enter, animConfig.duration, animConfig.delay);
          }
        } else {
          if (animConfig.exit) {
            const promises = [...wrapper.children].map(n => animateOut(n, animConfig.exit, animConfig.duration));
            Promise.all(promises).then(() => { wrapper.style.display = "none"; });
          } else {
            wrapper.style.display = "none";
          }
        }
      });
    } else {
      effect(() => {
        wrapper.style.display = condFn() ? "contents" : "none";
      });
    }
  }

  // ─── Router ──────────────────────────────────────────
  let routerInstance = null;

  // ─── Router ──────────────────────────────────────────
  // Base path for deployment (set via WF.setBasePath or config)
  let _basePath = "";

  function _stripBase(fullPath) {
    if (_basePath && fullPath.startsWith(_basePath)) {
      const stripped = fullPath.slice(_basePath.length);
      return stripped || "/";
    }
    return fullPath;
  }

  function createRouter(routes, container) {
    // Check for SPA redirect from 404.html (?p=/path)
    const urlParams = new URLSearchParams(window.location.search);
    const redirectPath = urlParams.get("p");
    if (redirectPath) {
      window.history.replaceState(null, "", _basePath + redirectPath);
    }

    const initialPath = _stripBase(window.location.pathname);
    const currentPath = signal(initialPath);

    function matchRoute(path) {
      for (const route of routes) {
        const params = matchPath(route.path, path);
        if (params !== null) return { route, params };
      }
      // Try wildcard
      const wild = routes.find(r => r.path === "*");
      if (wild) return { route: wild, params: {} };
      return null;
    }

    function matchPath(pattern, path) {
      if (pattern === path) return {};
      const patternParts = pattern.split("/").filter(Boolean);
      const pathParts = path.split("/").filter(Boolean);
      if (patternParts.length !== pathParts.length) return null;

      const params = {};
      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
          params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          return null;
        }
      }
      return params;
    }

    function render() {
      const path = currentPath(); // Only subscribe to path changes
      const match = matchRoute(path);
      container.innerHTML = "";

      if (match) {
        // Untrack: don't subscribe the router effect to signals read during page render
        const prev = currentEffect;
        currentEffect = null;
        try {
          const el = match.route.render(match.params);
          if (el instanceof Node) container.appendChild(el);
        } finally {
          currentEffect = prev;
        }
      }
    }

    window.addEventListener("popstate", () => {
      currentPath.set(_stripBase(window.location.pathname));
    });

    effect(render);

    routerInstance = {
      navigate: (path) => {
        window.history.pushState(null, "", _basePath + path);
        currentPath.set(path);
      },
      currentPath,
      back: () => window.history.back(),
      forward: () => window.history.forward(),
    };

    return routerInstance;
  }

  let _ssgMode = false;
  function setSsgMode(enabled) { _ssgMode = enabled; }
  function setBasePath(path) { _basePath = path.replace(/\/$/, ""); }

  function navigate(path) {
    if (_ssgMode) {
      // SSG: full page load to the pre-rendered HTML file
      window.location.href = _basePath + path;
    } else if (routerInstance) {
      routerInstance.navigate(path);
    } else {
      window.location.href = path;
    }
  }

  function getParams() {
    return routerInstance ? routerInstance._currentParams || {} : {};
  }

  // ─── Store ───────────────────────────────────────────
  function createStore(definition) {
    const store = {};
    const states = {};

    // Create signals for each state
    if (definition.state) {
      for (const [key, val] of Object.entries(definition.state)) {
        const s = signal(typeof val === "function" ? val() : val);
        states[key] = s;
        Object.defineProperty(store, key, {
          get: () => s(),
          set: (v) => s.set(v),
        });
      }
    }

    // Create computed for derived
    if (definition.derived) {
      for (const [key, fn] of Object.entries(definition.derived)) {
        const c = computed(() => fn(store));
        Object.defineProperty(store, key, { get: () => c() });
      }
    }

    // Bind actions
    if (definition.actions) {
      for (const [key, fn] of Object.entries(definition.actions)) {
        store[key] = (...args) => fn(store, ...args);
      }
    }

    return store;
  }

  // ─── Fetch ───────────────────────────────────────────
  function wfFetch(url, options, callbacks) {
    const container = document.createDocumentFragment();
    const wrapper = document.createElement("div");
    wrapper.style.display = "contents";

    const loading = signal(true);
    const error = signal(null);
    const data = signal(null);

    // Show loading
    if (callbacks.loading) {
      const loadingEl = document.createElement("div");
      loadingEl.style.display = "contents";
      const nodes = [].concat(callbacks.loading()).flat();
      for (const n of nodes) { if (n instanceof Node) loadingEl.appendChild(n); }
      wrapper.appendChild(loadingEl);
      effect(() => { loadingEl.style.display = loading() ? "contents" : "none"; });
    }

    // Success container
    const successEl = document.createElement("div");
    successEl.style.display = "contents";
    wrapper.appendChild(successEl);

    // Error container
    const errorEl = document.createElement("div");
    errorEl.style.display = "contents";
    wrapper.appendChild(errorEl);

    const resolvedUrl = typeof url === "function" ? url() : url;

    const doFetch = () => {
      const fetchUrl = typeof url === "function" ? url() : url;
      loading.set(true);
      error.set(null);

      const fetchOpts = {};
      if (options) {
        if (options.method) fetchOpts.method = options.method;
        if (options.headers) fetchOpts.headers = options.headers;
        if (options.body) {
          fetchOpts.body = JSON.stringify(typeof options.body === "function" ? options.body() : options.body);
          fetchOpts.headers = { "Content-Type": "application/json", ...(fetchOpts.headers || {}) };
        }
      }

      fetch(fetchUrl, fetchOpts)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => {
          data.set(d);
          loading.set(false);
          if (callbacks.success) {
            successEl.innerHTML = "";
            const nodes = [].concat(callbacks.success(d)).flat();
            for (const n of nodes) { if (n instanceof Node) successEl.appendChild(n); }
          }
        })
        .catch(e => {
          error.set(e);
          loading.set(false);
          if (callbacks.error) {
            errorEl.innerHTML = "";
            const nodes = [].concat(callbacks.error(e)).flat();
            for (const n of nodes) { if (n instanceof Node) errorEl.appendChild(n); }
          }
        });
    };

    doFetch();

    return wrapper;
  }

  // ─── Toast ───────────────────────────────────────────
  let toastContainer = null;

  function showToast(message, variant, duration) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.className = "wf-toast-container";
      document.body.appendChild(toastContainer);
    }
    const toast = document.createElement("div");
    toast.className = `wf-toast wf-toast--${variant || "info"}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.classList.add("wf-toast--exit"); setTimeout(() => toast.remove(), 300); }, duration || 3000);
  }

  // ─── Mount ───────────────────────────────────────────
  function mount(renderFn, container) {
    const el = renderFn();
    if (el instanceof Node) {
      container.innerHTML = "";
      container.appendChild(el);
    }
  }

  // ─── Hydrate (SSG) ─────────────────────────────────
  function hydrate(renderFn, container) {
    // If container already has pre-rendered content, keep it and
    // run the render function to initialize signals, effects, and events.
    // The render function builds DOM nodes that won't be inserted —
    // instead, the existing DOM is kept and JS takes over.
    if (container.children.length > 0) {
      // Run render to initialize all signals and effects
      renderFn();
      // The effects will find and update the existing DOM nodes
    } else {
      // No pre-rendered content — fall back to full mount
      mount(renderFn, container);
    }
  }

  // ─── i18n ────────────────────────────────────────────
  const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);
  let i18nInstance = null;

  function createI18n(defaultLocale, translations) {
    const locale = signal(defaultLocale);
    const dir = signal(RTL_LOCALES.has(defaultLocale) ? "rtl" : "ltr");

    function t(key, params) {
      const currentLocale = locale();
      const messages = translations[currentLocale] || translations[defaultLocale] || {};
      let text = messages[key];
      // Fallback to default locale
      if (text === undefined && currentLocale !== defaultLocale) {
        const fallback = translations[defaultLocale] || {};
        text = fallback[key];
      }
      // Fallback to key itself
      if (text === undefined) return key;
      // Interpolate {placeholder} tokens
      if (params && text.includes("{")) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
        }
      }
      return text;
    }

    function setLocale(newLocale) {
      locale.set(newLocale);
      const newDir = RTL_LOCALES.has(newLocale) ? "rtl" : "ltr";
      dir.set(newDir);
      document.documentElement.setAttribute("lang", newLocale);
      document.documentElement.setAttribute("dir", newDir);
    }

    i18nInstance = { t, locale, dir, setLocale };
    return i18nInstance;
  }

  // ─── Icon System ────────────────────────────────────
  // Built-in SVG icons for common UI needs
  const _ICONS = {
    close: '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    search: '<circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    home: '<path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/>',
    check: '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    "chevron-down": '<polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    "chevron-right": '<polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    "chevron-left": '<polyline points="15 18 9 12 15 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    edit: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" fill="none" stroke="currentColor" stroke-width="2"/>',
    trash: '<polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" fill="none" stroke="currentColor" stroke-width="2"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="22,6 12,13 2,6" fill="none" stroke="currentColor" stroke-width="2"/>',
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
    link: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    info: '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12.01" y2="8" stroke="currentColor" stroke-width="2"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2"/>',
    "arrow-left": '<line x1="19" y1="12" x2="5" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="12 19 5 12 12 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    "arrow-right": '<line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="12 5 19 12 12 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" fill="none" stroke="currentColor" stroke-width="2"/>',
  };

  function _renderIcon(el, name) {
    const svgData = _ICONS[name];
    if (svgData) {
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none">${svgData}</svg>`;
    } else {
      // Fallback: render name as text
      el.textContent = name;
    }
  }

  // ─── Exports ─────────────────────────────────────────
  return {
    signal, effect, computed,
    h, text, reactiveText, appendChildren,
    condRender, listRender, showRender,
    animateIn, animateOut, animateEl, replayAnimation,
    createRouter, navigate, getParams,
    createStore,
    createI18n,
    wfFetch, showToast,
    mount, hydrate, setSsgMode, setBasePath,
    get _basePath() { return _basePath; },
    i18n: null,
  };
})();


WF.setSsgMode(true);
const NavStore = WF.createStore({
  state: {
    sidebarOpen: false,
  },
  actions: {
    toggle: (store) => {
      store.sidebarOpen = !store.sidebarOpen;
    },
    close: (store) => {
      store.sidebarOpen = false;
    },
  },
});

function Page_Contact(params) {
  const _root = document.createDocumentFragment();
  const _e0 = WF.h("div", { className: "wf-container" });
  const _e1 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e2 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Let's build something robust.");
  _e2.style.fontSize = "2rem";
  _e2.style.fontWeight = "700";
  _e2.style.color = "#E8E6E1";
  _e2.style.letterSpacing = "-0.02em";
  _e2.style.marginBottom = "1rem";
  _e1.appendChild(_e2);
  const _e3 = WF.h("p", { className: "wf-text wf-text--muted" }, "Available for senior backend roles, architecture consulting, and high-impact engineering challenges.");
  _e3.style.color = "#8C8B88";
  _e3.style.fontSize = "1rem";
  _e3.style.lineHeight = "1.7";
  _e3.style.marginBottom = "2rem";
  _e3.style.maxWidth = "500px";
  _e1.appendChild(_e3);
  const _e4 = WF.h("div", { className: "wf-spacer" });
  _e1.appendChild(_e4);
  const _e5 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e6 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e7 = WF.h("p", { className: "wf-text wf-text--muted" }, "Email");
  _e7.style.color = "#8C8B88";
  _e7.style.fontSize = "0.85rem";
  _e7.style.minWidth = "80px";
  _e6.appendChild(_e7);
  const _e8 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e9 = WF.h("p", { className: "wf-text" }, "monzer.a.omer@gmail.com");
  _e9.style.color = "#C69C6D";
  _e9.style.fontFamily = "JetBrains Mono, monospace";
  _e9.style.fontSize = "0.95rem";
  _e8.appendChild(_e9);
  _e6.appendChild(_e8);
  _e5.appendChild(_e6);
  const _e10 = WF.h("hr", { className: "wf-divider" });
  _e10.style.borderColor = "#2D2C2A";
  _e10.style.margin = "0.5rem 0";
  _e5.appendChild(_e10);
  const _e11 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e12 = WF.h("p", { className: "wf-text wf-text--muted" }, "LinkedIn");
  _e12.style.color = "#8C8B88";
  _e12.style.fontSize = "0.85rem";
  _e12.style.minWidth = "80px";
  _e11.appendChild(_e12);
  const _e13 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
  const _e14 = WF.h("p", { className: "wf-text" }, "linkedin.com/in/monzeromer");
  _e14.style.color = "#C69C6D";
  _e14.style.fontFamily = "JetBrains Mono, monospace";
  _e14.style.fontSize = "0.95rem";
  _e13.appendChild(_e14);
  _e11.appendChild(_e13);
  _e5.appendChild(_e11);
  const _e15 = WF.h("hr", { className: "wf-divider" });
  _e15.style.borderColor = "#2D2C2A";
  _e15.style.margin = "0.5rem 0";
  _e5.appendChild(_e15);
  const _e16 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e17 = WF.h("p", { className: "wf-text wf-text--muted" }, "GitHub");
  _e17.style.color = "#8C8B88";
  _e17.style.fontSize = "0.85rem";
  _e17.style.minWidth = "80px";
  _e16.appendChild(_e17);
  const _e18 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e19 = WF.h("p", { className: "wf-text" }, "github.com/monzeromer-lab");
  _e19.style.color = "#C69C6D";
  _e19.style.fontFamily = "JetBrains Mono, monospace";
  _e19.style.fontSize = "0.95rem";
  _e18.appendChild(_e19);
  _e16.appendChild(_e18);
  _e5.appendChild(_e16);
  _e1.appendChild(_e5);
  _e0.appendChild(_e1);
  _e0.style.maxWidth = "800px";
  _e0.style.margin = "0 auto";
  _e0.style.padding = "80px 2rem";
  _e0.style.minHeight = "60vh";
  _e0.style.display = "flex";
  _e0.style.flexDirection = "column";
  _e0.style.justifyContent = "center";
  _e0.classList.add("wf-s20");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s20 { padding: 60px 1.5rem; min-height: 50vh; } } @media (max-width: 480px) { .wf-s20 { padding: 40px 1rem; min-height: auto; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e0);
  return _root;
}

function Page_History(params) {
  const _root = document.createDocumentFragment();
  const _e21 = WF.h("div", { className: "wf-container" });
  const _e22 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e23 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Work History");
  _e23.style.fontSize = "2rem";
  _e23.style.fontWeight = "700";
  _e23.style.color = "#E8E6E1";
  _e23.style.letterSpacing = "-0.02em";
  _e23.style.marginBottom = "1rem";
  _e22.appendChild(_e23);
  const _e24 = WF.h("p", { className: "wf-text wf-text--muted" }, "A reverse-chronological record of roles, responsibilities, and impact.");
  _e24.style.color = "#8C8B88";
  _e24.style.fontSize = "1rem";
  _e24.style.marginBottom = "3rem";
  _e22.appendChild(_e24);
  const _e25 = WF.h("div", { className: "wf-spacer" });
  _e22.appendChild(_e25);
  const _e26 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e27 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e28 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e29 = WF.h("p", { className: "wf-text wf-text--bold" }, "SilverKey Technologies");
  _e29.style.fontSize = "1.2rem";
  _e29.style.color = "#E8E6E1";
  _e28.appendChild(_e29);
  const _e30 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Mar 2025 — Present");
  _e30.style.color = "#C69C6D";
  _e30.style.fontFamily = "JetBrains Mono, monospace";
  _e30.style.fontSize = "0.8rem";
  _e28.appendChild(_e30);
  _e27.appendChild(_e28);
  const _e31 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Node.js Developer");
  _e31.style.color = "#8C8B88";
  _e31.style.fontSize = "0.95rem";
  _e27.appendChild(_e31);
  const _e32 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e32);
  const _e33 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e34 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained core backend functionality to improve reliability and performance across web and mobile platforms.");
  _e34.style.color = "#E8E6E1";
  _e34.style.lineHeight = "1.7";
  _e34.style.fontSize = "0.95rem";
  _e33.appendChild(_e34);
  const _e35 = WF.h("p", { className: "wf-text" }, "Integrated Firebase Analytics, Adjust, and MoEngage to enable data-driven marketing and user engagement strategies.");
  _e35.style.color = "#E8E6E1";
  _e35.style.lineHeight = "1.7";
  _e35.style.fontSize = "0.95rem";
  _e33.appendChild(_e35);
  const _e36 = WF.h("p", { className: "wf-text" }, "Optimized product view endpoints and resolved crawler-related issues to enhance SEO and product discoverability.");
  _e36.style.color = "#E8E6E1";
  _e36.style.lineHeight = "1.7";
  _e36.style.fontSize = "0.95rem";
  _e33.appendChild(_e36);
  const _e37 = WF.h("p", { className: "wf-text" }, "Built a high-performance image processing microservice using Rust, achieving an average performance increase of over 98%.");
  _e37.style.color = "#E8E6E1";
  _e37.style.lineHeight = "1.7";
  _e37.style.fontSize = "0.95rem";
  _e33.appendChild(_e37);
  const _e38 = WF.h("p", { className: "wf-text" }, "Migrated the codebase to TypeScript, improving code maintainability, type safety, and long-term scalability.");
  _e38.style.color = "#E8E6E1";
  _e38.style.lineHeight = "1.7";
  _e38.style.fontSize = "0.95rem";
  _e33.appendChild(_e38);
  const _e39 = WF.h("p", { className: "wf-text" }, "Improved internal documentation and tooling, streamlining onboarding and enhancing cross-team collaboration.");
  _e39.style.color = "#E8E6E1";
  _e39.style.lineHeight = "1.7";
  _e39.style.fontSize = "0.95rem";
  _e33.appendChild(_e39);
  const _e40 = WF.h("p", { className: "wf-text" }, "Improved platform performance by optimizing queries and system design.");
  _e40.style.color = "#E8E6E1";
  _e40.style.lineHeight = "1.7";
  _e40.style.fontSize = "0.95rem";
  _e33.appendChild(_e40);
  _e27.appendChild(_e33);
  const _e41 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e41);
  const _e42 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e43 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e43.style.fontFamily = "JetBrains Mono, monospace";
  _e43.style.background = "#C69C6D";
  _e43.style.color = "#1A1A19";
  _e43.style.padding = "0.25rem 0.75rem";
  _e43.style.borderRadius = "0.375rem";
  _e43.style.fontSize = "0.75rem";
  _e43.style.fontWeight = "600";
  _e42.appendChild(_e43);
  const _e44 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e44.style.fontFamily = "JetBrains Mono, monospace";
  _e44.style.background = "#2D2C2A";
  _e44.style.color = "#E8E6E1";
  _e44.style.padding = "0.25rem 0.75rem";
  _e44.style.borderRadius = "0.375rem";
  _e44.style.fontSize = "0.75rem";
  _e42.appendChild(_e44);
  const _e45 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e45.style.fontFamily = "JetBrains Mono, monospace";
  _e45.style.background = "#2D2C2A";
  _e45.style.color = "#E8E6E1";
  _e45.style.padding = "0.25rem 0.75rem";
  _e45.style.borderRadius = "0.375rem";
  _e45.style.fontSize = "0.75rem";
  _e42.appendChild(_e45);
  const _e46 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e46.style.fontFamily = "JetBrains Mono, monospace";
  _e46.style.background = "#2D2C2A";
  _e46.style.color = "#E8E6E1";
  _e46.style.padding = "0.25rem 0.75rem";
  _e46.style.borderRadius = "0.375rem";
  _e46.style.fontSize = "0.75rem";
  _e42.appendChild(_e46);
  _e27.appendChild(_e42);
  _e26.appendChild(_e27);
  _e26.style.background = "#242422";
  _e26.style.border = "1px solid #2D2C2A";
  _e26.style.borderRadius = "0.75rem";
  _e26.style.padding = "2rem";
  _e26.style.marginBottom = "2rem";
  _e22.appendChild(_e26);
  const _e47 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e48 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e49 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e50 = WF.h("p", { className: "wf-text wf-text--bold" }, "Ecom Payments");
  _e50.style.fontSize = "1.2rem";
  _e50.style.color = "#E8E6E1";
  _e49.appendChild(_e50);
  const _e51 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Aug 2024 — Feb 2025");
  _e51.style.color = "#C69C6D";
  _e51.style.fontFamily = "JetBrains Mono, monospace";
  _e51.style.fontSize = "0.8rem";
  _e49.appendChild(_e51);
  _e48.appendChild(_e49);
  const _e52 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e52.style.color = "#8C8B88";
  _e52.style.fontSize = "0.95rem";
  _e48.appendChild(_e52);
  const _e53 = WF.h("div", { className: "wf-spacer" });
  _e48.appendChild(_e53);
  const _e54 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e55 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained high-performance, scalable microservices using NestJS, enabling seamless integration with front-end systems and third-party APIs.");
  _e55.style.color = "#E8E6E1";
  _e55.style.lineHeight = "1.7";
  _e55.style.fontSize = "0.95rem";
  _e54.appendChild(_e55);
  const _e56 = WF.h("p", { className: "wf-text" }, "Built and managed microservices for document generation, file storage, and file uploads, implementing AES encryption to ensure data security and compliance.");
  _e56.style.color = "#E8E6E1";
  _e56.style.lineHeight = "1.7";
  _e56.style.fontSize = "0.95rem";
  _e54.appendChild(_e56);
  const _e57 = WF.h("p", { className: "wf-text" }, "Developed a merchant management microservice to handle critical merchant data, including bank details, user information, payment methods, and fee structures.");
  _e57.style.color = "#E8E6E1";
  _e57.style.lineHeight = "1.7";
  _e57.style.fontSize = "0.95rem";
  _e54.appendChild(_e57);
  const _e58 = WF.h("p", { className: "wf-text" }, "Created a statistics microservice to calculate and analyze key metrics, providing actionable insights for business decision-making.");
  _e58.style.color = "#E8E6E1";
  _e58.style.lineHeight = "1.7";
  _e58.style.fontSize = "0.95rem";
  _e54.appendChild(_e58);
  const _e59 = WF.h("p", { className: "wf-text" }, "Utilized RabbitMQ for efficient message queuing and Docker for containerization, streamlining deployment processes and improving system reliability.");
  _e59.style.color = "#E8E6E1";
  _e59.style.lineHeight = "1.7";
  _e59.style.fontSize = "0.95rem";
  _e54.appendChild(_e59);
  _e48.appendChild(_e54);
  const _e60 = WF.h("div", { className: "wf-spacer" });
  _e48.appendChild(_e60);
  const _e61 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e62 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e62.style.fontFamily = "JetBrains Mono, monospace";
  _e62.style.background = "#2D2C2A";
  _e62.style.color = "#E8E6E1";
  _e62.style.padding = "0.25rem 0.75rem";
  _e62.style.borderRadius = "0.375rem";
  _e62.style.fontSize = "0.75rem";
  _e61.appendChild(_e62);
  const _e63 = WF.h("span", { className: "wf-badge" }, "RabbitMQ");
  _e63.style.fontFamily = "JetBrains Mono, monospace";
  _e63.style.background = "#2D2C2A";
  _e63.style.color = "#E8E6E1";
  _e63.style.padding = "0.25rem 0.75rem";
  _e63.style.borderRadius = "0.375rem";
  _e63.style.fontSize = "0.75rem";
  _e61.appendChild(_e63);
  const _e64 = WF.h("span", { className: "wf-badge" }, "Docker");
  _e64.style.fontFamily = "JetBrains Mono, monospace";
  _e64.style.background = "#2D2C2A";
  _e64.style.color = "#E8E6E1";
  _e64.style.padding = "0.25rem 0.75rem";
  _e64.style.borderRadius = "0.375rem";
  _e64.style.fontSize = "0.75rem";
  _e61.appendChild(_e64);
  const _e65 = WF.h("span", { className: "wf-badge" }, "AES");
  _e65.style.fontFamily = "JetBrains Mono, monospace";
  _e65.style.background = "#2D2C2A";
  _e65.style.color = "#E8E6E1";
  _e65.style.padding = "0.25rem 0.75rem";
  _e65.style.borderRadius = "0.375rem";
  _e65.style.fontSize = "0.75rem";
  _e61.appendChild(_e65);
  _e48.appendChild(_e61);
  _e47.appendChild(_e48);
  _e47.style.background = "#242422";
  _e47.style.border = "1px solid #2D2C2A";
  _e47.style.borderRadius = "0.75rem";
  _e47.style.padding = "2rem";
  _e47.style.marginBottom = "2rem";
  _e22.appendChild(_e47);
  const _e66 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e67 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e68 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e69 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e69.style.fontSize = "1.2rem";
  _e69.style.color = "#E8E6E1";
  _e68.appendChild(_e69);
  const _e70 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Dec 2022 — Jan 2024");
  _e70.style.color = "#C69C6D";
  _e70.style.fontFamily = "JetBrains Mono, monospace";
  _e70.style.fontSize = "0.8rem";
  _e68.appendChild(_e70);
  _e67.appendChild(_e68);
  const _e71 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e71.style.color = "#8C8B88";
  _e71.style.fontSize = "0.95rem";
  _e67.appendChild(_e71);
  const _e72 = WF.h("div", { className: "wf-spacer" });
  _e67.appendChild(_e72);
  const _e73 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e74 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained a highly scalable Healthcare Management System (HMS) using a microservices architecture, leveraging GraphQL for optimized data fetching and Kafka for real-time data streaming and event-driven communication.");
  _e74.style.color = "#E8E6E1";
  _e74.style.lineHeight = "1.7";
  _e74.style.fontSize = "0.95rem";
  _e73.appendChild(_e74);
  const _e75 = WF.h("p", { className: "wf-text" }, "Built and enhanced a Community & Learning Platform to foster knowledge sharing and collaboration among users, ensuring seamless performance and scalability.");
  _e75.style.color = "#E8E6E1";
  _e75.style.lineHeight = "1.7";
  _e75.style.fontSize = "0.95rem";
  _e73.appendChild(_e75);
  const _e76 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers to deliver high-quality, user-centric features, ensuring smooth integration between backend services and frontend applications.");
  _e76.style.color = "#E8E6E1";
  _e76.style.lineHeight = "1.7";
  _e76.style.fontSize = "0.95rem";
  _e73.appendChild(_e76);
  const _e77 = WF.h("p", { className: "wf-text" }, "Continuously expanded technical expertise by mastering NestJS, Rust, and GraphQL, applying these technologies to optimize platform performance, reliability, and maintainability.");
  _e77.style.color = "#E8E6E1";
  _e77.style.lineHeight = "1.7";
  _e77.style.fontSize = "0.95rem";
  _e73.appendChild(_e77);
  _e67.appendChild(_e73);
  const _e78 = WF.h("div", { className: "wf-spacer" });
  _e67.appendChild(_e78);
  const _e79 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e80 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e80.style.fontFamily = "JetBrains Mono, monospace";
  _e80.style.background = "#2D2C2A";
  _e80.style.color = "#E8E6E1";
  _e80.style.padding = "0.25rem 0.75rem";
  _e80.style.borderRadius = "0.375rem";
  _e80.style.fontSize = "0.75rem";
  _e79.appendChild(_e80);
  const _e81 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e81.style.fontFamily = "JetBrains Mono, monospace";
  _e81.style.background = "#2D2C2A";
  _e81.style.color = "#E8E6E1";
  _e81.style.padding = "0.25rem 0.75rem";
  _e81.style.borderRadius = "0.375rem";
  _e81.style.fontSize = "0.75rem";
  _e79.appendChild(_e81);
  const _e82 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e82.style.fontFamily = "JetBrains Mono, monospace";
  _e82.style.background = "#2D2C2A";
  _e82.style.color = "#E8E6E1";
  _e82.style.padding = "0.25rem 0.75rem";
  _e82.style.borderRadius = "0.375rem";
  _e82.style.fontSize = "0.75rem";
  _e79.appendChild(_e82);
  const _e83 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e83.style.fontFamily = "JetBrains Mono, monospace";
  _e83.style.background = "#2D2C2A";
  _e83.style.color = "#E8E6E1";
  _e83.style.padding = "0.25rem 0.75rem";
  _e83.style.borderRadius = "0.375rem";
  _e83.style.fontSize = "0.75rem";
  _e79.appendChild(_e83);
  _e67.appendChild(_e79);
  _e66.appendChild(_e67);
  _e66.style.background = "#242422";
  _e66.style.border = "1px solid #2D2C2A";
  _e66.style.borderRadius = "0.75rem";
  _e66.style.padding = "2rem";
  _e66.style.marginBottom = "2rem";
  _e22.appendChild(_e66);
  const _e84 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e85 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e86 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e87 = WF.h("p", { className: "wf-text wf-text--bold" }, "Alimny");
  _e87.style.fontSize = "1.2rem";
  _e87.style.color = "#E8E6E1";
  _e86.appendChild(_e87);
  const _e88 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Jan 2021 — Dec 2022");
  _e88.style.color = "#C69C6D";
  _e88.style.fontFamily = "JetBrains Mono, monospace";
  _e88.style.fontSize = "0.8rem";
  _e86.appendChild(_e88);
  _e85.appendChild(_e86);
  const _e89 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer & Co-founder");
  _e89.style.color = "#8C8B88";
  _e89.style.fontSize = "0.95rem";
  _e85.appendChild(_e89);
  const _e90 = WF.h("div", { className: "wf-spacer" });
  _e85.appendChild(_e90);
  const _e91 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e92 = WF.h("p", { className: "wf-text" }, "Co-founded a startup providing innovative and accessible e-learning solutions for students and teachers, using technologies such as web development, machine learning, and cloud computing to make education more engaging and effective.");
  _e92.style.color = "#E8E6E1";
  _e92.style.lineHeight = "1.7";
  _e92.style.fontSize = "0.95rem";
  _e91.appendChild(_e92);
  const _e93 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained server-side logic, APIs, and databases for web applications powering the e-learning platform using Node.js, Express.js, MongoDB, GraphQL, and Firebase.");
  _e93.style.color = "#E8E6E1";
  _e93.style.lineHeight = "1.7";
  _e93.style.fontSize = "0.95rem";
  _e91.appendChild(_e93);
  const _e94 = WF.h("p", { className: "wf-text" }, "Developed a robust authentication system using JWT and Firebase, and optimized database queries and indexes to improve response time and reduce server load.");
  _e94.style.color = "#E8E6E1";
  _e94.style.lineHeight = "1.7";
  _e94.style.fontSize = "0.95rem";
  _e91.appendChild(_e94);
  const _e95 = WF.h("p", { className: "wf-text" }, "Wrote unit tests and documentation for the codebase, and collaborated with co-founders and frontend developers to ensure application quality and performance.");
  _e95.style.color = "#E8E6E1";
  _e95.style.lineHeight = "1.7";
  _e95.style.fontSize = "0.95rem";
  _e91.appendChild(_e95);
  _e85.appendChild(_e91);
  const _e96 = WF.h("div", { className: "wf-spacer" });
  _e85.appendChild(_e96);
  const _e97 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e98 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e98.style.fontFamily = "JetBrains Mono, monospace";
  _e98.style.background = "#2D2C2A";
  _e98.style.color = "#E8E6E1";
  _e98.style.padding = "0.25rem 0.75rem";
  _e98.style.borderRadius = "0.375rem";
  _e98.style.fontSize = "0.75rem";
  _e97.appendChild(_e98);
  const _e99 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e99.style.fontFamily = "JetBrains Mono, monospace";
  _e99.style.background = "#2D2C2A";
  _e99.style.color = "#E8E6E1";
  _e99.style.padding = "0.25rem 0.75rem";
  _e99.style.borderRadius = "0.375rem";
  _e99.style.fontSize = "0.75rem";
  _e97.appendChild(_e99);
  const _e100 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e100.style.fontFamily = "JetBrains Mono, monospace";
  _e100.style.background = "#2D2C2A";
  _e100.style.color = "#E8E6E1";
  _e100.style.padding = "0.25rem 0.75rem";
  _e100.style.borderRadius = "0.375rem";
  _e100.style.fontSize = "0.75rem";
  _e97.appendChild(_e100);
  const _e101 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e101.style.fontFamily = "JetBrains Mono, monospace";
  _e101.style.background = "#2D2C2A";
  _e101.style.color = "#E8E6E1";
  _e101.style.padding = "0.25rem 0.75rem";
  _e101.style.borderRadius = "0.375rem";
  _e101.style.fontSize = "0.75rem";
  _e97.appendChild(_e101);
  _e85.appendChild(_e97);
  _e84.appendChild(_e85);
  _e84.style.background = "#242422";
  _e84.style.border = "1px solid #2D2C2A";
  _e84.style.borderRadius = "0.75rem";
  _e84.style.padding = "2rem";
  _e84.style.marginBottom = "2rem";
  _e22.appendChild(_e84);
  const _e102 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e103 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e104 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e105 = WF.h("p", { className: "wf-text wf-text--bold" }, "EnayaTech");
  _e105.style.fontSize = "1.2rem";
  _e105.style.color = "#E8E6E1";
  _e104.appendChild(_e105);
  const _e106 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Feb 2020 — Jul 2020");
  _e106.style.color = "#C69C6D";
  _e106.style.fontFamily = "JetBrains Mono, monospace";
  _e106.style.fontSize = "0.8rem";
  _e104.appendChild(_e106);
  _e103.appendChild(_e104);
  const _e107 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e107.style.color = "#8C8B88";
  _e107.style.fontSize = "0.95rem";
  _e103.appendChild(_e107);
  const _e108 = WF.h("div", { className: "wf-spacer" });
  _e103.appendChild(_e108);
  const _e109 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e110 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained RESTful APIs using Express.js, MySQL, and MongoDB to support various web applications, gaining hands-on experience in backend development.");
  _e110.style.color = "#E8E6E1";
  _e110.style.lineHeight = "1.7";
  _e110.style.fontSize = "0.95rem";
  _e109.appendChild(_e110);
  const _e111 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers, designers, and product managers to deliver high-quality features and seamless user experiences.");
  _e111.style.color = "#E8E6E1";
  _e111.style.lineHeight = "1.7";
  _e111.style.fontSize = "0.95rem";
  _e109.appendChild(_e111);
  const _e112 = WF.h("p", { className: "wf-text" }, "Actively learned and applied new technologies and tools, participated in code reviews, documentation, and testing processes to contribute to overall codebase quality.");
  _e112.style.color = "#E8E6E1";
  _e112.style.lineHeight = "1.7";
  _e112.style.fontSize = "0.95rem";
  _e109.appendChild(_e112);
  _e103.appendChild(_e109);
  const _e113 = WF.h("div", { className: "wf-spacer" });
  _e103.appendChild(_e113);
  const _e114 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e115 = WF.h("span", { className: "wf-badge" }, "Express.js");
  _e115.style.fontFamily = "JetBrains Mono, monospace";
  _e115.style.background = "#2D2C2A";
  _e115.style.color = "#E8E6E1";
  _e115.style.padding = "0.25rem 0.75rem";
  _e115.style.borderRadius = "0.375rem";
  _e115.style.fontSize = "0.75rem";
  _e114.appendChild(_e115);
  const _e116 = WF.h("span", { className: "wf-badge" }, "MySQL");
  _e116.style.fontFamily = "JetBrains Mono, monospace";
  _e116.style.background = "#2D2C2A";
  _e116.style.color = "#E8E6E1";
  _e116.style.padding = "0.25rem 0.75rem";
  _e116.style.borderRadius = "0.375rem";
  _e116.style.fontSize = "0.75rem";
  _e114.appendChild(_e116);
  const _e117 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e117.style.fontFamily = "JetBrains Mono, monospace";
  _e117.style.background = "#2D2C2A";
  _e117.style.color = "#E8E6E1";
  _e117.style.padding = "0.25rem 0.75rem";
  _e117.style.borderRadius = "0.375rem";
  _e117.style.fontSize = "0.75rem";
  _e114.appendChild(_e117);
  _e103.appendChild(_e114);
  _e102.appendChild(_e103);
  _e102.style.background = "#242422";
  _e102.style.border = "1px solid #2D2C2A";
  _e102.style.borderRadius = "0.75rem";
  _e102.style.padding = "2rem";
  _e102.style.marginBottom = "2rem";
  _e22.appendChild(_e102);
  _e21.appendChild(_e22);
  _e21.style.maxWidth = "800px";
  _e21.style.margin = "0 auto";
  _e21.style.padding = "80px 2rem";
  _e21.classList.add("wf-s118");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s118 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s118 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e21);
  return _root;
}

function Page_Projects(params) {
  const _root = document.createDocumentFragment();
  const _e119 = WF.h("div", { className: "wf-container" });
  const _e120 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e121 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Projects");
  _e121.style.fontSize = "2rem";
  _e121.style.fontWeight = "700";
  _e121.style.color = "#E8E6E1";
  _e121.style.letterSpacing = "-0.02em";
  _e121.style.marginBottom = "1rem";
  _e120.appendChild(_e121);
  const _e122 = WF.h("p", { className: "wf-text wf-text--muted wf-animate-fadeIn" }, "Things I've designed, built, and shipped.");
  _e122.style.color = "#8C8B88";
  _e122.style.fontSize = "1rem";
  _e122.style.marginBottom = "3rem";
  _e120.appendChild(_e122);
  const _e123 = WF.h("div", { className: "wf-spacer" });
  _e120.appendChild(_e123);
  const _e124 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e125 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e126 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e127 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/WebFluent" });
  const _e128 = WF.h("p", { className: "wf-text wf-text--bold" }, "WebFluent");
  _e128.style.fontSize = "1.2rem";
  _e128.style.color = "#E8E6E1";
  _e127.appendChild(_e128);
  _e126.appendChild(_e127);
  const _e129 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Flagship");
  _e129.style.fontFamily = "JetBrains Mono, monospace";
  _e129.style.background = "#C69C6D";
  _e129.style.color = "#1A1A19";
  _e129.style.padding = "0.25rem 0.75rem";
  _e129.style.borderRadius = "0.375rem";
  _e129.style.fontSize = "0.75rem";
  _e129.style.fontWeight = "600";
  _e126.appendChild(_e129);
  _e125.appendChild(_e126);
  const _e130 = WF.h("p", { className: "wf-text wf-text--muted" }, "A web-first programming language that compiles to HTML, CSS, JavaScript, and PDF.");
  _e130.style.color = "#8C8B88";
  _e130.style.fontSize = "0.95rem";
  _e125.appendChild(_e130);
  const _e131 = WF.h("div", { className: "wf-spacer" });
  _e125.appendChild(_e131);
  const _e132 = WF.h("p", { className: "wf-text" }, "WebFluent replaces the traditional web stack with a single, expressive language. It features reactive state, declarative UI components, built-in routing, i18n, SSG, and PDF output — all from .wf source files. This portfolio is built entirely with WebFluent.");
  _e132.style.color = "#E8E6E1";
  _e132.style.lineHeight = "1.7";
  _e132.style.fontSize = "0.95rem";
  _e125.appendChild(_e132);
  const _e133 = WF.h("div", { className: "wf-spacer" });
  _e125.appendChild(_e133);
  const _e134 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e135 = WF.h("p", { className: "wf-text wf-text--bold" }, "Key features:");
  _e135.style.color = "#C69C6D";
  _e135.style.fontSize = "0.9rem";
  _e135.style.fontWeight = "600";
  _e134.appendChild(_e135);
  const _e136 = WF.h("p", { className: "wf-text" }, "Reactive state & computed values with automatic UI updates");
  _e136.style.fontFamily = "JetBrains Mono, monospace";
  _e136.style.color = "#E8E6E1";
  _e136.style.fontSize = "0.85rem";
  _e134.appendChild(_e136);
  const _e137 = WF.h("p", { className: "wf-text" }, "Full component library — layout, forms, navigation, data display");
  _e137.style.fontFamily = "JetBrains Mono, monospace";
  _e137.style.color = "#E8E6E1";
  _e137.style.fontSize = "0.85rem";
  _e134.appendChild(_e137);
  const _e138 = WF.h("p", { className: "wf-text" }, "Static site generation with JS hydration");
  _e138.style.fontFamily = "JetBrains Mono, monospace";
  _e138.style.color = "#E8E6E1";
  _e138.style.fontSize = "0.85rem";
  _e134.appendChild(_e138);
  const _e139 = WF.h("p", { className: "wf-text" }, "PDF compilation with page layout, headers, footers");
  _e139.style.fontFamily = "JetBrains Mono, monospace";
  _e139.style.color = "#E8E6E1";
  _e139.style.fontSize = "0.85rem";
  _e134.appendChild(_e139);
  const _e140 = WF.h("p", { className: "wf-text" }, "Built-in i18n with automatic RTL support");
  _e140.style.fontFamily = "JetBrains Mono, monospace";
  _e140.style.color = "#E8E6E1";
  _e140.style.fontSize = "0.85rem";
  _e134.appendChild(_e140);
  _e125.appendChild(_e134);
  const _e141 = WF.h("div", { className: "wf-spacer" });
  _e125.appendChild(_e141);
  const _e142 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e143 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e143.style.fontFamily = "JetBrains Mono, monospace";
  _e143.style.background = "#C69C6D";
  _e143.style.color = "#1A1A19";
  _e143.style.padding = "0.25rem 0.75rem";
  _e143.style.borderRadius = "0.375rem";
  _e143.style.fontSize = "0.75rem";
  _e143.style.fontWeight = "600";
  _e142.appendChild(_e143);
  const _e144 = WF.h("span", { className: "wf-badge" }, "Compiler Design");
  _e144.style.fontFamily = "JetBrains Mono, monospace";
  _e144.style.background = "#2D2C2A";
  _e144.style.color = "#E8E6E1";
  _e144.style.padding = "0.25rem 0.75rem";
  _e144.style.borderRadius = "0.375rem";
  _e144.style.fontSize = "0.75rem";
  _e142.appendChild(_e144);
  const _e145 = WF.h("span", { className: "wf-badge" }, "Language Design");
  _e145.style.fontFamily = "JetBrains Mono, monospace";
  _e145.style.background = "#2D2C2A";
  _e145.style.color = "#E8E6E1";
  _e145.style.padding = "0.25rem 0.75rem";
  _e145.style.borderRadius = "0.375rem";
  _e145.style.fontSize = "0.75rem";
  _e142.appendChild(_e145);
  const _e146 = WF.h("span", { className: "wf-badge" }, "PDF Generation");
  _e146.style.fontFamily = "JetBrains Mono, monospace";
  _e146.style.background = "#2D2C2A";
  _e146.style.color = "#E8E6E1";
  _e146.style.padding = "0.25rem 0.75rem";
  _e146.style.borderRadius = "0.375rem";
  _e146.style.fontSize = "0.75rem";
  _e142.appendChild(_e146);
  _e125.appendChild(_e142);
  _e124.appendChild(_e125);
  _e124.style.background = "#242422";
  _e124.style.border = "1px solid #C69C6D";
  _e124.style.borderRadius = "0.75rem";
  _e124.style.padding = "2rem";
  _e124.style.marginBottom = "2rem";
  _e120.appendChild(_e124);
  const _e147 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e148 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e149 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e150 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.circles.clinic/ar/" });
  const _e151 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e151.style.fontSize = "1.2rem";
  _e151.style.color = "#E8E6E1";
  _e150.appendChild(_e151);
  _e149.appendChild(_e150);
  const _e152 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Team Lead");
  _e152.style.fontFamily = "JetBrains Mono, monospace";
  _e152.style.background = "#C69C6D";
  _e152.style.color = "#1A1A19";
  _e152.style.padding = "0.25rem 0.75rem";
  _e152.style.borderRadius = "0.375rem";
  _e152.style.fontSize = "0.75rem";
  _e152.style.fontWeight = "600";
  _e149.appendChild(_e152);
  _e148.appendChild(_e149);
  const _e153 = WF.h("p", { className: "wf-text wf-text--muted" }, "A comprehensive business operating system for small and medium clinics.");
  _e153.style.color = "#8C8B88";
  _e153.style.fontSize = "0.95rem";
  _e148.appendChild(_e153);
  const _e154 = WF.h("div", { className: "wf-spacer" });
  _e148.appendChild(_e154);
  const _e155 = WF.h("p", { className: "wf-text" }, "Circles manages every aspect of clinic operations — from financials and patient scheduling to HIPAA-compliant EMR, telehealth, AI-powered diagnostics, multi-branch support, and branded patient apps. Available across MENA and Africa through local partners.");
  _e155.style.color = "#E8E6E1";
  _e155.style.lineHeight = "1.7";
  _e155.style.fontSize = "0.95rem";
  _e148.appendChild(_e155);
  const _e156 = WF.h("div", { className: "wf-spacer" });
  _e148.appendChild(_e156);
  const _e157 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e158 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e158.style.fontFamily = "JetBrains Mono, monospace";
  _e158.style.background = "#2D2C2A";
  _e158.style.color = "#E8E6E1";
  _e158.style.padding = "0.25rem 0.75rem";
  _e158.style.borderRadius = "0.375rem";
  _e158.style.fontSize = "0.75rem";
  _e157.appendChild(_e158);
  const _e159 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e159.style.fontFamily = "JetBrains Mono, monospace";
  _e159.style.background = "#2D2C2A";
  _e159.style.color = "#E8E6E1";
  _e159.style.padding = "0.25rem 0.75rem";
  _e159.style.borderRadius = "0.375rem";
  _e159.style.fontSize = "0.75rem";
  _e157.appendChild(_e159);
  const _e160 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e160.style.fontFamily = "JetBrains Mono, monospace";
  _e160.style.background = "#2D2C2A";
  _e160.style.color = "#E8E6E1";
  _e160.style.padding = "0.25rem 0.75rem";
  _e160.style.borderRadius = "0.375rem";
  _e160.style.fontSize = "0.75rem";
  _e157.appendChild(_e160);
  const _e161 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e161.style.fontFamily = "JetBrains Mono, monospace";
  _e161.style.background = "#2D2C2A";
  _e161.style.color = "#E8E6E1";
  _e161.style.padding = "0.25rem 0.75rem";
  _e161.style.borderRadius = "0.375rem";
  _e161.style.fontSize = "0.75rem";
  _e157.appendChild(_e161);
  _e148.appendChild(_e157);
  _e147.appendChild(_e148);
  _e147.style.background = "#242422";
  _e147.style.border = "1px solid #2D2C2A";
  _e147.style.borderRadius = "0.75rem";
  _e147.style.padding = "2rem";
  _e147.style.marginBottom = "2rem";
  _e120.appendChild(_e147);
  const _e162 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e163 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e164 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e165 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://platform.alhakeem.app/" });
  const _e166 = WF.h("p", { className: "wf-text wf-text--bold" }, "Al-Hakeem");
  _e166.style.fontSize = "1.2rem";
  _e166.style.color = "#E8E6E1";
  _e165.appendChild(_e166);
  _e164.appendChild(_e165);
  const _e167 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Engineering Lead");
  _e167.style.fontFamily = "JetBrains Mono, monospace";
  _e167.style.background = "#C69C6D";
  _e167.style.color = "#1A1A19";
  _e167.style.padding = "0.25rem 0.75rem";
  _e167.style.borderRadius = "0.375rem";
  _e167.style.fontSize = "0.75rem";
  _e167.style.fontWeight = "600";
  _e164.appendChild(_e167);
  _e163.appendChild(_e164);
  const _e168 = WF.h("p", { className: "wf-text wf-text--muted" }, "A healthcare platform connecting physicians with medical services.");
  _e168.style.color = "#8C8B88";
  _e168.style.fontSize = "0.95rem";
  _e163.appendChild(_e168);
  const _e169 = WF.h("div", { className: "wf-spacer" });
  _e163.appendChild(_e169);
  const _e170 = WF.h("p", { className: "wf-text" }, "Al-Hakeem streamlines physician onboarding and medical service delivery. The platform supports bilingual operation in Arabic and English, serving healthcare professionals across the region with credential management and service coordination.");
  _e170.style.color = "#E8E6E1";
  _e170.style.lineHeight = "1.7";
  _e170.style.fontSize = "0.95rem";
  _e163.appendChild(_e170);
  const _e171 = WF.h("div", { className: "wf-spacer" });
  _e163.appendChild(_e171);
  const _e172 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e173 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e173.style.fontFamily = "JetBrains Mono, monospace";
  _e173.style.background = "#2D2C2A";
  _e173.style.color = "#E8E6E1";
  _e173.style.padding = "0.25rem 0.75rem";
  _e173.style.borderRadius = "0.375rem";
  _e173.style.fontSize = "0.75rem";
  _e172.appendChild(_e173);
  const _e174 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e174.style.fontFamily = "JetBrains Mono, monospace";
  _e174.style.background = "#2D2C2A";
  _e174.style.color = "#E8E6E1";
  _e174.style.padding = "0.25rem 0.75rem";
  _e174.style.borderRadius = "0.375rem";
  _e174.style.fontSize = "0.75rem";
  _e172.appendChild(_e174);
  const _e175 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e175.style.fontFamily = "JetBrains Mono, monospace";
  _e175.style.background = "#2D2C2A";
  _e175.style.color = "#E8E6E1";
  _e175.style.padding = "0.25rem 0.75rem";
  _e175.style.borderRadius = "0.375rem";
  _e175.style.fontSize = "0.75rem";
  _e172.appendChild(_e175);
  _e163.appendChild(_e172);
  _e162.appendChild(_e163);
  _e162.style.background = "#242422";
  _e162.style.border = "1px solid #2D2C2A";
  _e162.style.borderRadius = "0.75rem";
  _e162.style.padding = "2rem";
  _e162.style.marginBottom = "2rem";
  _e120.appendChild(_e162);
  const _e176 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e177 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e178 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e179 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://dabdoob.com/" });
  const _e180 = WF.h("p", { className: "wf-text wf-text--bold" }, "Dabdoob");
  _e180.style.fontSize = "1.2rem";
  _e180.style.color = "#E8E6E1";
  _e179.appendChild(_e180);
  _e178.appendChild(_e179);
  const _e181 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Featured");
  _e181.style.fontFamily = "JetBrains Mono, monospace";
  _e181.style.background = "#C69C6D";
  _e181.style.color = "#1A1A19";
  _e181.style.padding = "0.25rem 0.75rem";
  _e181.style.borderRadius = "0.375rem";
  _e181.style.fontSize = "0.75rem";
  _e181.style.fontWeight = "600";
  _e178.appendChild(_e181);
  _e177.appendChild(_e178);
  const _e182 = WF.h("p", { className: "wf-text wf-text--muted" }, "A mobile-first e-commerce platform serving the Middle East.");
  _e182.style.color = "#8C8B88";
  _e182.style.fontSize = "0.95rem";
  _e177.appendChild(_e182);
  const _e183 = WF.h("div", { className: "wf-spacer" });
  _e177.appendChild(_e183);
  const _e184 = WF.h("p", { className: "wf-text" }, "Dabdoob is a cross-platform shopping application available on iOS and Android, operating across Kuwait, Saudi Arabia, UAE, Qatar, and Bahrain. The platform delivers exclusive deals and a seamless mobile shopping experience across the GCC region.");
  _e184.style.color = "#E8E6E1";
  _e184.style.lineHeight = "1.7";
  _e184.style.fontSize = "0.95rem";
  _e177.appendChild(_e184);
  const _e185 = WF.h("div", { className: "wf-spacer" });
  _e177.appendChild(_e185);
  const _e186 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e187 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e187.style.fontFamily = "JetBrains Mono, monospace";
  _e187.style.background = "#2D2C2A";
  _e187.style.color = "#E8E6E1";
  _e187.style.padding = "0.25rem 0.75rem";
  _e187.style.borderRadius = "0.375rem";
  _e187.style.fontSize = "0.75rem";
  _e186.appendChild(_e187);
  const _e188 = WF.h("span", { className: "wf-badge" }, "E-Commerce");
  _e188.style.fontFamily = "JetBrains Mono, monospace";
  _e188.style.background = "#2D2C2A";
  _e188.style.color = "#E8E6E1";
  _e188.style.padding = "0.25rem 0.75rem";
  _e188.style.borderRadius = "0.375rem";
  _e188.style.fontSize = "0.75rem";
  _e186.appendChild(_e188);
  const _e189 = WF.h("span", { className: "wf-badge" }, "Mobile");
  _e189.style.fontFamily = "JetBrains Mono, monospace";
  _e189.style.background = "#2D2C2A";
  _e189.style.color = "#E8E6E1";
  _e189.style.padding = "0.25rem 0.75rem";
  _e189.style.borderRadius = "0.375rem";
  _e189.style.fontSize = "0.75rem";
  _e186.appendChild(_e189);
  _e177.appendChild(_e186);
  _e176.appendChild(_e177);
  _e176.style.background = "#242422";
  _e176.style.border = "1px solid #2D2C2A";
  _e176.style.borderRadius = "0.75rem";
  _e176.style.padding = "2rem";
  _e176.style.marginBottom = "2rem";
  _e120.appendChild(_e176);
  const _e190 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e191 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e192 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e193 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/sys-voice-daemon" });
  const _e194 = WF.h("p", { className: "wf-text wf-text--bold" }, "sys-voice-daemon");
  _e194.style.fontSize = "1.2rem";
  _e194.style.color = "#E8E6E1";
  _e193.appendChild(_e194);
  _e192.appendChild(_e193);
  const _e195 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e195.style.fontFamily = "JetBrains Mono, monospace";
  _e195.style.background = "#2D2C2A";
  _e195.style.color = "#E8E6E1";
  _e195.style.padding = "0.25rem 0.75rem";
  _e195.style.borderRadius = "0.375rem";
  _e195.style.fontSize = "0.75rem";
  _e192.appendChild(_e195);
  _e191.appendChild(_e192);
  const _e196 = WF.h("p", { className: "wf-text wf-text--muted" }, "Privacy-first, offline voice-to-text daemon for Linux.");
  _e196.style.color = "#8C8B88";
  _e196.style.fontSize = "0.95rem";
  _e191.appendChild(_e196);
  const _e197 = WF.h("div", { className: "wf-spacer" });
  _e191.appendChild(_e197);
  const _e198 = WF.h("p", { className: "wf-text" }, "A system-level daemon that automatically detects active text fields and injects transcriptions into any window. Uses a kernel-level virtual keyboard via uinput for seamless, privacy-respecting voice input — entirely offline with no cloud dependency.");
  _e198.style.color = "#E8E6E1";
  _e198.style.lineHeight = "1.7";
  _e198.style.fontSize = "0.95rem";
  _e191.appendChild(_e198);
  const _e199 = WF.h("div", { className: "wf-spacer" });
  _e191.appendChild(_e199);
  const _e200 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e201 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e201.style.fontFamily = "JetBrains Mono, monospace";
  _e201.style.background = "#C69C6D";
  _e201.style.color = "#1A1A19";
  _e201.style.padding = "0.25rem 0.75rem";
  _e201.style.borderRadius = "0.375rem";
  _e201.style.fontSize = "0.75rem";
  _e201.style.fontWeight = "600";
  _e200.appendChild(_e201);
  const _e202 = WF.h("span", { className: "wf-badge" }, "Linux");
  _e202.style.fontFamily = "JetBrains Mono, monospace";
  _e202.style.background = "#2D2C2A";
  _e202.style.color = "#E8E6E1";
  _e202.style.padding = "0.25rem 0.75rem";
  _e202.style.borderRadius = "0.375rem";
  _e202.style.fontSize = "0.75rem";
  _e200.appendChild(_e202);
  const _e203 = WF.h("span", { className: "wf-badge" }, "uinput");
  _e203.style.fontFamily = "JetBrains Mono, monospace";
  _e203.style.background = "#2D2C2A";
  _e203.style.color = "#E8E6E1";
  _e203.style.padding = "0.25rem 0.75rem";
  _e203.style.borderRadius = "0.375rem";
  _e203.style.fontSize = "0.75rem";
  _e200.appendChild(_e203);
  const _e204 = WF.h("span", { className: "wf-badge" }, "Systems");
  _e204.style.fontFamily = "JetBrains Mono, monospace";
  _e204.style.background = "#2D2C2A";
  _e204.style.color = "#E8E6E1";
  _e204.style.padding = "0.25rem 0.75rem";
  _e204.style.borderRadius = "0.375rem";
  _e204.style.fontSize = "0.75rem";
  _e200.appendChild(_e204);
  _e191.appendChild(_e200);
  _e190.appendChild(_e191);
  _e190.style.background = "#242422";
  _e190.style.border = "1px solid #2D2C2A";
  _e190.style.borderRadius = "0.75rem";
  _e190.style.padding = "2rem";
  _e190.style.marginBottom = "2rem";
  _e120.appendChild(_e190);
  const _e205 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e206 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e207 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e208 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/rubik-cube-trainer" });
  const _e209 = WF.h("p", { className: "wf-text wf-text--bold" }, "rubiks-trainer");
  _e209.style.fontSize = "1.2rem";
  _e209.style.color = "#E8E6E1";
  _e208.appendChild(_e209);
  _e207.appendChild(_e208);
  const _e210 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e210.style.fontFamily = "JetBrains Mono, monospace";
  _e210.style.background = "#2D2C2A";
  _e210.style.color = "#E8E6E1";
  _e210.style.padding = "0.25rem 0.75rem";
  _e210.style.borderRadius = "0.375rem";
  _e210.style.fontSize = "0.75rem";
  _e207.appendChild(_e210);
  _e206.appendChild(_e207);
  const _e211 = WF.h("p", { className: "wf-text wf-text--muted" }, "A virtual 3D Rubik's cube game and speedcubing trainer built in Rust.");
  _e211.style.color = "#8C8B88";
  _e211.style.fontSize = "0.95rem";
  _e206.appendChild(_e211);
  const _e212 = WF.h("div", { className: "wf-spacer" });
  _e206.appendChild(_e212);
  const _e213 = WF.h("p", { className: "wf-text" }, "Supports 2×2, 3×3, 4×4, and 5×5 cubes with custom-built solvers written from scratch — no external solver crates. Features a progressive learning track from beginner LBL through advanced CFOP, plus a daily-use timer and drill mode designed for speedcubers.");
  _e213.style.color = "#E8E6E1";
  _e213.style.lineHeight = "1.7";
  _e213.style.fontSize = "0.95rem";
  _e206.appendChild(_e213);
  const _e214 = WF.h("div", { className: "wf-spacer" });
  _e206.appendChild(_e214);
  const _e215 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e216 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e216.style.fontFamily = "JetBrains Mono, monospace";
  _e216.style.background = "#C69C6D";
  _e216.style.color = "#1A1A19";
  _e216.style.padding = "0.25rem 0.75rem";
  _e216.style.borderRadius = "0.375rem";
  _e216.style.fontSize = "0.75rem";
  _e216.style.fontWeight = "600";
  _e215.appendChild(_e216);
  const _e217 = WF.h("span", { className: "wf-badge" }, "Bevy");
  _e217.style.fontFamily = "JetBrains Mono, monospace";
  _e217.style.background = "#2D2C2A";
  _e217.style.color = "#E8E6E1";
  _e217.style.padding = "0.25rem 0.75rem";
  _e217.style.borderRadius = "0.375rem";
  _e217.style.fontSize = "0.75rem";
  _e215.appendChild(_e217);
  const _e218 = WF.h("span", { className: "wf-badge" }, "3D Graphics");
  _e218.style.fontFamily = "JetBrains Mono, monospace";
  _e218.style.background = "#2D2C2A";
  _e218.style.color = "#E8E6E1";
  _e218.style.padding = "0.25rem 0.75rem";
  _e218.style.borderRadius = "0.375rem";
  _e218.style.fontSize = "0.75rem";
  _e215.appendChild(_e218);
  const _e219 = WF.h("span", { className: "wf-badge" }, "Algorithms");
  _e219.style.fontFamily = "JetBrains Mono, monospace";
  _e219.style.background = "#2D2C2A";
  _e219.style.color = "#E8E6E1";
  _e219.style.padding = "0.25rem 0.75rem";
  _e219.style.borderRadius = "0.375rem";
  _e219.style.fontSize = "0.75rem";
  _e215.appendChild(_e219);
  _e206.appendChild(_e215);
  _e205.appendChild(_e206);
  _e205.style.background = "#242422";
  _e205.style.border = "1px solid #C69C6D";
  _e205.style.borderRadius = "0.75rem";
  _e205.style.padding = "2rem";
  _e205.style.marginBottom = "2rem";
  _e120.appendChild(_e205);
  const _e220 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e221 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e222 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e223 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/oxide-explorer" });
  const _e224 = WF.h("p", { className: "wf-text wf-text--bold" }, "Oxide Explorer");
  _e224.style.fontSize = "1.2rem";
  _e224.style.color = "#E8E6E1";
  _e223.appendChild(_e224);
  _e222.appendChild(_e223);
  const _e225 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e225.style.fontFamily = "JetBrains Mono, monospace";
  _e225.style.background = "#2D2C2A";
  _e225.style.color = "#E8E6E1";
  _e225.style.padding = "0.25rem 0.75rem";
  _e225.style.borderRadius = "0.375rem";
  _e225.style.fontSize = "0.75rem";
  _e222.appendChild(_e225);
  _e221.appendChild(_e222);
  const _e226 = WF.h("p", { className: "wf-text wf-text--muted" }, "A blazing-fast, power-user-centric file manager built with Rust, GTK4, and libadwaita.");
  _e226.style.color = "#8C8B88";
  _e226.style.fontSize = "0.95rem";
  _e221.appendChild(_e226);
  const _e227 = WF.h("div", { className: "wf-spacer" });
  _e221.appendChild(_e227);
  const _e228 = WF.h("p", { className: "wf-text" }, "Combines the visual elegance of GNOME Files with the advanced productivity features of Directory Opus and Total Commander. Designed for developers and power users who need dual-pane browsing, batch operations, and keyboard-driven workflows in a native Linux environment.");
  _e228.style.color = "#E8E6E1";
  _e228.style.lineHeight = "1.7";
  _e228.style.fontSize = "0.95rem";
  _e221.appendChild(_e228);
  const _e229 = WF.h("div", { className: "wf-spacer" });
  _e221.appendChild(_e229);
  const _e230 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e231 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e231.style.fontFamily = "JetBrains Mono, monospace";
  _e231.style.background = "#C69C6D";
  _e231.style.color = "#1A1A19";
  _e231.style.padding = "0.25rem 0.75rem";
  _e231.style.borderRadius = "0.375rem";
  _e231.style.fontSize = "0.75rem";
  _e231.style.fontWeight = "600";
  _e230.appendChild(_e231);
  const _e232 = WF.h("span", { className: "wf-badge" }, "GTK4");
  _e232.style.fontFamily = "JetBrains Mono, monospace";
  _e232.style.background = "#2D2C2A";
  _e232.style.color = "#E8E6E1";
  _e232.style.padding = "0.25rem 0.75rem";
  _e232.style.borderRadius = "0.375rem";
  _e232.style.fontSize = "0.75rem";
  _e230.appendChild(_e232);
  const _e233 = WF.h("span", { className: "wf-badge" }, "libadwaita");
  _e233.style.fontFamily = "JetBrains Mono, monospace";
  _e233.style.background = "#2D2C2A";
  _e233.style.color = "#E8E6E1";
  _e233.style.padding = "0.25rem 0.75rem";
  _e233.style.borderRadius = "0.375rem";
  _e233.style.fontSize = "0.75rem";
  _e230.appendChild(_e233);
  const _e234 = WF.h("span", { className: "wf-badge" }, "Linux Desktop");
  _e234.style.fontFamily = "JetBrains Mono, monospace";
  _e234.style.background = "#2D2C2A";
  _e234.style.color = "#E8E6E1";
  _e234.style.padding = "0.25rem 0.75rem";
  _e234.style.borderRadius = "0.375rem";
  _e234.style.fontSize = "0.75rem";
  _e230.appendChild(_e234);
  _e221.appendChild(_e230);
  _e220.appendChild(_e221);
  _e220.style.background = "#242422";
  _e220.style.border = "1px solid #C69C6D";
  _e220.style.borderRadius = "0.75rem";
  _e220.style.padding = "2rem";
  _e220.style.marginBottom = "2rem";
  _e120.appendChild(_e220);
  const _e235 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e236 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e237 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e238 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/rust-mobile/xbuild" });
  const _e239 = WF.h("p", { className: "wf-text wf-text--bold" }, "xbuild");
  _e239.style.fontSize = "1.2rem";
  _e239.style.color = "#E8E6E1";
  _e238.appendChild(_e239);
  _e237.appendChild(_e238);
  const _e240 = WF.h("span", { className: "wf-badge" }, "Contribution");
  _e240.style.fontFamily = "JetBrains Mono, monospace";
  _e240.style.background = "#2D2C2A";
  _e240.style.color = "#E8E6E1";
  _e240.style.padding = "0.25rem 0.75rem";
  _e240.style.borderRadius = "0.375rem";
  _e240.style.fontSize = "0.75rem";
  _e237.appendChild(_e240);
  _e236.appendChild(_e237);
  const _e241 = WF.h("p", { className: "wf-text wf-text--muted" }, "A build tool for Rust projects with cross-compilation and publishing to all major app stores.");
  _e241.style.color = "#8C8B88";
  _e241.style.fontSize = "0.95rem";
  _e236.appendChild(_e241);
  const _e242 = WF.h("div", { className: "wf-spacer" });
  _e236.appendChild(_e242);
  const _e243 = WF.h("p", { className: "wf-text" }, "Contributed ARM 32-bit target support to xbuild, expanding the tool's cross-compilation reach to legacy and embedded ARM devices. xbuild aims to make native app development as easy as web development — build once, publish everywhere.");
  _e243.style.color = "#E8E6E1";
  _e243.style.lineHeight = "1.7";
  _e243.style.fontSize = "0.95rem";
  _e236.appendChild(_e243);
  const _e244 = WF.h("div", { className: "wf-spacer" });
  _e236.appendChild(_e244);
  const _e245 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e246 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e246.style.fontFamily = "JetBrains Mono, monospace";
  _e246.style.background = "#C69C6D";
  _e246.style.color = "#1A1A19";
  _e246.style.padding = "0.25rem 0.75rem";
  _e246.style.borderRadius = "0.375rem";
  _e246.style.fontSize = "0.75rem";
  _e246.style.fontWeight = "600";
  _e245.appendChild(_e246);
  const _e247 = WF.h("span", { className: "wf-badge" }, "Cross-Compilation");
  _e247.style.fontFamily = "JetBrains Mono, monospace";
  _e247.style.background = "#2D2C2A";
  _e247.style.color = "#E8E6E1";
  _e247.style.padding = "0.25rem 0.75rem";
  _e247.style.borderRadius = "0.375rem";
  _e247.style.fontSize = "0.75rem";
  _e245.appendChild(_e247);
  const _e248 = WF.h("span", { className: "wf-badge" }, "ARM");
  _e248.style.fontFamily = "JetBrains Mono, monospace";
  _e248.style.background = "#2D2C2A";
  _e248.style.color = "#E8E6E1";
  _e248.style.padding = "0.25rem 0.75rem";
  _e248.style.borderRadius = "0.375rem";
  _e248.style.fontSize = "0.75rem";
  _e245.appendChild(_e248);
  const _e249 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e249.style.fontFamily = "JetBrains Mono, monospace";
  _e249.style.background = "#2D2C2A";
  _e249.style.color = "#E8E6E1";
  _e249.style.padding = "0.25rem 0.75rem";
  _e249.style.borderRadius = "0.375rem";
  _e249.style.fontSize = "0.75rem";
  _e245.appendChild(_e249);
  _e236.appendChild(_e245);
  _e235.appendChild(_e236);
  _e235.style.background = "#242422";
  _e235.style.border = "1px solid #2D2C2A";
  _e235.style.borderRadius = "0.75rem";
  _e235.style.padding = "2rem";
  _e235.style.marginBottom = "2rem";
  _e120.appendChild(_e235);
  const _e250 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e251 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e252 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e253 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/micro-kernel-backend" });
  const _e254 = WF.h("p", { className: "wf-text wf-text--bold" }, "Micro-kernel Architecture");
  _e254.style.fontSize = "1.2rem";
  _e254.style.color = "#E8E6E1";
  _e253.appendChild(_e254);
  _e252.appendChild(_e253);
  const _e255 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Tech Talk");
  _e255.style.fontFamily = "JetBrains Mono, monospace";
  _e255.style.background = "#C69C6D";
  _e255.style.color = "#1A1A19";
  _e255.style.padding = "0.25rem 0.75rem";
  _e255.style.borderRadius = "0.375rem";
  _e255.style.fontSize = "0.75rem";
  _e255.style.fontWeight = "600";
  _e252.appendChild(_e255);
  _e251.appendChild(_e252);
  const _e256 = WF.h("p", { className: "wf-text wf-text--muted" }, "A micro-kernel web backend where business logic lives in dynamically-loaded WebAssembly modules.");
  _e256.style.color = "#8C8B88";
  _e256.style.fontSize = "0.95rem";
  _e251.appendChild(_e256);
  const _e257 = WF.h("div", { className: "wf-spacer" });
  _e251.appendChild(_e257);
  const _e258 = WF.h("p", { className: "wf-text" }, "The server core is intentionally minimal — routing, auth, and module lifecycle. All business logic runs in sandboxed WebAssembly modules that can be deployed, hot-swapped, rolled back, call external services, and call each other via an internal IPC layer. A demo of how micro-kernel principles apply to backend architecture.");
  _e258.style.color = "#E8E6E1";
  _e258.style.lineHeight = "1.7";
  _e258.style.fontSize = "0.95rem";
  _e251.appendChild(_e258);
  const _e259 = WF.h("div", { className: "wf-spacer" });
  _e251.appendChild(_e259);
  const _e260 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e261 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e261.style.fontFamily = "JetBrains Mono, monospace";
  _e261.style.background = "#C69C6D";
  _e261.style.color = "#1A1A19";
  _e261.style.padding = "0.25rem 0.75rem";
  _e261.style.borderRadius = "0.375rem";
  _e261.style.fontSize = "0.75rem";
  _e261.style.fontWeight = "600";
  _e260.appendChild(_e261);
  const _e262 = WF.h("span", { className: "wf-badge" }, "WebAssembly");
  _e262.style.fontFamily = "JetBrains Mono, monospace";
  _e262.style.background = "#2D2C2A";
  _e262.style.color = "#E8E6E1";
  _e262.style.padding = "0.25rem 0.75rem";
  _e262.style.borderRadius = "0.375rem";
  _e262.style.fontSize = "0.75rem";
  _e260.appendChild(_e262);
  const _e263 = WF.h("span", { className: "wf-badge" }, "Systems Design");
  _e263.style.fontFamily = "JetBrains Mono, monospace";
  _e263.style.background = "#2D2C2A";
  _e263.style.color = "#E8E6E1";
  _e263.style.padding = "0.25rem 0.75rem";
  _e263.style.borderRadius = "0.375rem";
  _e263.style.fontSize = "0.75rem";
  _e260.appendChild(_e263);
  const _e264 = WF.h("span", { className: "wf-badge" }, "Architecture");
  _e264.style.fontFamily = "JetBrains Mono, monospace";
  _e264.style.background = "#2D2C2A";
  _e264.style.color = "#E8E6E1";
  _e264.style.padding = "0.25rem 0.75rem";
  _e264.style.borderRadius = "0.375rem";
  _e264.style.fontSize = "0.75rem";
  _e260.appendChild(_e264);
  _e251.appendChild(_e260);
  _e250.appendChild(_e251);
  _e250.style.background = "#242422";
  _e250.style.border = "1px solid #C69C6D";
  _e250.style.borderRadius = "0.75rem";
  _e250.style.padding = "2rem";
  _e250.style.marginBottom = "2rem";
  _e120.appendChild(_e250);
  _e119.appendChild(_e120);
  _e119.style.maxWidth = "800px";
  _e119.style.margin = "0 auto";
  _e119.style.padding = "80px 2rem";
  _e119.classList.add("wf-s265");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s265 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s265 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e119);
  return _root;
}

function Page_Experience(params) {
  const _root = document.createDocumentFragment();
  const _e266 = WF.h("div", { className: "wf-container" });
  const _e267 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e268 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Experience");
  _e268.style.fontSize = "2rem";
  _e268.style.fontWeight = "700";
  _e268.style.color = "#E8E6E1";
  _e268.style.letterSpacing = "-0.02em";
  _e268.style.marginBottom = "1rem";
  _e267.appendChild(_e268);
  const _e269 = WF.h("p", { className: "wf-text wf-text--muted" }, "A reverse-chronological record of impact and engineering decisions.");
  _e269.style.color = "#8C8B88";
  _e269.style.fontSize = "1rem";
  _e269.style.marginBottom = "3rem";
  _e267.appendChild(_e269);
  const _e270 = WF.h("div", { className: "wf-spacer" });
  _e267.appendChild(_e270);
  const _e271 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e272 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e273 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e274 = WF.h("p", { className: "wf-text wf-text--bold" }, "SilverKey Technologies");
  _e274.style.fontSize = "1.2rem";
  _e274.style.color = "#E8E6E1";
  _e273.appendChild(_e274);
  const _e275 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Mar 2025 — Present");
  _e275.style.color = "#C69C6D";
  _e275.style.fontFamily = "JetBrains Mono, monospace";
  _e275.style.fontSize = "0.8rem";
  _e273.appendChild(_e275);
  _e272.appendChild(_e273);
  const _e276 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Node.js Developer");
  _e276.style.color = "#8C8B88";
  _e276.style.fontSize = "0.95rem";
  _e272.appendChild(_e276);
  const _e277 = WF.h("div", { className: "wf-spacer" });
  _e272.appendChild(_e277);
  const _e278 = WF.h("p", { className: "wf-text" }, "Built a high-performance image processing microservice using Rust, achieving an average performance increase of over 98%. Led the migration of the existing codebase to TypeScript for improved maintainability and type safety. Optimized database queries and implemented caching strategies for critical data paths.");
  _e278.style.color = "#E8E6E1";
  _e278.style.lineHeight = "1.7";
  _e278.style.fontSize = "0.95rem";
  _e272.appendChild(_e278);
  const _e279 = WF.h("div", { className: "wf-spacer" });
  _e272.appendChild(_e279);
  const _e280 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e281 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e281.style.fontFamily = "JetBrains Mono, monospace";
  _e281.style.background = "#C69C6D";
  _e281.style.color = "#1A1A19";
  _e281.style.padding = "0.25rem 0.75rem";
  _e281.style.borderRadius = "0.375rem";
  _e281.style.fontSize = "0.75rem";
  _e281.style.fontWeight = "600";
  _e280.appendChild(_e281);
  const _e282 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e282.style.fontFamily = "JetBrains Mono, monospace";
  _e282.style.background = "#2D2C2A";
  _e282.style.color = "#E8E6E1";
  _e282.style.padding = "0.25rem 0.75rem";
  _e282.style.borderRadius = "0.375rem";
  _e282.style.fontSize = "0.75rem";
  _e280.appendChild(_e282);
  const _e283 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e283.style.fontFamily = "JetBrains Mono, monospace";
  _e283.style.background = "#2D2C2A";
  _e283.style.color = "#E8E6E1";
  _e283.style.padding = "0.25rem 0.75rem";
  _e283.style.borderRadius = "0.375rem";
  _e283.style.fontSize = "0.75rem";
  _e280.appendChild(_e283);
  _e272.appendChild(_e280);
  _e271.appendChild(_e272);
  _e271.style.background = "#242422";
  _e271.style.border = "1px solid #2D2C2A";
  _e271.style.borderRadius = "0.75rem";
  _e271.style.padding = "2rem";
  _e271.style.marginBottom = "2rem";
  _e267.appendChild(_e271);
  const _e284 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e285 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e286 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e287 = WF.h("p", { className: "wf-text wf-text--bold" }, "Ecom Payments");
  _e287.style.fontSize = "1.2rem";
  _e287.style.color = "#E8E6E1";
  _e286.appendChild(_e287);
  const _e288 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Aug 2024 — Feb 2025");
  _e288.style.color = "#C69C6D";
  _e288.style.fontFamily = "JetBrains Mono, monospace";
  _e288.style.fontSize = "0.8rem";
  _e286.appendChild(_e288);
  _e285.appendChild(_e286);
  const _e289 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Engineer");
  _e289.style.color = "#8C8B88";
  _e289.style.fontSize = "0.95rem";
  _e285.appendChild(_e289);
  const _e290 = WF.h("div", { className: "wf-spacer" });
  _e285.appendChild(_e290);
  const _e291 = WF.h("p", { className: "wf-text" }, "Designed and implemented NestJS microservices architecture for payment processing. Integrated AES encryption for securing sensitive transaction data. Built robust message queuing infrastructure with RabbitMQ and containerized deployments using Docker.");
  _e291.style.color = "#E8E6E1";
  _e291.style.lineHeight = "1.7";
  _e291.style.fontSize = "0.95rem";
  _e285.appendChild(_e291);
  const _e292 = WF.h("div", { className: "wf-spacer" });
  _e285.appendChild(_e292);
  const _e293 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e294 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e294.style.fontFamily = "JetBrains Mono, monospace";
  _e294.style.background = "#2D2C2A";
  _e294.style.color = "#E8E6E1";
  _e294.style.padding = "0.25rem 0.75rem";
  _e294.style.borderRadius = "0.375rem";
  _e294.style.fontSize = "0.75rem";
  _e293.appendChild(_e294);
  const _e295 = WF.h("span", { className: "wf-badge" }, "RabbitMQ");
  _e295.style.fontFamily = "JetBrains Mono, monospace";
  _e295.style.background = "#2D2C2A";
  _e295.style.color = "#E8E6E1";
  _e295.style.padding = "0.25rem 0.75rem";
  _e295.style.borderRadius = "0.375rem";
  _e295.style.fontSize = "0.75rem";
  _e293.appendChild(_e295);
  const _e296 = WF.h("span", { className: "wf-badge" }, "Docker");
  _e296.style.fontFamily = "JetBrains Mono, monospace";
  _e296.style.background = "#2D2C2A";
  _e296.style.color = "#E8E6E1";
  _e296.style.padding = "0.25rem 0.75rem";
  _e296.style.borderRadius = "0.375rem";
  _e296.style.fontSize = "0.75rem";
  _e293.appendChild(_e296);
  const _e297 = WF.h("span", { className: "wf-badge" }, "AES");
  _e297.style.fontFamily = "JetBrains Mono, monospace";
  _e297.style.background = "#2D2C2A";
  _e297.style.color = "#E8E6E1";
  _e297.style.padding = "0.25rem 0.75rem";
  _e297.style.borderRadius = "0.375rem";
  _e297.style.fontSize = "0.75rem";
  _e293.appendChild(_e297);
  _e285.appendChild(_e293);
  _e284.appendChild(_e285);
  _e284.style.background = "#242422";
  _e284.style.border = "1px solid #2D2C2A";
  _e284.style.borderRadius = "0.75rem";
  _e284.style.padding = "2rem";
  _e284.style.marginBottom = "2rem";
  _e267.appendChild(_e284);
  const _e298 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e299 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e300 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e301 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e301.style.fontSize = "1.2rem";
  _e301.style.color = "#E8E6E1";
  _e300.appendChild(_e301);
  const _e302 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Dec 2022 — Jan 2024");
  _e302.style.color = "#C69C6D";
  _e302.style.fontFamily = "JetBrains Mono, monospace";
  _e302.style.fontSize = "0.8rem";
  _e300.appendChild(_e302);
  _e299.appendChild(_e300);
  const _e303 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Engineer");
  _e303.style.color = "#8C8B88";
  _e303.style.fontSize = "0.95rem";
  _e299.appendChild(_e303);
  const _e304 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e304);
  const _e305 = WF.h("p", { className: "wf-text" }, "Architected microservices using GraphQL for flexible API composition and Apache Kafka for real-time data streaming across distributed services. Designed event-driven systems handling high-throughput data pipelines with fault tolerance and horizontal scalability.");
  _e305.style.color = "#E8E6E1";
  _e305.style.lineHeight = "1.7";
  _e305.style.fontSize = "0.95rem";
  _e299.appendChild(_e305);
  const _e306 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e306);
  const _e307 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e308 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e308.style.fontFamily = "JetBrains Mono, monospace";
  _e308.style.background = "#2D2C2A";
  _e308.style.color = "#E8E6E1";
  _e308.style.padding = "0.25rem 0.75rem";
  _e308.style.borderRadius = "0.375rem";
  _e308.style.fontSize = "0.75rem";
  _e307.appendChild(_e308);
  const _e309 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e309.style.fontFamily = "JetBrains Mono, monospace";
  _e309.style.background = "#2D2C2A";
  _e309.style.color = "#E8E6E1";
  _e309.style.padding = "0.25rem 0.75rem";
  _e309.style.borderRadius = "0.375rem";
  _e309.style.fontSize = "0.75rem";
  _e307.appendChild(_e309);
  const _e310 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e310.style.fontFamily = "JetBrains Mono, monospace";
  _e310.style.background = "#2D2C2A";
  _e310.style.color = "#E8E6E1";
  _e310.style.padding = "0.25rem 0.75rem";
  _e310.style.borderRadius = "0.375rem";
  _e310.style.fontSize = "0.75rem";
  _e307.appendChild(_e310);
  _e299.appendChild(_e307);
  _e298.appendChild(_e299);
  _e298.style.background = "#242422";
  _e298.style.border = "1px solid #2D2C2A";
  _e298.style.borderRadius = "0.75rem";
  _e298.style.padding = "2rem";
  _e298.style.marginBottom = "2rem";
  _e267.appendChild(_e298);
  const _e311 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e312 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e313 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e314 = WF.h("p", { className: "wf-text wf-text--bold" }, "EnayaTech");
  _e314.style.fontSize = "1.2rem";
  _e314.style.color = "#E8E6E1";
  _e313.appendChild(_e314);
  const _e315 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Feb 2020 — Jul 2020");
  _e315.style.color = "#C69C6D";
  _e315.style.fontFamily = "JetBrains Mono, monospace";
  _e315.style.fontSize = "0.8rem";
  _e313.appendChild(_e315);
  _e312.appendChild(_e313);
  const _e316 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e316.style.color = "#8C8B88";
  _e316.style.fontSize = "0.95rem";
  _e312.appendChild(_e316);
  const _e317 = WF.h("div", { className: "wf-spacer" });
  _e312.appendChild(_e317);
  const _e318 = WF.h("p", { className: "wf-text" }, "Developed RESTful APIs with Express.js, designed and maintained database schemas using both MySQL and MongoDB. Built backend services supporting mobile and web client applications with focus on API performance and data consistency.");
  _e318.style.color = "#E8E6E1";
  _e318.style.lineHeight = "1.7";
  _e318.style.fontSize = "0.95rem";
  _e312.appendChild(_e318);
  const _e319 = WF.h("div", { className: "wf-spacer" });
  _e312.appendChild(_e319);
  const _e320 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e321 = WF.h("span", { className: "wf-badge" }, "Express.js");
  _e321.style.fontFamily = "JetBrains Mono, monospace";
  _e321.style.background = "#2D2C2A";
  _e321.style.color = "#E8E6E1";
  _e321.style.padding = "0.25rem 0.75rem";
  _e321.style.borderRadius = "0.375rem";
  _e321.style.fontSize = "0.75rem";
  _e320.appendChild(_e321);
  const _e322 = WF.h("span", { className: "wf-badge" }, "MySQL");
  _e322.style.fontFamily = "JetBrains Mono, monospace";
  _e322.style.background = "#2D2C2A";
  _e322.style.color = "#E8E6E1";
  _e322.style.padding = "0.25rem 0.75rem";
  _e322.style.borderRadius = "0.375rem";
  _e322.style.fontSize = "0.75rem";
  _e320.appendChild(_e322);
  const _e323 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e323.style.fontFamily = "JetBrains Mono, monospace";
  _e323.style.background = "#2D2C2A";
  _e323.style.color = "#E8E6E1";
  _e323.style.padding = "0.25rem 0.75rem";
  _e323.style.borderRadius = "0.375rem";
  _e323.style.fontSize = "0.75rem";
  _e320.appendChild(_e323);
  _e312.appendChild(_e320);
  _e311.appendChild(_e312);
  _e311.style.background = "#242422";
  _e311.style.border = "1px solid #2D2C2A";
  _e311.style.borderRadius = "0.75rem";
  _e311.style.padding = "2rem";
  _e311.style.marginBottom = "2rem";
  _e267.appendChild(_e311);
  _e266.appendChild(_e267);
  _e266.style.maxWidth = "800px";
  _e266.style.margin = "0 auto";
  _e266.style.padding = "80px 2rem";
  _e266.classList.add("wf-s324");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s324 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s324 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e266);
  return _root;
}

function Page_Education(params) {
  const _root = document.createDocumentFragment();
  const _e325 = WF.h("div", { className: "wf-container" });
  const _e326 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e327 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Education");
  _e327.style.fontSize = "2rem";
  _e327.style.fontWeight = "700";
  _e327.style.color = "#E8E6E1";
  _e327.style.letterSpacing = "-0.02em";
  _e327.style.marginBottom = "3rem";
  _e326.appendChild(_e327);
  const _e328 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e329 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e330 = WF.h("p", { className: "wf-text wf-text--bold" }, "National Ribat University");
  _e330.style.fontSize = "1.2rem";
  _e330.style.color = "#E8E6E1";
  _e329.appendChild(_e330);
  const _e331 = WF.h("p", { className: "wf-text wf-text--muted" }, "Bachelor of Information Technology");
  _e331.style.color = "#8C8B88";
  _e331.style.fontSize = "0.95rem";
  _e329.appendChild(_e331);
  const _e332 = WF.h("p", { className: "wf-text" }, "Oct 2018 — Feb 2025");
  _e332.style.color = "#C69C6D";
  _e332.style.fontFamily = "JetBrains Mono, monospace";
  _e332.style.fontSize = "0.85rem";
  _e329.appendChild(_e332);
  const _e333 = WF.h("div", { className: "wf-spacer" });
  _e329.appendChild(_e333);
  const _e334 = WF.h("p", { className: "wf-text" }, "Completed a comprehensive IT degree over nearly 7 years, overcoming challenges such as COVID-19, political unrest, and revolution. Gained expertise in programming fundamentals, data structures, software engineering, database management, system analysis, and network technologies.");
  _e334.style.color = "#E8E6E1";
  _e334.style.lineHeight = "1.7";
  _e334.style.fontSize = "0.95rem";
  _e329.appendChild(_e334);
  const _e335 = WF.h("div", { className: "wf-spacer" });
  _e329.appendChild(_e335);
  const _e336 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e337 = WF.h("p", { className: "wf-text wf-text--bold" }, "Highlights:");
  _e337.style.color = "#C69C6D";
  _e337.style.fontSize = "0.9rem";
  _e337.style.fontWeight = "600";
  _e336.appendChild(_e337);
  const _e338 = WF.h("p", { className: "wf-text" }, "Developed practical skills through semester-long projects starting from Semester 3, applying theoretical knowledge to real-world IT solutions");
  _e338.style.fontFamily = "JetBrains Mono, monospace";
  _e338.style.color = "#E8E6E1";
  _e338.style.fontSize = "0.85rem";
  _e336.appendChild(_e338);
  const _e339 = WF.h("p", { className: "wf-text" }, "Enhanced soft skills through courses in communication, research methodology, and professional ethics");
  _e339.style.fontFamily = "JetBrains Mono, monospace";
  _e339.style.color = "#E8E6E1";
  _e339.style.fontSize = "0.85rem";
  _e336.appendChild(_e339);
  const _e340 = WF.h("p", { className: "wf-text" }, "Balanced academics with work experience, gaining hands-on industry insights and strengthening adaptability and time management");
  _e340.style.fontFamily = "JetBrains Mono, monospace";
  _e340.style.color = "#E8E6E1";
  _e340.style.fontSize = "0.85rem";
  _e336.appendChild(_e340);
  const _e341 = WF.h("p", { className: "wf-text" }, "Built a strong foundation in IT, combining technical expertise with problem-solving and teamwork skills");
  _e341.style.fontFamily = "JetBrains Mono, monospace";
  _e341.style.color = "#E8E6E1";
  _e341.style.fontSize = "0.85rem";
  _e336.appendChild(_e341);
  const _e342 = WF.h("p", { className: "wf-text" }, "Activities: GDSC, Open Days, Juniors Welcoming");
  _e342.style.fontFamily = "JetBrains Mono, monospace";
  _e342.style.color = "#8C8B88";
  _e342.style.fontSize = "0.8rem";
  _e336.appendChild(_e342);
  _e329.appendChild(_e336);
  _e328.appendChild(_e329);
  _e328.style.background = "#242422";
  _e328.style.border = "1px solid #2D2C2A";
  _e328.style.borderRadius = "0.75rem";
  _e328.style.padding = "2rem";
  _e328.style.marginBottom = "2rem";
  _e326.appendChild(_e328);
  const _e343 = WF.h("h2", { className: "wf-heading wf-heading--h2 wf-animate-fadeIn" }, "Certifications");
  _e343.style.fontSize = "1.5rem";
  _e343.style.fontWeight = "700";
  _e343.style.color = "#E8E6E1";
  _e343.style.letterSpacing = "-0.02em";
  _e343.style.marginBottom = "1rem";
  _e343.style.marginTop = "1rem";
  _e326.appendChild(_e343);
  const _e344 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e345 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e346 = WF.h("p", { className: "wf-text wf-text--bold" }, "Fundamentals of Backend Engineering");
  _e346.style.fontSize = "1rem";
  _e346.style.color = "#E8E6E1";
  _e345.appendChild(_e346);
  const _e347 = WF.h("p", { className: "wf-text wf-text--muted" }, "Udemy — Aug 2025");
  _e347.style.color = "#C69C6D";
  _e347.style.fontFamily = "JetBrains Mono, monospace";
  _e347.style.fontSize = "0.8rem";
  _e345.appendChild(_e347);
  const _e348 = WF.h("p", { className: "wf-text" }, "Deep dive into the protocols and communication patterns that power modern backend systems.");
  _e348.style.color = "#8C8B88";
  _e348.style.fontSize = "0.9rem";
  _e348.style.lineHeight = "1.6";
  _e345.appendChild(_e348);
  _e344.appendChild(_e345);
  _e344.style.background = "#242422";
  _e344.style.border = "1px solid #2D2C2A";
  _e344.style.borderRadius = "0.75rem";
  _e344.style.padding = "2rem";
  _e344.style.marginBottom = "2rem";
  _e326.appendChild(_e344);
  const _e349 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e350 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e351 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e352 = WF.h("span", { className: "wf-badge" }, "Coursera");
  _e352.style.fontFamily = "JetBrains Mono, monospace";
  _e352.style.background = "#2D2C2A";
  _e352.style.color = "#E8E6E1";
  _e352.style.padding = "0.2rem 0.6rem";
  _e352.style.borderRadius = "0.375rem";
  _e352.style.fontSize = "0.7rem";
  _e351.appendChild(_e352);
  const _e353 = WF.h("span", { className: "wf-badge" }, "2020");
  _e353.style.fontFamily = "JetBrains Mono, monospace";
  _e353.style.background = "#2D2C2A";
  _e353.style.color = "#8C8B88";
  _e353.style.padding = "0.2rem 0.6rem";
  _e353.style.borderRadius = "0.375rem";
  _e353.style.fontSize = "0.7rem";
  _e351.appendChild(_e353);
  _e350.appendChild(_e351);
  const _e354 = WF.h("p", { className: "wf-text" }, "Server-side Development with NodeJS, Express and MongoDB");
  _e354.style.fontFamily = "JetBrains Mono, monospace";
  _e354.style.color = "#E8E6E1";
  _e354.style.fontSize = "0.9rem";
  _e350.appendChild(_e354);
  const _e355 = WF.h("p", { className: "wf-text" }, "Introduction to HTML5 · Interactivity with JavaScript · Front-End Web UI Frameworks: Bootstrap 4 · IT Project Management · Front-End Web Development with React · Introduction to TCP/IP · Introduction to CSS3 · Computer Security and Systems Management");
  _e355.style.color = "#8C8B88";
  _e355.style.fontSize = "0.85rem";
  _e355.style.lineHeight = "1.6";
  _e350.appendChild(_e355);
  _e349.appendChild(_e350);
  _e349.style.background = "#242422";
  _e349.style.border = "1px solid #2D2C2A";
  _e349.style.borderRadius = "0.75rem";
  _e349.style.padding = "2rem";
  _e349.style.marginBottom = "2rem";
  _e326.appendChild(_e349);
  _e325.appendChild(_e326);
  _e325.style.maxWidth = "800px";
  _e325.style.margin = "0 auto";
  _e325.style.padding = "80px 2rem";
  _e325.classList.add("wf-s356");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s356 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s356 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e325);
  return _root;
}

function Page_Home(params) {
  const _root = document.createDocumentFragment();
  const _e357 = WF.h("div", { className: "wf-container" });
  const _e358 = WF.h("div", { className: "wf-stack wf-animate-fadeIn wf-stack--gap-md" });
  const _e359 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Monzer Omer");
  _e359.style.fontSize = "3rem";
  _e359.style.fontWeight = "700";
  _e359.style.color = "#E8E6E1";
  _e359.style.letterSpacing = "-0.02em";
  _e359.style.lineHeight = "1.1";
  _e359.classList.add("wf-s360");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s360 { font-size: 2rem; } } "; document.head.appendChild(_s); }
  _e358.appendChild(_e359);
  const _e361 = WF.h("div", { className: "wf-spacer" });
  _e358.appendChild(_e361);
  const _e362 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
  _e362.style.fontSize = "1.25rem";
  _e362.style.color = "#8C8B88";
  _e362.style.fontWeight = "400";
  _e362.classList.add("wf-s363");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s363 { font-size: 1rem; } } "; document.head.appendChild(_s); }
  _e358.appendChild(_e362);
  const _e364 = WF.h("div", { className: "wf-spacer" });
  _e358.appendChild(_e364);
  const _e365 = WF.h("p", { className: "wf-text" }, "Architecting scalable, resilient solutions and high-performance systems. Dedicated to clean, maintainable server-side architectures, data integrity, and low-level optimization.");
  _e365.style.fontSize = "1.1rem";
  _e365.style.color = "#E8E6E1";
  _e365.style.lineHeight = "1.7";
  _e365.style.maxWidth = "600px";
  _e358.appendChild(_e365);
  const _e366 = WF.h("div", { className: "wf-spacer" });
  _e358.appendChild(_e366);
  const _e367 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e368 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Rust");
  _e368.style.fontFamily = "JetBrains Mono, monospace";
  _e368.style.background = "#C69C6D";
  _e368.style.color = "#1A1A19";
  _e368.style.padding = "0.4rem 1rem";
  _e368.style.borderRadius = "0.375rem";
  _e368.style.fontSize = "0.875rem";
  _e368.style.fontWeight = "600";
  _e367.appendChild(_e368);
  const _e369 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e369.style.fontFamily = "JetBrains Mono, monospace";
  _e369.style.background = "#2D2C2A";
  _e369.style.color = "#E8E6E1";
  _e369.style.padding = "0.4rem 1rem";
  _e369.style.borderRadius = "0.375rem";
  _e369.style.fontSize = "0.875rem";
  _e367.appendChild(_e369);
  const _e370 = WF.h("span", { className: "wf-badge" }, "Distributed Systems");
  _e370.style.fontFamily = "JetBrains Mono, monospace";
  _e370.style.background = "#2D2C2A";
  _e370.style.color = "#E8E6E1";
  _e370.style.padding = "0.4rem 1rem";
  _e370.style.borderRadius = "0.375rem";
  _e370.style.fontSize = "0.875rem";
  _e367.appendChild(_e370);
  _e358.appendChild(_e367);
  const _e371 = WF.h("div", { className: "wf-spacer" });
  _e358.appendChild(_e371);
  const _e372 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e373 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e374 = WF.h("p", { className: "wf-text" }, "View Projects →");
  _e374.style.color = "#C69C6D";
  _e374.style.fontWeight = "500";
  _e374.style.fontSize = "1rem";
  _e374.style.transition = "color 200ms ease";
  _e373.appendChild(_e374);
  _e372.appendChild(_e373);
  const _e375 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e376 = WF.h("p", { className: "wf-text" }, "Experience →");
  _e376.style.color = "#8C8B88";
  _e376.style.fontSize = "1rem";
  _e376.style.transition = "color 200ms ease";
  _e375.appendChild(_e376);
  _e372.appendChild(_e375);
  const _e377 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e378 = WF.h("p", { className: "wf-text" }, "Get in Touch →");
  _e378.style.color = "#8C8B88";
  _e378.style.fontSize = "1rem";
  _e378.style.transition = "color 200ms ease";
  _e377.appendChild(_e378);
  _e372.appendChild(_e377);
  _e358.appendChild(_e372);
  const _e379 = WF.h("div", { className: "wf-spacer" });
  _e358.appendChild(_e379);
  const _e380 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e381 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e382 = WF.h("p", { className: "wf-text" }, "GitHub");
  _e382.style.fontFamily = "JetBrains Mono, monospace";
  _e382.style.color = "#8C8B88";
  _e382.style.fontSize = "0.85rem";
  _e382.style.transition = "color 200ms ease";
  _e381.appendChild(_e382);
  _e380.appendChild(_e381);
  const _e383 = WF.h("p", { className: "wf-text wf-text--muted" }, "·");
  _e383.style.color = "#2D2C2A";
  _e380.appendChild(_e383);
  const _e384 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
  const _e385 = WF.h("p", { className: "wf-text" }, "LinkedIn");
  _e385.style.fontFamily = "JetBrains Mono, monospace";
  _e385.style.color = "#8C8B88";
  _e385.style.fontSize = "0.85rem";
  _e385.style.transition = "color 200ms ease";
  _e384.appendChild(_e385);
  _e380.appendChild(_e384);
  const _e386 = WF.h("p", { className: "wf-text wf-text--muted" }, "·");
  _e386.style.color = "#2D2C2A";
  _e380.appendChild(_e386);
  const _e387 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e388 = WF.h("p", { className: "wf-text" }, "Email");
  _e388.style.fontFamily = "JetBrains Mono, monospace";
  _e388.style.color = "#8C8B88";
  _e388.style.fontSize = "0.85rem";
  _e388.style.transition = "color 200ms ease";
  _e387.appendChild(_e388);
  _e380.appendChild(_e387);
  _e358.appendChild(_e380);
  _e357.appendChild(_e358);
  _e357.style.maxWidth = "800px";
  _e357.style.margin = "0 auto";
  _e357.style.padding = "80px 2rem";
  _e357.style.minHeight = "100vh";
  _e357.style.display = "flex";
  _e357.style.flexDirection = "column";
  _e357.style.justifyContent = "center";
  _e357.classList.add("wf-s389");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s389 { padding: 60px 1.5rem; min-height: 90vh; } } @media (max-width: 480px) { .wf-s389 { padding: 40px 1rem; min-height: auto; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e357);
  return _root;
}

function Page_Skills(params) {
  const _root = document.createDocumentFragment();
  const _e390 = WF.h("div", { className: "wf-container" });
  const _e391 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e392 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Infrastructure & Capabilities");
  _e392.style.fontSize = "2rem";
  _e392.style.fontWeight = "700";
  _e392.style.color = "#E8E6E1";
  _e392.style.letterSpacing = "-0.02em";
  _e392.style.marginBottom = "1rem";
  _e391.appendChild(_e392);
  const _e393 = WF.h("p", { className: "wf-text wf-text--muted" }, "Languages, frameworks, and systems I architect, build, and deploy with.");
  _e393.style.color = "#8C8B88";
  _e393.style.fontSize = "1rem";
  _e393.style.marginBottom = "3rem";
  _e391.appendChild(_e393);
  const _e394 = WF.h("div", { className: "wf-spacer" });
  _e391.appendChild(_e394);
  const _e395 = WF.h("div", { className: "wf-grid wf-grid--gap-md", style: { gridTemplateColumns: 'repeat(2, 1fr)' } });
  const _e396 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e397 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e398 = WF.h("p", { className: "wf-text wf-text--bold" }, "Languages");
  _e398.style.fontSize = "1rem";
  _e398.style.color = "#C69C6D";
  _e398.style.fontWeight = "600";
  _e398.style.marginBottom = "0.5rem";
  _e397.appendChild(_e398);
  const _e399 = WF.h("p", { className: "wf-text" }, "Rust");
  _e399.style.fontFamily = "JetBrains Mono, monospace";
  _e399.style.color = "#E8E6E1";
  _e399.style.fontSize = "0.9rem";
  _e397.appendChild(_e399);
  const _e400 = WF.h("p", { className: "wf-text" }, "TypeScript");
  _e400.style.fontFamily = "JetBrains Mono, monospace";
  _e400.style.color = "#E8E6E1";
  _e400.style.fontSize = "0.9rem";
  _e397.appendChild(_e400);
  const _e401 = WF.h("p", { className: "wf-text" }, "JavaScript");
  _e401.style.fontFamily = "JetBrains Mono, monospace";
  _e401.style.color = "#E8E6E1";
  _e401.style.fontSize = "0.9rem";
  _e397.appendChild(_e401);
  const _e402 = WF.h("p", { className: "wf-text" }, "SQL");
  _e402.style.fontFamily = "JetBrains Mono, monospace";
  _e402.style.color = "#E8E6E1";
  _e402.style.fontSize = "0.9rem";
  _e397.appendChild(_e402);
  _e396.appendChild(_e397);
  _e396.style.background = "#242422";
  _e396.style.border = "1px solid #2D2C2A";
  _e396.style.borderRadius = "0.75rem";
  _e396.style.padding = "2rem";
  _e395.appendChild(_e396);
  const _e403 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e404 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e405 = WF.h("p", { className: "wf-text wf-text--bold" }, "Backend Frameworks");
  _e405.style.fontSize = "1rem";
  _e405.style.color = "#C69C6D";
  _e405.style.fontWeight = "600";
  _e405.style.marginBottom = "0.5rem";
  _e404.appendChild(_e405);
  const _e406 = WF.h("p", { className: "wf-text" }, "Node.js");
  _e406.style.fontFamily = "JetBrains Mono, monospace";
  _e406.style.color = "#E8E6E1";
  _e406.style.fontSize = "0.9rem";
  _e404.appendChild(_e406);
  const _e407 = WF.h("p", { className: "wf-text" }, "NestJS");
  _e407.style.fontFamily = "JetBrains Mono, monospace";
  _e407.style.color = "#E8E6E1";
  _e407.style.fontSize = "0.9rem";
  _e404.appendChild(_e407);
  const _e408 = WF.h("p", { className: "wf-text" }, "Express.js");
  _e408.style.fontFamily = "JetBrains Mono, monospace";
  _e408.style.color = "#E8E6E1";
  _e408.style.fontSize = "0.9rem";
  _e404.appendChild(_e408);
  const _e409 = WF.h("p", { className: "wf-text" }, "GraphQL");
  _e409.style.fontFamily = "JetBrains Mono, monospace";
  _e409.style.color = "#E8E6E1";
  _e409.style.fontSize = "0.9rem";
  _e404.appendChild(_e409);
  const _e410 = WF.h("p", { className: "wf-text" }, "REST APIs");
  _e410.style.fontFamily = "JetBrains Mono, monospace";
  _e410.style.color = "#E8E6E1";
  _e410.style.fontSize = "0.9rem";
  _e404.appendChild(_e410);
  _e403.appendChild(_e404);
  _e403.style.background = "#242422";
  _e403.style.border = "1px solid #2D2C2A";
  _e403.style.borderRadius = "0.75rem";
  _e403.style.padding = "2rem";
  _e395.appendChild(_e403);
  const _e411 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e412 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e413 = WF.h("p", { className: "wf-text wf-text--bold" }, "Databases & Storage");
  _e413.style.fontSize = "1rem";
  _e413.style.color = "#C69C6D";
  _e413.style.fontWeight = "600";
  _e413.style.marginBottom = "0.5rem";
  _e412.appendChild(_e413);
  const _e414 = WF.h("p", { className: "wf-text" }, "PostgreSQL");
  _e414.style.fontFamily = "JetBrains Mono, monospace";
  _e414.style.color = "#E8E6E1";
  _e414.style.fontSize = "0.9rem";
  _e412.appendChild(_e414);
  const _e415 = WF.h("p", { className: "wf-text" }, "MySQL");
  _e415.style.fontFamily = "JetBrains Mono, monospace";
  _e415.style.color = "#E8E6E1";
  _e415.style.fontSize = "0.9rem";
  _e412.appendChild(_e415);
  const _e416 = WF.h("p", { className: "wf-text" }, "MongoDB");
  _e416.style.fontFamily = "JetBrains Mono, monospace";
  _e416.style.color = "#E8E6E1";
  _e416.style.fontSize = "0.9rem";
  _e412.appendChild(_e416);
  const _e417 = WF.h("p", { className: "wf-text" }, "Firebase");
  _e417.style.fontFamily = "JetBrains Mono, monospace";
  _e417.style.color = "#E8E6E1";
  _e417.style.fontSize = "0.9rem";
  _e412.appendChild(_e417);
  const _e418 = WF.h("p", { className: "wf-text" }, "Redis");
  _e418.style.fontFamily = "JetBrains Mono, monospace";
  _e418.style.color = "#E8E6E1";
  _e418.style.fontSize = "0.9rem";
  _e412.appendChild(_e418);
  _e411.appendChild(_e412);
  _e411.style.background = "#242422";
  _e411.style.border = "1px solid #2D2C2A";
  _e411.style.borderRadius = "0.75rem";
  _e411.style.padding = "2rem";
  _e395.appendChild(_e411);
  const _e419 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e420 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e421 = WF.h("p", { className: "wf-text wf-text--bold" }, "Messaging & Streaming");
  _e421.style.fontSize = "1rem";
  _e421.style.color = "#C69C6D";
  _e421.style.fontWeight = "600";
  _e421.style.marginBottom = "0.5rem";
  _e420.appendChild(_e421);
  const _e422 = WF.h("p", { className: "wf-text" }, "Apache Kafka");
  _e422.style.fontFamily = "JetBrains Mono, monospace";
  _e422.style.color = "#E8E6E1";
  _e422.style.fontSize = "0.9rem";
  _e420.appendChild(_e422);
  const _e423 = WF.h("p", { className: "wf-text" }, "RabbitMQ");
  _e423.style.fontFamily = "JetBrains Mono, monospace";
  _e423.style.color = "#E8E6E1";
  _e423.style.fontSize = "0.9rem";
  _e420.appendChild(_e423);
  const _e424 = WF.h("p", { className: "wf-text" }, "Event-Driven Design");
  _e424.style.fontFamily = "JetBrains Mono, monospace";
  _e424.style.color = "#E8E6E1";
  _e424.style.fontSize = "0.9rem";
  _e420.appendChild(_e424);
  const _e425 = WF.h("p", { className: "wf-text" }, "WebSocket");
  _e425.style.fontFamily = "JetBrains Mono, monospace";
  _e425.style.color = "#E8E6E1";
  _e425.style.fontSize = "0.9rem";
  _e420.appendChild(_e425);
  const _e426 = WF.h("p", { className: "wf-text" }, "gRPC");
  _e426.style.fontFamily = "JetBrains Mono, monospace";
  _e426.style.color = "#E8E6E1";
  _e426.style.fontSize = "0.9rem";
  _e420.appendChild(_e426);
  _e419.appendChild(_e420);
  _e419.style.background = "#242422";
  _e419.style.border = "1px solid #2D2C2A";
  _e419.style.borderRadius = "0.75rem";
  _e419.style.padding = "2rem";
  _e395.appendChild(_e419);
  const _e427 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e428 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e429 = WF.h("p", { className: "wf-text wf-text--bold" }, "Systems & Architecture");
  _e429.style.fontSize = "1rem";
  _e429.style.color = "#C69C6D";
  _e429.style.fontWeight = "600";
  _e429.style.marginBottom = "0.5rem";
  _e428.appendChild(_e429);
  const _e430 = WF.h("p", { className: "wf-text" }, "Microservices Architecture");
  _e430.style.fontFamily = "JetBrains Mono, monospace";
  _e430.style.color = "#E8E6E1";
  _e430.style.fontSize = "0.9rem";
  _e428.appendChild(_e430);
  const _e431 = WF.h("p", { className: "wf-text" }, "Distributed Systems");
  _e431.style.fontFamily = "JetBrains Mono, monospace";
  _e431.style.color = "#E8E6E1";
  _e431.style.fontSize = "0.9rem";
  _e428.appendChild(_e431);
  const _e432 = WF.h("p", { className: "wf-text" }, "WebAssembly");
  _e432.style.fontFamily = "JetBrains Mono, monospace";
  _e432.style.color = "#E8E6E1";
  _e432.style.fontSize = "0.9rem";
  _e428.appendChild(_e432);
  const _e433 = WF.h("p", { className: "wf-text" }, "System Design");
  _e433.style.fontFamily = "JetBrains Mono, monospace";
  _e433.style.color = "#E8E6E1";
  _e433.style.fontSize = "0.9rem";
  _e428.appendChild(_e433);
  const _e434 = WF.h("p", { className: "wf-text" }, "Compiler Design");
  _e434.style.fontFamily = "JetBrains Mono, monospace";
  _e434.style.color = "#E8E6E1";
  _e434.style.fontSize = "0.9rem";
  _e428.appendChild(_e434);
  _e427.appendChild(_e428);
  _e427.style.background = "#242422";
  _e427.style.border = "1px solid #2D2C2A";
  _e427.style.borderRadius = "0.75rem";
  _e427.style.padding = "2rem";
  _e395.appendChild(_e427);
  const _e435 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e436 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e437 = WF.h("p", { className: "wf-text wf-text--bold" }, "DevOps & Infrastructure");
  _e437.style.fontSize = "1rem";
  _e437.style.color = "#C69C6D";
  _e437.style.fontWeight = "600";
  _e437.style.marginBottom = "0.5rem";
  _e436.appendChild(_e437);
  const _e438 = WF.h("p", { className: "wf-text" }, "Docker");
  _e438.style.fontFamily = "JetBrains Mono, monospace";
  _e438.style.color = "#E8E6E1";
  _e438.style.fontSize = "0.9rem";
  _e436.appendChild(_e438);
  const _e439 = WF.h("p", { className: "wf-text" }, "Nginx");
  _e439.style.fontFamily = "JetBrains Mono, monospace";
  _e439.style.color = "#E8E6E1";
  _e439.style.fontSize = "0.9rem";
  _e436.appendChild(_e439);
  const _e440 = WF.h("p", { className: "wf-text" }, "Linux");
  _e440.style.fontFamily = "JetBrains Mono, monospace";
  _e440.style.color = "#E8E6E1";
  _e440.style.fontSize = "0.9rem";
  _e436.appendChild(_e440);
  const _e441 = WF.h("p", { className: "wf-text" }, "CI/CD");
  _e441.style.fontFamily = "JetBrains Mono, monospace";
  _e441.style.color = "#E8E6E1";
  _e441.style.fontSize = "0.9rem";
  _e436.appendChild(_e441);
  const _e442 = WF.h("p", { className: "wf-text" }, "Git");
  _e442.style.fontFamily = "JetBrains Mono, monospace";
  _e442.style.color = "#E8E6E1";
  _e442.style.fontSize = "0.9rem";
  _e436.appendChild(_e442);
  _e435.appendChild(_e436);
  _e435.style.background = "#242422";
  _e435.style.border = "1px solid #2D2C2A";
  _e435.style.borderRadius = "0.75rem";
  _e435.style.padding = "2rem";
  _e395.appendChild(_e435);
  const _e443 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e444 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e445 = WF.h("p", { className: "wf-text wf-text--bold" }, "Frontend & Desktop");
  _e445.style.fontSize = "1rem";
  _e445.style.color = "#C69C6D";
  _e445.style.fontWeight = "600";
  _e445.style.marginBottom = "0.5rem";
  _e444.appendChild(_e445);
  const _e446 = WF.h("p", { className: "wf-text" }, "React");
  _e446.style.fontFamily = "JetBrains Mono, monospace";
  _e446.style.color = "#E8E6E1";
  _e446.style.fontSize = "0.9rem";
  _e444.appendChild(_e446);
  const _e447 = WF.h("p", { className: "wf-text" }, "React Native");
  _e447.style.fontFamily = "JetBrains Mono, monospace";
  _e447.style.color = "#E8E6E1";
  _e447.style.fontSize = "0.9rem";
  _e444.appendChild(_e447);
  const _e448 = WF.h("p", { className: "wf-text" }, "Electron");
  _e448.style.fontFamily = "JetBrains Mono, monospace";
  _e448.style.color = "#E8E6E1";
  _e448.style.fontSize = "0.9rem";
  _e444.appendChild(_e448);
  const _e449 = WF.h("p", { className: "wf-text" }, "Tauri");
  _e449.style.fontFamily = "JetBrains Mono, monospace";
  _e449.style.color = "#E8E6E1";
  _e449.style.fontSize = "0.9rem";
  _e444.appendChild(_e449);
  const _e450 = WF.h("p", { className: "wf-text" }, "GTK4 / libadwaita");
  _e450.style.fontFamily = "JetBrains Mono, monospace";
  _e450.style.color = "#E8E6E1";
  _e450.style.fontSize = "0.9rem";
  _e444.appendChild(_e450);
  _e443.appendChild(_e444);
  _e443.style.background = "#242422";
  _e443.style.border = "1px solid #2D2C2A";
  _e443.style.borderRadius = "0.75rem";
  _e443.style.padding = "2rem";
  _e395.appendChild(_e443);
  const _e451 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e452 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e453 = WF.h("p", { className: "wf-text wf-text--bold" }, "Security & Quality");
  _e453.style.fontSize = "1rem";
  _e453.style.color = "#C69C6D";
  _e453.style.fontWeight = "600";
  _e453.style.marginBottom = "0.5rem";
  _e452.appendChild(_e453);
  const _e454 = WF.h("p", { className: "wf-text" }, "AES Encryption");
  _e454.style.fontFamily = "JetBrains Mono, monospace";
  _e454.style.color = "#E8E6E1";
  _e454.style.fontSize = "0.9rem";
  _e452.appendChild(_e454);
  const _e455 = WF.h("p", { className: "wf-text" }, "JWT / OAuth");
  _e455.style.fontFamily = "JetBrains Mono, monospace";
  _e455.style.color = "#E8E6E1";
  _e455.style.fontSize = "0.9rem";
  _e452.appendChild(_e455);
  const _e456 = WF.h("p", { className: "wf-text" }, "Unit Testing");
  _e456.style.fontFamily = "JetBrains Mono, monospace";
  _e456.style.color = "#E8E6E1";
  _e456.style.fontSize = "0.9rem";
  _e452.appendChild(_e456);
  const _e457 = WF.h("p", { className: "wf-text" }, "Code Review");
  _e457.style.fontFamily = "JetBrains Mono, monospace";
  _e457.style.color = "#E8E6E1";
  _e457.style.fontSize = "0.9rem";
  _e452.appendChild(_e457);
  const _e458 = WF.h("p", { className: "wf-text" }, "Agile / Scrum");
  _e458.style.fontFamily = "JetBrains Mono, monospace";
  _e458.style.color = "#E8E6E1";
  _e458.style.fontSize = "0.9rem";
  _e452.appendChild(_e458);
  _e451.appendChild(_e452);
  _e451.style.background = "#242422";
  _e451.style.border = "1px solid #2D2C2A";
  _e451.style.borderRadius = "0.75rem";
  _e451.style.padding = "2rem";
  _e395.appendChild(_e451);
  _e391.appendChild(_e395);
  _e390.appendChild(_e391);
  _e390.style.maxWidth = "800px";
  _e390.style.margin = "0 auto";
  _e390.style.padding = "80px 2rem";
  _e390.classList.add("wf-s459");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s459 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s459 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e390);
  return _root;
}

(function() {
  const _app = document.getElementById('app');
  _app.innerHTML = '';
  const _e460 = WF.h("div", { className: "wf-row wf-row--center wf-row--between" });
  const _e461 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e462 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
  _e462.style.fontFamily = "JetBrains Mono, monospace";
  _e462.style.color = "#E8E6E1";
  _e462.style.fontSize = "0.9rem";
  _e462.style.fontWeight = "600";
  _e461.appendChild(_e462);
  _e460.appendChild(_e461);
  const _e463 = WF.h("button", { className: "wf-btn wf-btn--small wf-btn--outlined", "on:click": (e) => { NavStore.toggle(); } }, "Menu");
  _e463.style.color = "#8C8B88";
  _e463.style.background = "transparent";
  _e463.style.border = "1px solid #2D2C2A";
  _e463.style.cursor = "pointer";
  _e463.style.fontFamily = "JetBrains Mono, monospace";
  _e463.style.fontSize = "0.75rem";
  _e463.style.padding = "0.35rem 0.75rem";
  _e463.style.borderRadius = "0.375rem";
  _e463.classList.add("wf-s464");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s464 { padding: 0.5rem 1rem; font-size: 0.85rem; min-height: 44px; min-width: 44px; } } "; document.head.appendChild(_s); }
  _e460.appendChild(_e463);
  _e460.style.display = "none";
  _e460.style.background = "#1A1A19";
  _e460.style.borderBottom = "1px solid #2D2C2A";
  _e460.style.padding = "0.75rem 1.25rem";
  _e460.style.position = "sticky";
  _e460.style.top = "0";
  _e460.style.zIndex = "200";
  _e460.style.flexDirection = "row";
  _e460.style.flexWrap = "nowrap";
  _e460.classList.add("wf-s465");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s465 { display: flex; } } @media (max-width: 480px) { .wf-s465 { padding: 0.6rem 1rem; } } "; document.head.appendChild(_s); }
  _app.appendChild(_e460);
  WF.condRender(_app,
    () => NavStore.sidebarOpen,
    () => {
      const _e466 = document.createDocumentFragment();
      const _e467 = WF.h("div", { className: "wf-container", "on:click": (event) => { NavStore.close(); } });
      _e467.style.position = "fixed";
      _e467.style.top = "0";
      _e467.style.left = "0";
      _e467.style.right = "0";
      _e467.style.bottom = "0";
      _e467.style.background = "rgba(0, 0, 0, 0.5)";
      _e467.style.zIndex = "399";
      _e467.style.maxWidth = "100%";
      _e467.style.padding = "0";
      _e466.appendChild(_e467);
      const _e468 = WF.h("div", { className: "wf-container" });
      const _e469 = WF.h("div", { className: "wf-container" });
      const _e470 = WF.h("button", { className: "wf-btn wf-btn--small wf-btn--outlined", "on:click": (e) => { NavStore.close(); } }, "✕");
      _e470.style.color = "#8C8B88";
      _e470.style.background = "transparent";
      _e470.style.border = "1px solid #2D2C2A";
      _e470.style.cursor = "pointer";
      _e470.style.fontSize = "0.9rem";
      _e470.style.padding = "0.35rem 0.65rem";
      _e470.style.borderRadius = "0.375rem";
      _e470.style.minHeight = "36px";
      _e470.style.minWidth = "36px";
      _e470.style.lineHeight = "1";
      _e469.appendChild(_e470);
      _e469.style.display = "flex";
      _e469.style.justifyContent = "flex-end";
      _e469.style.padding = "0.75rem 1rem";
      _e469.style.borderBottom = "1px solid #2D2C2A";
      _e468.appendChild(_e469);
      const _e471 = WF.h("div", { className: "wf-container" });
      const _e472 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
      const _e473 = WF.h("a", { className: "wf-link", href: WF._basePath + "/", "on:click": (event) => { NavStore.close(); } });
      const _e474 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
      _e474.style.fontFamily = "JetBrains Mono, monospace";
      _e474.style.color = "#E8E6E1";
      _e474.style.fontSize = "1rem";
      _e474.style.fontWeight = "600";
      _e473.appendChild(_e474);
      _e472.appendChild(_e473);
      const _e475 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
      _e475.style.color = "#8C8B88";
      _e475.style.fontSize = "0.75rem";
      _e472.appendChild(_e475);
      _e471.appendChild(_e472);
      _e471.style.padding = "1.5rem";
      _e471.style.borderBottom = "1px solid #2D2C2A";
      _e471.style.maxWidth = "100%";
      _e468.appendChild(_e471);
      const _e476 = WF.h("div", { className: "wf-stack" });
      const _e477 = WF.h("a", { className: "wf-link", href: WF._basePath + "/", "on:click": (event) => { NavStore.close(); } });
      const _e478 = WF.h("p", { className: "wf-text" }, "Home");
      _e478.style.display = "block";
      _e478.style.padding = "0.75rem 1.5rem";
      _e478.style.color = "#8C8B88";
      _e478.style.fontSize = "0.95rem";
      _e478.style.minHeight = "44px";
      _e478.style.lineHeight = "1.4";
      _e477.appendChild(_e478);
      _e476.appendChild(_e477);
      const _e479 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects", "on:click": (event) => { NavStore.close(); } });
      const _e480 = WF.h("p", { className: "wf-text" }, "Projects");
      _e480.style.display = "block";
      _e480.style.padding = "0.75rem 1.5rem";
      _e480.style.color = "#8C8B88";
      _e480.style.fontSize = "0.95rem";
      _e480.style.minHeight = "44px";
      _e480.style.lineHeight = "1.4";
      _e479.appendChild(_e480);
      _e476.appendChild(_e479);
      const _e481 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience", "on:click": (event) => { NavStore.close(); } });
      const _e482 = WF.h("p", { className: "wf-text" }, "Experience");
      _e482.style.display = "block";
      _e482.style.padding = "0.75rem 1.5rem";
      _e482.style.color = "#8C8B88";
      _e482.style.fontSize = "0.95rem";
      _e482.style.minHeight = "44px";
      _e482.style.lineHeight = "1.4";
      _e481.appendChild(_e482);
      _e476.appendChild(_e481);
      const _e483 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills", "on:click": (event) => { NavStore.close(); } });
      const _e484 = WF.h("p", { className: "wf-text" }, "Skills");
      _e484.style.display = "block";
      _e484.style.padding = "0.75rem 1.5rem";
      _e484.style.color = "#8C8B88";
      _e484.style.fontSize = "0.95rem";
      _e484.style.minHeight = "44px";
      _e484.style.lineHeight = "1.4";
      _e483.appendChild(_e484);
      _e476.appendChild(_e483);
      const _e485 = WF.h("a", { className: "wf-link", href: WF._basePath + "/education", "on:click": (event) => { NavStore.close(); } });
      const _e486 = WF.h("p", { className: "wf-text" }, "Education");
      _e486.style.display = "block";
      _e486.style.padding = "0.75rem 1.5rem";
      _e486.style.color = "#8C8B88";
      _e486.style.fontSize = "0.95rem";
      _e486.style.minHeight = "44px";
      _e486.style.lineHeight = "1.4";
      _e485.appendChild(_e486);
      _e476.appendChild(_e485);
      const _e487 = WF.h("a", { className: "wf-link", href: WF._basePath + "/history", "on:click": (event) => { NavStore.close(); } });
      const _e488 = WF.h("p", { className: "wf-text" }, "History");
      _e488.style.display = "block";
      _e488.style.padding = "0.75rem 1.5rem";
      _e488.style.color = "#8C8B88";
      _e488.style.fontSize = "0.95rem";
      _e488.style.minHeight = "44px";
      _e488.style.lineHeight = "1.4";
      _e487.appendChild(_e488);
      _e476.appendChild(_e487);
      const _e489 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact", "on:click": (event) => { NavStore.close(); } });
      const _e490 = WF.h("p", { className: "wf-text" }, "Contact");
      _e490.style.display = "block";
      _e490.style.padding = "0.75rem 1.5rem";
      _e490.style.color = "#8C8B88";
      _e490.style.fontSize = "0.95rem";
      _e490.style.minHeight = "44px";
      _e490.style.lineHeight = "1.4";
      _e489.appendChild(_e490);
      _e476.appendChild(_e489);
      _e476.style.padding = "1rem 0";
      _e476.style.gap = "2px";
      _e468.appendChild(_e476);
      const _e491 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
      const _e492 = WF.h("div", { className: "wf-row wf-row--gap-md" });
      const _e493 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
      const _e494 = WF.h("p", { className: "wf-text" }, "GitHub");
      _e494.style.fontFamily = "JetBrains Mono, monospace";
      _e494.style.color = "#8C8B88";
      _e494.style.fontSize = "0.75rem";
      _e493.appendChild(_e494);
      _e492.appendChild(_e493);
      const _e495 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
      const _e496 = WF.h("p", { className: "wf-text" }, "LinkedIn");
      _e496.style.fontFamily = "JetBrains Mono, monospace";
      _e496.style.color = "#8C8B88";
      _e496.style.fontSize = "0.75rem";
      _e495.appendChild(_e496);
      _e492.appendChild(_e495);
      _e491.appendChild(_e492);
      const _e497 = WF.h("p", { className: "wf-text wf-text--muted" }, "Built with WebFluent");
      _e497.style.fontFamily = "JetBrains Mono, monospace";
      _e497.style.color = "#555";
      _e497.style.fontSize = "0.7rem";
      _e497.style.marginTop = "0.5rem";
      _e491.appendChild(_e497);
      _e491.style.padding = "1rem 1.5rem";
      _e491.style.marginTop = "auto";
      _e491.style.borderTop = "1px solid #2D2C2A";
      _e468.appendChild(_e491);
      _e468.style.position = "fixed";
      _e468.style.top = "0";
      _e468.style.left = "0";
      _e468.style.bottom = "0";
      _e468.style.width = "280px";
      _e468.style.maxWidth = "75vw";
      _e468.style.zIndex = "400";
      _e468.style.padding = "0";
      _e468.style.background = "#1A1A19";
      _e468.style.borderRight = "1px solid #2D2C2A";
      _e468.style.overflowY = "auto";
      _e468.style.display = "flex";
      _e468.style.flexDirection = "column";
      _e468.style.boxShadow = "4px 0 24px rgba(0,0,0,0.4)";
      _e468.classList.add("wf-s498");
      { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 400px) { .wf-s498 { width: 100%; max-width: 100vw; } } "; document.head.appendChild(_s); }
      _e466.appendChild(_e468);
      return _e466;
    },
    null,
    null
  );
  const _e499 = WF.h("div", { className: "wf-row" });
  _e499.style.minHeight = "100vh";
  _e499.style.flexDirection = "row";
  _e499.style.flexWrap = "nowrap";
  _app.appendChild(_e499);
  const _e500 = WF.h("div", { className: "wf-container" });
  const _e501 = WF.h("div", { className: "wf-container" });
  const _e502 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
  const _e503 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e504 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
  _e504.style.fontFamily = "JetBrains Mono, monospace";
  _e504.style.color = "#E8E6E1";
  _e504.style.fontSize = "1rem";
  _e504.style.fontWeight = "600";
  _e503.appendChild(_e504);
  _e502.appendChild(_e503);
  const _e505 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
  _e505.style.color = "#8C8B88";
  _e505.style.fontSize = "0.75rem";
  _e502.appendChild(_e505);
  _e501.appendChild(_e502);
  _e501.style.padding = "1.5rem";
  _e501.style.borderBottom = "1px solid #2D2C2A";
  _e501.style.maxWidth = "100%";
  _e500.appendChild(_e501);
  const _e506 = WF.h("div", { className: "wf-stack" });
  const _e507 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e508 = WF.h("p", { className: "wf-text" }, "Home");
  _e508.style.display = "block";
  _e508.style.padding = "0.55rem 1.5rem";
  _e508.style.color = "#8C8B88";
  _e508.style.fontSize = "0.875rem";
  _e507.appendChild(_e508);
  _e506.appendChild(_e507);
  const _e509 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e510 = WF.h("p", { className: "wf-text" }, "Projects");
  _e510.style.display = "block";
  _e510.style.padding = "0.55rem 1.5rem";
  _e510.style.color = "#8C8B88";
  _e510.style.fontSize = "0.875rem";
  _e509.appendChild(_e510);
  _e506.appendChild(_e509);
  const _e511 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e512 = WF.h("p", { className: "wf-text" }, "Experience");
  _e512.style.display = "block";
  _e512.style.padding = "0.55rem 1.5rem";
  _e512.style.color = "#8C8B88";
  _e512.style.fontSize = "0.875rem";
  _e511.appendChild(_e512);
  _e506.appendChild(_e511);
  const _e513 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills" });
  const _e514 = WF.h("p", { className: "wf-text" }, "Skills");
  _e514.style.display = "block";
  _e514.style.padding = "0.55rem 1.5rem";
  _e514.style.color = "#8C8B88";
  _e514.style.fontSize = "0.875rem";
  _e513.appendChild(_e514);
  _e506.appendChild(_e513);
  const _e515 = WF.h("a", { className: "wf-link", href: WF._basePath + "/education" });
  const _e516 = WF.h("p", { className: "wf-text" }, "Education");
  _e516.style.display = "block";
  _e516.style.padding = "0.55rem 1.5rem";
  _e516.style.color = "#8C8B88";
  _e516.style.fontSize = "0.875rem";
  _e515.appendChild(_e516);
  _e506.appendChild(_e515);
  const _e517 = WF.h("a", { className: "wf-link", href: WF._basePath + "/history" });
  const _e518 = WF.h("p", { className: "wf-text" }, "History");
  _e518.style.display = "block";
  _e518.style.padding = "0.55rem 1.5rem";
  _e518.style.color = "#8C8B88";
  _e518.style.fontSize = "0.875rem";
  _e517.appendChild(_e518);
  _e506.appendChild(_e517);
  const _e519 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e520 = WF.h("p", { className: "wf-text" }, "Contact");
  _e520.style.display = "block";
  _e520.style.padding = "0.55rem 1.5rem";
  _e520.style.color = "#8C8B88";
  _e520.style.fontSize = "0.875rem";
  _e519.appendChild(_e520);
  _e506.appendChild(_e519);
  _e506.style.padding = "1rem 0";
  _e506.style.gap = "2px";
  _e500.appendChild(_e506);
  const _e521 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
  const _e522 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e523 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e524 = WF.h("p", { className: "wf-text" }, "GitHub");
  _e524.style.fontFamily = "JetBrains Mono, monospace";
  _e524.style.color = "#8C8B88";
  _e524.style.fontSize = "0.75rem";
  _e523.appendChild(_e524);
  _e522.appendChild(_e523);
  const _e525 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
  const _e526 = WF.h("p", { className: "wf-text" }, "LinkedIn");
  _e526.style.fontFamily = "JetBrains Mono, monospace";
  _e526.style.color = "#8C8B88";
  _e526.style.fontSize = "0.75rem";
  _e525.appendChild(_e526);
  _e522.appendChild(_e525);
  _e521.appendChild(_e522);
  const _e527 = WF.h("p", { className: "wf-text wf-text--muted" }, "Built with WebFluent");
  _e527.style.fontFamily = "JetBrains Mono, monospace";
  _e527.style.color = "#555";
  _e527.style.fontSize = "0.7rem";
  _e527.style.marginTop = "0.5rem";
  _e521.appendChild(_e527);
  _e521.style.padding = "1rem 1.5rem";
  _e521.style.marginTop = "auto";
  _e521.style.borderTop = "1px solid #2D2C2A";
  _e500.appendChild(_e521);
  _e500.style.width = "220px";
  _e500.style.minWidth = "220px";
  _e500.style.maxWidth = "220px";
  _e500.style.padding = "0";
  _e500.style.position = "sticky";
  _e500.style.top = "0";
  _e500.style.height = "100vh";
  _e500.style.background = "#1A1A19";
  _e500.style.borderRight = "1px solid #2D2C2A";
  _e500.style.overflowY = "auto";
  _e500.style.display = "flex";
  _e500.style.flexDirection = "column";
  _e500.style.flexShrink = "0";
  _e500.classList.add("wf-s528");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s528 { display: none; } } "; document.head.appendChild(_s); }
  _e499.appendChild(_e500);
  const _e529 = WF.h("div", { className: "wf-container" });
  _e529.style.flex = "1";
  _e529.style.maxWidth = "100%";
  _e529.style.minHeight = "100vh";
  _e529.style.padding = "0";
  _e529.style.minWidth = "0";
  _e499.appendChild(_e529);
  const _routerEl = document.createElement('div');
  _routerEl.id = 'wf-router';
  _routerEl.style.flex = '1';
  _e529.appendChild(_routerEl);
  const _routes = [
    { path: "/", render: (params) => Page_Home(params) },
    { path: "/projects", render: (params) => Page_Projects(params) },
    { path: "/experience", render: (params) => Page_Experience(params) },
    { path: "/skills", render: (params) => Page_Skills(params) },
    { path: "/education", render: (params) => Page_Education(params) },
    { path: "/history", render: (params) => Page_History(params) },
    { path: "/contact", render: (params) => Page_Contact(params) },
  ];
  WF.createRouter(_routes, _routerEl);
})();
