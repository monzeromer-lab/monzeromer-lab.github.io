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

function Page_Projects(params) {
  const _root = document.createDocumentFragment();
  const _e21 = WF.h("div", { className: "wf-container" });
  const _e22 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e23 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Projects");
  _e23.style.fontSize = "2rem";
  _e23.style.fontWeight = "700";
  _e23.style.color = "#E8E6E1";
  _e23.style.letterSpacing = "-0.02em";
  _e23.style.marginBottom = "1rem";
  _e22.appendChild(_e23);
  const _e24 = WF.h("p", { className: "wf-text wf-text--muted wf-animate-fadeIn" }, "Things I've designed, built, and shipped.");
  _e24.style.color = "#8C8B88";
  _e24.style.fontSize = "1rem";
  _e24.style.marginBottom = "3rem";
  _e22.appendChild(_e24);
  const _e25 = WF.h("div", { className: "wf-spacer" });
  _e22.appendChild(_e25);
  const _e26 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e27 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e28 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e29 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/WebFluent" });
  const _e30 = WF.h("p", { className: "wf-text wf-text--bold" }, "WebFluent");
  _e30.style.fontSize = "1.2rem";
  _e30.style.color = "#E8E6E1";
  _e29.appendChild(_e30);
  _e28.appendChild(_e29);
  const _e31 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Flagship");
  _e31.style.fontFamily = "JetBrains Mono, monospace";
  _e31.style.background = "#C69C6D";
  _e31.style.color = "#1A1A19";
  _e31.style.padding = "0.25rem 0.75rem";
  _e31.style.borderRadius = "0.375rem";
  _e31.style.fontSize = "0.75rem";
  _e31.style.fontWeight = "600";
  _e28.appendChild(_e31);
  _e27.appendChild(_e28);
  const _e32 = WF.h("p", { className: "wf-text wf-text--muted" }, "A web-first programming language that compiles to HTML, CSS, JavaScript, and PDF.");
  _e32.style.color = "#8C8B88";
  _e32.style.fontSize = "0.95rem";
  _e27.appendChild(_e32);
  const _e33 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e33);
  const _e34 = WF.h("p", { className: "wf-text" }, "WebFluent replaces the traditional web stack with a single, expressive language. It features reactive state, declarative UI components, built-in routing, i18n, SSG, and PDF output — all from .wf source files. This portfolio is built entirely with WebFluent.");
  _e34.style.color = "#E8E6E1";
  _e34.style.lineHeight = "1.7";
  _e34.style.fontSize = "0.95rem";
  _e27.appendChild(_e34);
  const _e35 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e35);
  const _e36 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e37 = WF.h("p", { className: "wf-text wf-text--bold" }, "Key features:");
  _e37.style.color = "#C69C6D";
  _e37.style.fontSize = "0.9rem";
  _e37.style.fontWeight = "600";
  _e36.appendChild(_e37);
  const _e38 = WF.h("p", { className: "wf-text" }, "Reactive state & computed values with automatic UI updates");
  _e38.style.fontFamily = "JetBrains Mono, monospace";
  _e38.style.color = "#E8E6E1";
  _e38.style.fontSize = "0.85rem";
  _e36.appendChild(_e38);
  const _e39 = WF.h("p", { className: "wf-text" }, "Full component library — layout, forms, navigation, data display");
  _e39.style.fontFamily = "JetBrains Mono, monospace";
  _e39.style.color = "#E8E6E1";
  _e39.style.fontSize = "0.85rem";
  _e36.appendChild(_e39);
  const _e40 = WF.h("p", { className: "wf-text" }, "Static site generation with JS hydration");
  _e40.style.fontFamily = "JetBrains Mono, monospace";
  _e40.style.color = "#E8E6E1";
  _e40.style.fontSize = "0.85rem";
  _e36.appendChild(_e40);
  const _e41 = WF.h("p", { className: "wf-text" }, "PDF compilation with page layout, headers, footers");
  _e41.style.fontFamily = "JetBrains Mono, monospace";
  _e41.style.color = "#E8E6E1";
  _e41.style.fontSize = "0.85rem";
  _e36.appendChild(_e41);
  const _e42 = WF.h("p", { className: "wf-text" }, "Built-in i18n with automatic RTL support");
  _e42.style.fontFamily = "JetBrains Mono, monospace";
  _e42.style.color = "#E8E6E1";
  _e42.style.fontSize = "0.85rem";
  _e36.appendChild(_e42);
  _e27.appendChild(_e36);
  const _e43 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e43);
  const _e44 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e45 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e45.style.fontFamily = "JetBrains Mono, monospace";
  _e45.style.background = "#C69C6D";
  _e45.style.color = "#1A1A19";
  _e45.style.padding = "0.25rem 0.75rem";
  _e45.style.borderRadius = "0.375rem";
  _e45.style.fontSize = "0.75rem";
  _e45.style.fontWeight = "600";
  _e44.appendChild(_e45);
  const _e46 = WF.h("span", { className: "wf-badge" }, "Compiler Design");
  _e46.style.fontFamily = "JetBrains Mono, monospace";
  _e46.style.background = "#2D2C2A";
  _e46.style.color = "#E8E6E1";
  _e46.style.padding = "0.25rem 0.75rem";
  _e46.style.borderRadius = "0.375rem";
  _e46.style.fontSize = "0.75rem";
  _e44.appendChild(_e46);
  const _e47 = WF.h("span", { className: "wf-badge" }, "Language Design");
  _e47.style.fontFamily = "JetBrains Mono, monospace";
  _e47.style.background = "#2D2C2A";
  _e47.style.color = "#E8E6E1";
  _e47.style.padding = "0.25rem 0.75rem";
  _e47.style.borderRadius = "0.375rem";
  _e47.style.fontSize = "0.75rem";
  _e44.appendChild(_e47);
  const _e48 = WF.h("span", { className: "wf-badge" }, "PDF Generation");
  _e48.style.fontFamily = "JetBrains Mono, monospace";
  _e48.style.background = "#2D2C2A";
  _e48.style.color = "#E8E6E1";
  _e48.style.padding = "0.25rem 0.75rem";
  _e48.style.borderRadius = "0.375rem";
  _e48.style.fontSize = "0.75rem";
  _e44.appendChild(_e48);
  _e27.appendChild(_e44);
  _e26.appendChild(_e27);
  _e26.style.background = "#242422";
  _e26.style.border = "1px solid #C69C6D";
  _e26.style.borderRadius = "0.75rem";
  _e26.style.padding = "2rem";
  _e26.style.marginBottom = "2rem";
  _e22.appendChild(_e26);
  const _e49 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e50 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e51 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e52 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.circles.clinic/ar/" });
  const _e53 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e53.style.fontSize = "1.2rem";
  _e53.style.color = "#E8E6E1";
  _e52.appendChild(_e53);
  _e51.appendChild(_e52);
  const _e54 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Team Lead");
  _e54.style.fontFamily = "JetBrains Mono, monospace";
  _e54.style.background = "#C69C6D";
  _e54.style.color = "#1A1A19";
  _e54.style.padding = "0.25rem 0.75rem";
  _e54.style.borderRadius = "0.375rem";
  _e54.style.fontSize = "0.75rem";
  _e54.style.fontWeight = "600";
  _e51.appendChild(_e54);
  _e50.appendChild(_e51);
  const _e55 = WF.h("p", { className: "wf-text wf-text--muted" }, "A comprehensive business operating system for small and medium clinics.");
  _e55.style.color = "#8C8B88";
  _e55.style.fontSize = "0.95rem";
  _e50.appendChild(_e55);
  const _e56 = WF.h("div", { className: "wf-spacer" });
  _e50.appendChild(_e56);
  const _e57 = WF.h("p", { className: "wf-text" }, "Circles manages every aspect of clinic operations — from financials and patient scheduling to HIPAA-compliant EMR, telehealth, AI-powered diagnostics, multi-branch support, and branded patient apps. Available across MENA and Africa through local partners.");
  _e57.style.color = "#E8E6E1";
  _e57.style.lineHeight = "1.7";
  _e57.style.fontSize = "0.95rem";
  _e50.appendChild(_e57);
  const _e58 = WF.h("div", { className: "wf-spacer" });
  _e50.appendChild(_e58);
  const _e59 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e60 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e60.style.fontFamily = "JetBrains Mono, monospace";
  _e60.style.background = "#2D2C2A";
  _e60.style.color = "#E8E6E1";
  _e60.style.padding = "0.25rem 0.75rem";
  _e60.style.borderRadius = "0.375rem";
  _e60.style.fontSize = "0.75rem";
  _e59.appendChild(_e60);
  const _e61 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e61.style.fontFamily = "JetBrains Mono, monospace";
  _e61.style.background = "#2D2C2A";
  _e61.style.color = "#E8E6E1";
  _e61.style.padding = "0.25rem 0.75rem";
  _e61.style.borderRadius = "0.375rem";
  _e61.style.fontSize = "0.75rem";
  _e59.appendChild(_e61);
  const _e62 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e62.style.fontFamily = "JetBrains Mono, monospace";
  _e62.style.background = "#2D2C2A";
  _e62.style.color = "#E8E6E1";
  _e62.style.padding = "0.25rem 0.75rem";
  _e62.style.borderRadius = "0.375rem";
  _e62.style.fontSize = "0.75rem";
  _e59.appendChild(_e62);
  const _e63 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e63.style.fontFamily = "JetBrains Mono, monospace";
  _e63.style.background = "#2D2C2A";
  _e63.style.color = "#E8E6E1";
  _e63.style.padding = "0.25rem 0.75rem";
  _e63.style.borderRadius = "0.375rem";
  _e63.style.fontSize = "0.75rem";
  _e59.appendChild(_e63);
  _e50.appendChild(_e59);
  _e49.appendChild(_e50);
  _e49.style.background = "#242422";
  _e49.style.border = "1px solid #2D2C2A";
  _e49.style.borderRadius = "0.75rem";
  _e49.style.padding = "2rem";
  _e49.style.marginBottom = "2rem";
  _e22.appendChild(_e49);
  const _e64 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e65 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e66 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e67 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://platform.alhakeem.app/" });
  const _e68 = WF.h("p", { className: "wf-text wf-text--bold" }, "Al-Hakeem");
  _e68.style.fontSize = "1.2rem";
  _e68.style.color = "#E8E6E1";
  _e67.appendChild(_e68);
  _e66.appendChild(_e67);
  const _e69 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Engineering Lead");
  _e69.style.fontFamily = "JetBrains Mono, monospace";
  _e69.style.background = "#C69C6D";
  _e69.style.color = "#1A1A19";
  _e69.style.padding = "0.25rem 0.75rem";
  _e69.style.borderRadius = "0.375rem";
  _e69.style.fontSize = "0.75rem";
  _e69.style.fontWeight = "600";
  _e66.appendChild(_e69);
  _e65.appendChild(_e66);
  const _e70 = WF.h("p", { className: "wf-text wf-text--muted" }, "A healthcare platform connecting physicians with medical services.");
  _e70.style.color = "#8C8B88";
  _e70.style.fontSize = "0.95rem";
  _e65.appendChild(_e70);
  const _e71 = WF.h("div", { className: "wf-spacer" });
  _e65.appendChild(_e71);
  const _e72 = WF.h("p", { className: "wf-text" }, "Al-Hakeem streamlines physician onboarding and medical service delivery. The platform supports bilingual operation in Arabic and English, serving healthcare professionals across the region with credential management and service coordination.");
  _e72.style.color = "#E8E6E1";
  _e72.style.lineHeight = "1.7";
  _e72.style.fontSize = "0.95rem";
  _e65.appendChild(_e72);
  const _e73 = WF.h("div", { className: "wf-spacer" });
  _e65.appendChild(_e73);
  const _e74 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e75 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e75.style.fontFamily = "JetBrains Mono, monospace";
  _e75.style.background = "#2D2C2A";
  _e75.style.color = "#E8E6E1";
  _e75.style.padding = "0.25rem 0.75rem";
  _e75.style.borderRadius = "0.375rem";
  _e75.style.fontSize = "0.75rem";
  _e74.appendChild(_e75);
  const _e76 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e76.style.fontFamily = "JetBrains Mono, monospace";
  _e76.style.background = "#2D2C2A";
  _e76.style.color = "#E8E6E1";
  _e76.style.padding = "0.25rem 0.75rem";
  _e76.style.borderRadius = "0.375rem";
  _e76.style.fontSize = "0.75rem";
  _e74.appendChild(_e76);
  const _e77 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e77.style.fontFamily = "JetBrains Mono, monospace";
  _e77.style.background = "#2D2C2A";
  _e77.style.color = "#E8E6E1";
  _e77.style.padding = "0.25rem 0.75rem";
  _e77.style.borderRadius = "0.375rem";
  _e77.style.fontSize = "0.75rem";
  _e74.appendChild(_e77);
  _e65.appendChild(_e74);
  _e64.appendChild(_e65);
  _e64.style.background = "#242422";
  _e64.style.border = "1px solid #2D2C2A";
  _e64.style.borderRadius = "0.75rem";
  _e64.style.padding = "2rem";
  _e64.style.marginBottom = "2rem";
  _e22.appendChild(_e64);
  const _e78 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e79 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e80 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e81 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://dabdoob.com/" });
  const _e82 = WF.h("p", { className: "wf-text wf-text--bold" }, "Dabdoob");
  _e82.style.fontSize = "1.2rem";
  _e82.style.color = "#E8E6E1";
  _e81.appendChild(_e82);
  _e80.appendChild(_e81);
  const _e83 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Featured");
  _e83.style.fontFamily = "JetBrains Mono, monospace";
  _e83.style.background = "#C69C6D";
  _e83.style.color = "#1A1A19";
  _e83.style.padding = "0.25rem 0.75rem";
  _e83.style.borderRadius = "0.375rem";
  _e83.style.fontSize = "0.75rem";
  _e83.style.fontWeight = "600";
  _e80.appendChild(_e83);
  _e79.appendChild(_e80);
  const _e84 = WF.h("p", { className: "wf-text wf-text--muted" }, "A mobile-first e-commerce platform serving the Middle East.");
  _e84.style.color = "#8C8B88";
  _e84.style.fontSize = "0.95rem";
  _e79.appendChild(_e84);
  const _e85 = WF.h("div", { className: "wf-spacer" });
  _e79.appendChild(_e85);
  const _e86 = WF.h("p", { className: "wf-text" }, "Dabdoob is a cross-platform shopping application available on iOS and Android, operating across Kuwait, Saudi Arabia, UAE, Qatar, and Bahrain. The platform delivers exclusive deals and a seamless mobile shopping experience across the GCC region.");
  _e86.style.color = "#E8E6E1";
  _e86.style.lineHeight = "1.7";
  _e86.style.fontSize = "0.95rem";
  _e79.appendChild(_e86);
  const _e87 = WF.h("div", { className: "wf-spacer" });
  _e79.appendChild(_e87);
  const _e88 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e89 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e89.style.fontFamily = "JetBrains Mono, monospace";
  _e89.style.background = "#2D2C2A";
  _e89.style.color = "#E8E6E1";
  _e89.style.padding = "0.25rem 0.75rem";
  _e89.style.borderRadius = "0.375rem";
  _e89.style.fontSize = "0.75rem";
  _e88.appendChild(_e89);
  const _e90 = WF.h("span", { className: "wf-badge" }, "E-Commerce");
  _e90.style.fontFamily = "JetBrains Mono, monospace";
  _e90.style.background = "#2D2C2A";
  _e90.style.color = "#E8E6E1";
  _e90.style.padding = "0.25rem 0.75rem";
  _e90.style.borderRadius = "0.375rem";
  _e90.style.fontSize = "0.75rem";
  _e88.appendChild(_e90);
  const _e91 = WF.h("span", { className: "wf-badge" }, "Mobile");
  _e91.style.fontFamily = "JetBrains Mono, monospace";
  _e91.style.background = "#2D2C2A";
  _e91.style.color = "#E8E6E1";
  _e91.style.padding = "0.25rem 0.75rem";
  _e91.style.borderRadius = "0.375rem";
  _e91.style.fontSize = "0.75rem";
  _e88.appendChild(_e91);
  _e79.appendChild(_e88);
  _e78.appendChild(_e79);
  _e78.style.background = "#242422";
  _e78.style.border = "1px solid #2D2C2A";
  _e78.style.borderRadius = "0.75rem";
  _e78.style.padding = "2rem";
  _e78.style.marginBottom = "2rem";
  _e22.appendChild(_e78);
  const _e92 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e93 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e94 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e95 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/sys-voice-daemon" });
  const _e96 = WF.h("p", { className: "wf-text wf-text--bold" }, "sys-voice-daemon");
  _e96.style.fontSize = "1.2rem";
  _e96.style.color = "#E8E6E1";
  _e95.appendChild(_e96);
  _e94.appendChild(_e95);
  const _e97 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e97.style.fontFamily = "JetBrains Mono, monospace";
  _e97.style.background = "#2D2C2A";
  _e97.style.color = "#E8E6E1";
  _e97.style.padding = "0.25rem 0.75rem";
  _e97.style.borderRadius = "0.375rem";
  _e97.style.fontSize = "0.75rem";
  _e94.appendChild(_e97);
  _e93.appendChild(_e94);
  const _e98 = WF.h("p", { className: "wf-text wf-text--muted" }, "Privacy-first, offline voice-to-text daemon for Linux.");
  _e98.style.color = "#8C8B88";
  _e98.style.fontSize = "0.95rem";
  _e93.appendChild(_e98);
  const _e99 = WF.h("div", { className: "wf-spacer" });
  _e93.appendChild(_e99);
  const _e100 = WF.h("p", { className: "wf-text" }, "A system-level daemon that automatically detects active text fields and injects transcriptions into any window. Uses a kernel-level virtual keyboard via uinput for seamless, privacy-respecting voice input — entirely offline with no cloud dependency.");
  _e100.style.color = "#E8E6E1";
  _e100.style.lineHeight = "1.7";
  _e100.style.fontSize = "0.95rem";
  _e93.appendChild(_e100);
  const _e101 = WF.h("div", { className: "wf-spacer" });
  _e93.appendChild(_e101);
  const _e102 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e103 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e103.style.fontFamily = "JetBrains Mono, monospace";
  _e103.style.background = "#C69C6D";
  _e103.style.color = "#1A1A19";
  _e103.style.padding = "0.25rem 0.75rem";
  _e103.style.borderRadius = "0.375rem";
  _e103.style.fontSize = "0.75rem";
  _e103.style.fontWeight = "600";
  _e102.appendChild(_e103);
  const _e104 = WF.h("span", { className: "wf-badge" }, "Linux");
  _e104.style.fontFamily = "JetBrains Mono, monospace";
  _e104.style.background = "#2D2C2A";
  _e104.style.color = "#E8E6E1";
  _e104.style.padding = "0.25rem 0.75rem";
  _e104.style.borderRadius = "0.375rem";
  _e104.style.fontSize = "0.75rem";
  _e102.appendChild(_e104);
  const _e105 = WF.h("span", { className: "wf-badge" }, "uinput");
  _e105.style.fontFamily = "JetBrains Mono, monospace";
  _e105.style.background = "#2D2C2A";
  _e105.style.color = "#E8E6E1";
  _e105.style.padding = "0.25rem 0.75rem";
  _e105.style.borderRadius = "0.375rem";
  _e105.style.fontSize = "0.75rem";
  _e102.appendChild(_e105);
  const _e106 = WF.h("span", { className: "wf-badge" }, "Systems");
  _e106.style.fontFamily = "JetBrains Mono, monospace";
  _e106.style.background = "#2D2C2A";
  _e106.style.color = "#E8E6E1";
  _e106.style.padding = "0.25rem 0.75rem";
  _e106.style.borderRadius = "0.375rem";
  _e106.style.fontSize = "0.75rem";
  _e102.appendChild(_e106);
  _e93.appendChild(_e102);
  _e92.appendChild(_e93);
  _e92.style.background = "#242422";
  _e92.style.border = "1px solid #2D2C2A";
  _e92.style.borderRadius = "0.75rem";
  _e92.style.padding = "2rem";
  _e92.style.marginBottom = "2rem";
  _e22.appendChild(_e92);
  const _e107 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e108 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e109 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e110 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/rubik-cube-trainer" });
  const _e111 = WF.h("p", { className: "wf-text wf-text--bold" }, "rubiks-trainer");
  _e111.style.fontSize = "1.2rem";
  _e111.style.color = "#E8E6E1";
  _e110.appendChild(_e111);
  _e109.appendChild(_e110);
  const _e112 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e112.style.fontFamily = "JetBrains Mono, monospace";
  _e112.style.background = "#2D2C2A";
  _e112.style.color = "#E8E6E1";
  _e112.style.padding = "0.25rem 0.75rem";
  _e112.style.borderRadius = "0.375rem";
  _e112.style.fontSize = "0.75rem";
  _e109.appendChild(_e112);
  _e108.appendChild(_e109);
  const _e113 = WF.h("p", { className: "wf-text wf-text--muted" }, "A virtual 3D Rubik's cube game and speedcubing trainer built in Rust.");
  _e113.style.color = "#8C8B88";
  _e113.style.fontSize = "0.95rem";
  _e108.appendChild(_e113);
  const _e114 = WF.h("div", { className: "wf-spacer" });
  _e108.appendChild(_e114);
  const _e115 = WF.h("p", { className: "wf-text" }, "Supports 2×2, 3×3, 4×4, and 5×5 cubes with custom-built solvers written from scratch — no external solver crates. Features a progressive learning track from beginner LBL through advanced CFOP, plus a daily-use timer and drill mode designed for speedcubers.");
  _e115.style.color = "#E8E6E1";
  _e115.style.lineHeight = "1.7";
  _e115.style.fontSize = "0.95rem";
  _e108.appendChild(_e115);
  const _e116 = WF.h("div", { className: "wf-spacer" });
  _e108.appendChild(_e116);
  const _e117 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e118 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e118.style.fontFamily = "JetBrains Mono, monospace";
  _e118.style.background = "#C69C6D";
  _e118.style.color = "#1A1A19";
  _e118.style.padding = "0.25rem 0.75rem";
  _e118.style.borderRadius = "0.375rem";
  _e118.style.fontSize = "0.75rem";
  _e118.style.fontWeight = "600";
  _e117.appendChild(_e118);
  const _e119 = WF.h("span", { className: "wf-badge" }, "Bevy");
  _e119.style.fontFamily = "JetBrains Mono, monospace";
  _e119.style.background = "#2D2C2A";
  _e119.style.color = "#E8E6E1";
  _e119.style.padding = "0.25rem 0.75rem";
  _e119.style.borderRadius = "0.375rem";
  _e119.style.fontSize = "0.75rem";
  _e117.appendChild(_e119);
  const _e120 = WF.h("span", { className: "wf-badge" }, "3D Graphics");
  _e120.style.fontFamily = "JetBrains Mono, monospace";
  _e120.style.background = "#2D2C2A";
  _e120.style.color = "#E8E6E1";
  _e120.style.padding = "0.25rem 0.75rem";
  _e120.style.borderRadius = "0.375rem";
  _e120.style.fontSize = "0.75rem";
  _e117.appendChild(_e120);
  const _e121 = WF.h("span", { className: "wf-badge" }, "Algorithms");
  _e121.style.fontFamily = "JetBrains Mono, monospace";
  _e121.style.background = "#2D2C2A";
  _e121.style.color = "#E8E6E1";
  _e121.style.padding = "0.25rem 0.75rem";
  _e121.style.borderRadius = "0.375rem";
  _e121.style.fontSize = "0.75rem";
  _e117.appendChild(_e121);
  _e108.appendChild(_e117);
  _e107.appendChild(_e108);
  _e107.style.background = "#242422";
  _e107.style.border = "1px solid #C69C6D";
  _e107.style.borderRadius = "0.75rem";
  _e107.style.padding = "2rem";
  _e107.style.marginBottom = "2rem";
  _e22.appendChild(_e107);
  const _e122 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e123 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e124 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e125 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/oxide-explorer" });
  const _e126 = WF.h("p", { className: "wf-text wf-text--bold" }, "Oxide Explorer");
  _e126.style.fontSize = "1.2rem";
  _e126.style.color = "#E8E6E1";
  _e125.appendChild(_e126);
  _e124.appendChild(_e125);
  const _e127 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e127.style.fontFamily = "JetBrains Mono, monospace";
  _e127.style.background = "#2D2C2A";
  _e127.style.color = "#E8E6E1";
  _e127.style.padding = "0.25rem 0.75rem";
  _e127.style.borderRadius = "0.375rem";
  _e127.style.fontSize = "0.75rem";
  _e124.appendChild(_e127);
  _e123.appendChild(_e124);
  const _e128 = WF.h("p", { className: "wf-text wf-text--muted" }, "A blazing-fast, power-user-centric file manager built with Rust, GTK4, and libadwaita.");
  _e128.style.color = "#8C8B88";
  _e128.style.fontSize = "0.95rem";
  _e123.appendChild(_e128);
  const _e129 = WF.h("div", { className: "wf-spacer" });
  _e123.appendChild(_e129);
  const _e130 = WF.h("p", { className: "wf-text" }, "Combines the visual elegance of GNOME Files with the advanced productivity features of Directory Opus and Total Commander. Designed for developers and power users who need dual-pane browsing, batch operations, and keyboard-driven workflows in a native Linux environment.");
  _e130.style.color = "#E8E6E1";
  _e130.style.lineHeight = "1.7";
  _e130.style.fontSize = "0.95rem";
  _e123.appendChild(_e130);
  const _e131 = WF.h("div", { className: "wf-spacer" });
  _e123.appendChild(_e131);
  const _e132 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e133 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e133.style.fontFamily = "JetBrains Mono, monospace";
  _e133.style.background = "#C69C6D";
  _e133.style.color = "#1A1A19";
  _e133.style.padding = "0.25rem 0.75rem";
  _e133.style.borderRadius = "0.375rem";
  _e133.style.fontSize = "0.75rem";
  _e133.style.fontWeight = "600";
  _e132.appendChild(_e133);
  const _e134 = WF.h("span", { className: "wf-badge" }, "GTK4");
  _e134.style.fontFamily = "JetBrains Mono, monospace";
  _e134.style.background = "#2D2C2A";
  _e134.style.color = "#E8E6E1";
  _e134.style.padding = "0.25rem 0.75rem";
  _e134.style.borderRadius = "0.375rem";
  _e134.style.fontSize = "0.75rem";
  _e132.appendChild(_e134);
  const _e135 = WF.h("span", { className: "wf-badge" }, "libadwaita");
  _e135.style.fontFamily = "JetBrains Mono, monospace";
  _e135.style.background = "#2D2C2A";
  _e135.style.color = "#E8E6E1";
  _e135.style.padding = "0.25rem 0.75rem";
  _e135.style.borderRadius = "0.375rem";
  _e135.style.fontSize = "0.75rem";
  _e132.appendChild(_e135);
  const _e136 = WF.h("span", { className: "wf-badge" }, "Linux Desktop");
  _e136.style.fontFamily = "JetBrains Mono, monospace";
  _e136.style.background = "#2D2C2A";
  _e136.style.color = "#E8E6E1";
  _e136.style.padding = "0.25rem 0.75rem";
  _e136.style.borderRadius = "0.375rem";
  _e136.style.fontSize = "0.75rem";
  _e132.appendChild(_e136);
  _e123.appendChild(_e132);
  _e122.appendChild(_e123);
  _e122.style.background = "#242422";
  _e122.style.border = "1px solid #C69C6D";
  _e122.style.borderRadius = "0.75rem";
  _e122.style.padding = "2rem";
  _e122.style.marginBottom = "2rem";
  _e22.appendChild(_e122);
  const _e137 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e138 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e139 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e140 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/rust-mobile/xbuild" });
  const _e141 = WF.h("p", { className: "wf-text wf-text--bold" }, "xbuild");
  _e141.style.fontSize = "1.2rem";
  _e141.style.color = "#E8E6E1";
  _e140.appendChild(_e141);
  _e139.appendChild(_e140);
  const _e142 = WF.h("span", { className: "wf-badge" }, "Contribution");
  _e142.style.fontFamily = "JetBrains Mono, monospace";
  _e142.style.background = "#2D2C2A";
  _e142.style.color = "#E8E6E1";
  _e142.style.padding = "0.25rem 0.75rem";
  _e142.style.borderRadius = "0.375rem";
  _e142.style.fontSize = "0.75rem";
  _e139.appendChild(_e142);
  _e138.appendChild(_e139);
  const _e143 = WF.h("p", { className: "wf-text wf-text--muted" }, "A build tool for Rust projects with cross-compilation and publishing to all major app stores.");
  _e143.style.color = "#8C8B88";
  _e143.style.fontSize = "0.95rem";
  _e138.appendChild(_e143);
  const _e144 = WF.h("div", { className: "wf-spacer" });
  _e138.appendChild(_e144);
  const _e145 = WF.h("p", { className: "wf-text" }, "Contributed ARM 32-bit target support to xbuild, expanding the tool's cross-compilation reach to legacy and embedded ARM devices. xbuild aims to make native app development as easy as web development — build once, publish everywhere.");
  _e145.style.color = "#E8E6E1";
  _e145.style.lineHeight = "1.7";
  _e145.style.fontSize = "0.95rem";
  _e138.appendChild(_e145);
  const _e146 = WF.h("div", { className: "wf-spacer" });
  _e138.appendChild(_e146);
  const _e147 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e148 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e148.style.fontFamily = "JetBrains Mono, monospace";
  _e148.style.background = "#C69C6D";
  _e148.style.color = "#1A1A19";
  _e148.style.padding = "0.25rem 0.75rem";
  _e148.style.borderRadius = "0.375rem";
  _e148.style.fontSize = "0.75rem";
  _e148.style.fontWeight = "600";
  _e147.appendChild(_e148);
  const _e149 = WF.h("span", { className: "wf-badge" }, "Cross-Compilation");
  _e149.style.fontFamily = "JetBrains Mono, monospace";
  _e149.style.background = "#2D2C2A";
  _e149.style.color = "#E8E6E1";
  _e149.style.padding = "0.25rem 0.75rem";
  _e149.style.borderRadius = "0.375rem";
  _e149.style.fontSize = "0.75rem";
  _e147.appendChild(_e149);
  const _e150 = WF.h("span", { className: "wf-badge" }, "ARM");
  _e150.style.fontFamily = "JetBrains Mono, monospace";
  _e150.style.background = "#2D2C2A";
  _e150.style.color = "#E8E6E1";
  _e150.style.padding = "0.25rem 0.75rem";
  _e150.style.borderRadius = "0.375rem";
  _e150.style.fontSize = "0.75rem";
  _e147.appendChild(_e150);
  const _e151 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e151.style.fontFamily = "JetBrains Mono, monospace";
  _e151.style.background = "#2D2C2A";
  _e151.style.color = "#E8E6E1";
  _e151.style.padding = "0.25rem 0.75rem";
  _e151.style.borderRadius = "0.375rem";
  _e151.style.fontSize = "0.75rem";
  _e147.appendChild(_e151);
  _e138.appendChild(_e147);
  _e137.appendChild(_e138);
  _e137.style.background = "#242422";
  _e137.style.border = "1px solid #2D2C2A";
  _e137.style.borderRadius = "0.75rem";
  _e137.style.padding = "2rem";
  _e137.style.marginBottom = "2rem";
  _e22.appendChild(_e137);
  const _e152 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e153 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e154 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e155 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/micro-kernel-backend" });
  const _e156 = WF.h("p", { className: "wf-text wf-text--bold" }, "Micro-kernel Architecture");
  _e156.style.fontSize = "1.2rem";
  _e156.style.color = "#E8E6E1";
  _e155.appendChild(_e156);
  _e154.appendChild(_e155);
  const _e157 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Tech Talk");
  _e157.style.fontFamily = "JetBrains Mono, monospace";
  _e157.style.background = "#C69C6D";
  _e157.style.color = "#1A1A19";
  _e157.style.padding = "0.25rem 0.75rem";
  _e157.style.borderRadius = "0.375rem";
  _e157.style.fontSize = "0.75rem";
  _e157.style.fontWeight = "600";
  _e154.appendChild(_e157);
  _e153.appendChild(_e154);
  const _e158 = WF.h("p", { className: "wf-text wf-text--muted" }, "A micro-kernel web backend where business logic lives in dynamically-loaded WebAssembly modules.");
  _e158.style.color = "#8C8B88";
  _e158.style.fontSize = "0.95rem";
  _e153.appendChild(_e158);
  const _e159 = WF.h("div", { className: "wf-spacer" });
  _e153.appendChild(_e159);
  const _e160 = WF.h("p", { className: "wf-text" }, "The server core is intentionally minimal — routing, auth, and module lifecycle. All business logic runs in sandboxed WebAssembly modules that can be deployed, hot-swapped, rolled back, call external services, and call each other via an internal IPC layer. A demo of how micro-kernel principles apply to backend architecture.");
  _e160.style.color = "#E8E6E1";
  _e160.style.lineHeight = "1.7";
  _e160.style.fontSize = "0.95rem";
  _e153.appendChild(_e160);
  const _e161 = WF.h("div", { className: "wf-spacer" });
  _e153.appendChild(_e161);
  const _e162 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e163 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e163.style.fontFamily = "JetBrains Mono, monospace";
  _e163.style.background = "#C69C6D";
  _e163.style.color = "#1A1A19";
  _e163.style.padding = "0.25rem 0.75rem";
  _e163.style.borderRadius = "0.375rem";
  _e163.style.fontSize = "0.75rem";
  _e163.style.fontWeight = "600";
  _e162.appendChild(_e163);
  const _e164 = WF.h("span", { className: "wf-badge" }, "WebAssembly");
  _e164.style.fontFamily = "JetBrains Mono, monospace";
  _e164.style.background = "#2D2C2A";
  _e164.style.color = "#E8E6E1";
  _e164.style.padding = "0.25rem 0.75rem";
  _e164.style.borderRadius = "0.375rem";
  _e164.style.fontSize = "0.75rem";
  _e162.appendChild(_e164);
  const _e165 = WF.h("span", { className: "wf-badge" }, "Systems Design");
  _e165.style.fontFamily = "JetBrains Mono, monospace";
  _e165.style.background = "#2D2C2A";
  _e165.style.color = "#E8E6E1";
  _e165.style.padding = "0.25rem 0.75rem";
  _e165.style.borderRadius = "0.375rem";
  _e165.style.fontSize = "0.75rem";
  _e162.appendChild(_e165);
  const _e166 = WF.h("span", { className: "wf-badge" }, "Architecture");
  _e166.style.fontFamily = "JetBrains Mono, monospace";
  _e166.style.background = "#2D2C2A";
  _e166.style.color = "#E8E6E1";
  _e166.style.padding = "0.25rem 0.75rem";
  _e166.style.borderRadius = "0.375rem";
  _e166.style.fontSize = "0.75rem";
  _e162.appendChild(_e166);
  _e153.appendChild(_e162);
  _e152.appendChild(_e153);
  _e152.style.background = "#242422";
  _e152.style.border = "1px solid #C69C6D";
  _e152.style.borderRadius = "0.75rem";
  _e152.style.padding = "2rem";
  _e152.style.marginBottom = "2rem";
  _e22.appendChild(_e152);
  _e21.appendChild(_e22);
  _e21.style.maxWidth = "800px";
  _e21.style.margin = "0 auto";
  _e21.style.padding = "80px 2rem";
  _e21.classList.add("wf-s167");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s167 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s167 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e21);
  return _root;
}

function Page_Experience(params) {
  const _root = document.createDocumentFragment();
  const _e168 = WF.h("div", { className: "wf-container" });
  const _e169 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e170 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Experience");
  _e170.style.fontSize = "2rem";
  _e170.style.fontWeight = "700";
  _e170.style.color = "#E8E6E1";
  _e170.style.letterSpacing = "-0.02em";
  _e170.style.marginBottom = "1rem";
  _e169.appendChild(_e170);
  const _e171 = WF.h("p", { className: "wf-text wf-text--muted" }, "A reverse-chronological record of roles, responsibilities, and impact.");
  _e171.style.color = "#8C8B88";
  _e171.style.fontSize = "1rem";
  _e171.style.marginBottom = "3rem";
  _e169.appendChild(_e171);
  const _e172 = WF.h("div", { className: "wf-spacer" });
  _e169.appendChild(_e172);
  const _e173 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e174 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e175 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e176 = WF.h("p", { className: "wf-text wf-text--bold" }, "SilverKey Technologies");
  _e176.style.fontSize = "1.2rem";
  _e176.style.color = "#E8E6E1";
  _e175.appendChild(_e176);
  const _e177 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Mar 2025 — Present");
  _e177.style.color = "#C69C6D";
  _e177.style.fontFamily = "JetBrains Mono, monospace";
  _e177.style.fontSize = "0.8rem";
  _e175.appendChild(_e177);
  _e174.appendChild(_e175);
  const _e178 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Node.js Developer");
  _e178.style.color = "#8C8B88";
  _e178.style.fontSize = "0.95rem";
  _e174.appendChild(_e178);
  const _e179 = WF.h("div", { className: "wf-spacer" });
  _e174.appendChild(_e179);
  const _e180 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e181 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained core backend functionality to improve reliability and performance across web and mobile platforms.");
  _e181.style.color = "#E8E6E1";
  _e181.style.lineHeight = "1.7";
  _e181.style.fontSize = "0.95rem";
  _e180.appendChild(_e181);
  const _e182 = WF.h("p", { className: "wf-text" }, "Integrated Firebase Analytics, Adjust, and MoEngage to enable data-driven marketing and user engagement strategies.");
  _e182.style.color = "#E8E6E1";
  _e182.style.lineHeight = "1.7";
  _e182.style.fontSize = "0.95rem";
  _e180.appendChild(_e182);
  const _e183 = WF.h("p", { className: "wf-text" }, "Optimized product view endpoints and resolved crawler-related issues to enhance SEO and product discoverability.");
  _e183.style.color = "#E8E6E1";
  _e183.style.lineHeight = "1.7";
  _e183.style.fontSize = "0.95rem";
  _e180.appendChild(_e183);
  const _e184 = WF.h("p", { className: "wf-text" }, "Built a high-performance image processing microservice using Rust, achieving an average performance increase of over 98%.");
  _e184.style.color = "#E8E6E1";
  _e184.style.lineHeight = "1.7";
  _e184.style.fontSize = "0.95rem";
  _e180.appendChild(_e184);
  const _e185 = WF.h("p", { className: "wf-text" }, "Migrated the codebase to TypeScript, improving code maintainability, type safety, and long-term scalability.");
  _e185.style.color = "#E8E6E1";
  _e185.style.lineHeight = "1.7";
  _e185.style.fontSize = "0.95rem";
  _e180.appendChild(_e185);
  const _e186 = WF.h("p", { className: "wf-text" }, "Improved internal documentation and tooling, streamlining onboarding and enhancing cross-team collaboration.");
  _e186.style.color = "#E8E6E1";
  _e186.style.lineHeight = "1.7";
  _e186.style.fontSize = "0.95rem";
  _e180.appendChild(_e186);
  const _e187 = WF.h("p", { className: "wf-text" }, "Improved platform performance by optimizing queries and system design.");
  _e187.style.color = "#E8E6E1";
  _e187.style.lineHeight = "1.7";
  _e187.style.fontSize = "0.95rem";
  _e180.appendChild(_e187);
  _e174.appendChild(_e180);
  const _e188 = WF.h("div", { className: "wf-spacer" });
  _e174.appendChild(_e188);
  const _e189 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e190 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e190.style.fontFamily = "JetBrains Mono, monospace";
  _e190.style.background = "#C69C6D";
  _e190.style.color = "#1A1A19";
  _e190.style.padding = "0.25rem 0.75rem";
  _e190.style.borderRadius = "0.375rem";
  _e190.style.fontSize = "0.75rem";
  _e190.style.fontWeight = "600";
  _e189.appendChild(_e190);
  const _e191 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e191.style.fontFamily = "JetBrains Mono, monospace";
  _e191.style.background = "#2D2C2A";
  _e191.style.color = "#E8E6E1";
  _e191.style.padding = "0.25rem 0.75rem";
  _e191.style.borderRadius = "0.375rem";
  _e191.style.fontSize = "0.75rem";
  _e189.appendChild(_e191);
  const _e192 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e192.style.fontFamily = "JetBrains Mono, monospace";
  _e192.style.background = "#2D2C2A";
  _e192.style.color = "#E8E6E1";
  _e192.style.padding = "0.25rem 0.75rem";
  _e192.style.borderRadius = "0.375rem";
  _e192.style.fontSize = "0.75rem";
  _e189.appendChild(_e192);
  const _e193 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e193.style.fontFamily = "JetBrains Mono, monospace";
  _e193.style.background = "#2D2C2A";
  _e193.style.color = "#E8E6E1";
  _e193.style.padding = "0.25rem 0.75rem";
  _e193.style.borderRadius = "0.375rem";
  _e193.style.fontSize = "0.75rem";
  _e189.appendChild(_e193);
  _e174.appendChild(_e189);
  _e173.appendChild(_e174);
  _e173.style.background = "#242422";
  _e173.style.border = "1px solid #2D2C2A";
  _e173.style.borderRadius = "0.75rem";
  _e173.style.padding = "2rem";
  _e173.style.marginBottom = "2rem";
  _e169.appendChild(_e173);
  const _e194 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e195 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e196 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e197 = WF.h("p", { className: "wf-text wf-text--bold" }, "Ecom Payments");
  _e197.style.fontSize = "1.2rem";
  _e197.style.color = "#E8E6E1";
  _e196.appendChild(_e197);
  const _e198 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Aug 2024 — Feb 2025");
  _e198.style.color = "#C69C6D";
  _e198.style.fontFamily = "JetBrains Mono, monospace";
  _e198.style.fontSize = "0.8rem";
  _e196.appendChild(_e198);
  _e195.appendChild(_e196);
  const _e199 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e199.style.color = "#8C8B88";
  _e199.style.fontSize = "0.95rem";
  _e195.appendChild(_e199);
  const _e200 = WF.h("div", { className: "wf-spacer" });
  _e195.appendChild(_e200);
  const _e201 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e202 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained high-performance, scalable microservices using NestJS, enabling seamless integration with front-end systems and third-party APIs.");
  _e202.style.color = "#E8E6E1";
  _e202.style.lineHeight = "1.7";
  _e202.style.fontSize = "0.95rem";
  _e201.appendChild(_e202);
  const _e203 = WF.h("p", { className: "wf-text" }, "Built and managed microservices for document generation, file storage, and file uploads, implementing AES encryption to ensure data security and compliance.");
  _e203.style.color = "#E8E6E1";
  _e203.style.lineHeight = "1.7";
  _e203.style.fontSize = "0.95rem";
  _e201.appendChild(_e203);
  const _e204 = WF.h("p", { className: "wf-text" }, "Developed a merchant management microservice to handle critical merchant data, including bank details, user information, payment methods, and fee structures.");
  _e204.style.color = "#E8E6E1";
  _e204.style.lineHeight = "1.7";
  _e204.style.fontSize = "0.95rem";
  _e201.appendChild(_e204);
  const _e205 = WF.h("p", { className: "wf-text" }, "Created a statistics microservice to calculate and analyze key metrics, providing actionable insights for business decision-making.");
  _e205.style.color = "#E8E6E1";
  _e205.style.lineHeight = "1.7";
  _e205.style.fontSize = "0.95rem";
  _e201.appendChild(_e205);
  const _e206 = WF.h("p", { className: "wf-text" }, "Utilized RabbitMQ for efficient message queuing and Docker for containerization, streamlining deployment processes and improving system reliability.");
  _e206.style.color = "#E8E6E1";
  _e206.style.lineHeight = "1.7";
  _e206.style.fontSize = "0.95rem";
  _e201.appendChild(_e206);
  _e195.appendChild(_e201);
  const _e207 = WF.h("div", { className: "wf-spacer" });
  _e195.appendChild(_e207);
  const _e208 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e209 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e209.style.fontFamily = "JetBrains Mono, monospace";
  _e209.style.background = "#2D2C2A";
  _e209.style.color = "#E8E6E1";
  _e209.style.padding = "0.25rem 0.75rem";
  _e209.style.borderRadius = "0.375rem";
  _e209.style.fontSize = "0.75rem";
  _e208.appendChild(_e209);
  const _e210 = WF.h("span", { className: "wf-badge" }, "RabbitMQ");
  _e210.style.fontFamily = "JetBrains Mono, monospace";
  _e210.style.background = "#2D2C2A";
  _e210.style.color = "#E8E6E1";
  _e210.style.padding = "0.25rem 0.75rem";
  _e210.style.borderRadius = "0.375rem";
  _e210.style.fontSize = "0.75rem";
  _e208.appendChild(_e210);
  const _e211 = WF.h("span", { className: "wf-badge" }, "Docker");
  _e211.style.fontFamily = "JetBrains Mono, monospace";
  _e211.style.background = "#2D2C2A";
  _e211.style.color = "#E8E6E1";
  _e211.style.padding = "0.25rem 0.75rem";
  _e211.style.borderRadius = "0.375rem";
  _e211.style.fontSize = "0.75rem";
  _e208.appendChild(_e211);
  const _e212 = WF.h("span", { className: "wf-badge" }, "AES");
  _e212.style.fontFamily = "JetBrains Mono, monospace";
  _e212.style.background = "#2D2C2A";
  _e212.style.color = "#E8E6E1";
  _e212.style.padding = "0.25rem 0.75rem";
  _e212.style.borderRadius = "0.375rem";
  _e212.style.fontSize = "0.75rem";
  _e208.appendChild(_e212);
  _e195.appendChild(_e208);
  _e194.appendChild(_e195);
  _e194.style.background = "#242422";
  _e194.style.border = "1px solid #2D2C2A";
  _e194.style.borderRadius = "0.75rem";
  _e194.style.padding = "2rem";
  _e194.style.marginBottom = "2rem";
  _e169.appendChild(_e194);
  const _e213 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e214 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e215 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e216 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e216.style.fontSize = "1.2rem";
  _e216.style.color = "#E8E6E1";
  _e215.appendChild(_e216);
  const _e217 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Dec 2022 — Jan 2024");
  _e217.style.color = "#C69C6D";
  _e217.style.fontFamily = "JetBrains Mono, monospace";
  _e217.style.fontSize = "0.8rem";
  _e215.appendChild(_e217);
  _e214.appendChild(_e215);
  const _e218 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e218.style.color = "#8C8B88";
  _e218.style.fontSize = "0.95rem";
  _e214.appendChild(_e218);
  const _e219 = WF.h("div", { className: "wf-spacer" });
  _e214.appendChild(_e219);
  const _e220 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e221 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained a highly scalable Healthcare Management System (HMS) using a microservices architecture, leveraging GraphQL for optimized data fetching and Kafka for real-time data streaming and event-driven communication.");
  _e221.style.color = "#E8E6E1";
  _e221.style.lineHeight = "1.7";
  _e221.style.fontSize = "0.95rem";
  _e220.appendChild(_e221);
  const _e222 = WF.h("p", { className: "wf-text" }, "Built and enhanced a Community & Learning Platform to foster knowledge sharing and collaboration among users, ensuring seamless performance and scalability.");
  _e222.style.color = "#E8E6E1";
  _e222.style.lineHeight = "1.7";
  _e222.style.fontSize = "0.95rem";
  _e220.appendChild(_e222);
  const _e223 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers to deliver high-quality, user-centric features, ensuring smooth integration between backend services and frontend applications.");
  _e223.style.color = "#E8E6E1";
  _e223.style.lineHeight = "1.7";
  _e223.style.fontSize = "0.95rem";
  _e220.appendChild(_e223);
  const _e224 = WF.h("p", { className: "wf-text" }, "Continuously expanded technical expertise by mastering NestJS, Rust, and GraphQL, applying these technologies to optimize platform performance, reliability, and maintainability.");
  _e224.style.color = "#E8E6E1";
  _e224.style.lineHeight = "1.7";
  _e224.style.fontSize = "0.95rem";
  _e220.appendChild(_e224);
  _e214.appendChild(_e220);
  const _e225 = WF.h("div", { className: "wf-spacer" });
  _e214.appendChild(_e225);
  const _e226 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e227 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e227.style.fontFamily = "JetBrains Mono, monospace";
  _e227.style.background = "#2D2C2A";
  _e227.style.color = "#E8E6E1";
  _e227.style.padding = "0.25rem 0.75rem";
  _e227.style.borderRadius = "0.375rem";
  _e227.style.fontSize = "0.75rem";
  _e226.appendChild(_e227);
  const _e228 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e228.style.fontFamily = "JetBrains Mono, monospace";
  _e228.style.background = "#2D2C2A";
  _e228.style.color = "#E8E6E1";
  _e228.style.padding = "0.25rem 0.75rem";
  _e228.style.borderRadius = "0.375rem";
  _e228.style.fontSize = "0.75rem";
  _e226.appendChild(_e228);
  const _e229 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e229.style.fontFamily = "JetBrains Mono, monospace";
  _e229.style.background = "#2D2C2A";
  _e229.style.color = "#E8E6E1";
  _e229.style.padding = "0.25rem 0.75rem";
  _e229.style.borderRadius = "0.375rem";
  _e229.style.fontSize = "0.75rem";
  _e226.appendChild(_e229);
  const _e230 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e230.style.fontFamily = "JetBrains Mono, monospace";
  _e230.style.background = "#2D2C2A";
  _e230.style.color = "#E8E6E1";
  _e230.style.padding = "0.25rem 0.75rem";
  _e230.style.borderRadius = "0.375rem";
  _e230.style.fontSize = "0.75rem";
  _e226.appendChild(_e230);
  _e214.appendChild(_e226);
  _e213.appendChild(_e214);
  _e213.style.background = "#242422";
  _e213.style.border = "1px solid #2D2C2A";
  _e213.style.borderRadius = "0.75rem";
  _e213.style.padding = "2rem";
  _e213.style.marginBottom = "2rem";
  _e169.appendChild(_e213);
  const _e231 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e232 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e233 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e234 = WF.h("p", { className: "wf-text wf-text--bold" }, "Alimny");
  _e234.style.fontSize = "1.2rem";
  _e234.style.color = "#E8E6E1";
  _e233.appendChild(_e234);
  const _e235 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Jan 2021 — Dec 2022");
  _e235.style.color = "#C69C6D";
  _e235.style.fontFamily = "JetBrains Mono, monospace";
  _e235.style.fontSize = "0.8rem";
  _e233.appendChild(_e235);
  _e232.appendChild(_e233);
  const _e236 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer & Co-founder");
  _e236.style.color = "#8C8B88";
  _e236.style.fontSize = "0.95rem";
  _e232.appendChild(_e236);
  const _e237 = WF.h("div", { className: "wf-spacer" });
  _e232.appendChild(_e237);
  const _e238 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e239 = WF.h("p", { className: "wf-text" }, "Co-founded a startup providing innovative and accessible e-learning solutions for students and teachers, using technologies such as web development, machine learning, and cloud computing to make education more engaging and effective.");
  _e239.style.color = "#E8E6E1";
  _e239.style.lineHeight = "1.7";
  _e239.style.fontSize = "0.95rem";
  _e238.appendChild(_e239);
  const _e240 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained server-side logic, APIs, and databases for web applications powering the e-learning platform using Node.js, Express.js, MongoDB, GraphQL, and Firebase.");
  _e240.style.color = "#E8E6E1";
  _e240.style.lineHeight = "1.7";
  _e240.style.fontSize = "0.95rem";
  _e238.appendChild(_e240);
  const _e241 = WF.h("p", { className: "wf-text" }, "Developed a robust authentication system using JWT and Firebase, and optimized database queries and indexes to improve response time and reduce server load.");
  _e241.style.color = "#E8E6E1";
  _e241.style.lineHeight = "1.7";
  _e241.style.fontSize = "0.95rem";
  _e238.appendChild(_e241);
  const _e242 = WF.h("p", { className: "wf-text" }, "Wrote unit tests and documentation for the codebase, and collaborated with co-founders and frontend developers to ensure application quality and performance.");
  _e242.style.color = "#E8E6E1";
  _e242.style.lineHeight = "1.7";
  _e242.style.fontSize = "0.95rem";
  _e238.appendChild(_e242);
  _e232.appendChild(_e238);
  const _e243 = WF.h("div", { className: "wf-spacer" });
  _e232.appendChild(_e243);
  const _e244 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e245 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e245.style.fontFamily = "JetBrains Mono, monospace";
  _e245.style.background = "#2D2C2A";
  _e245.style.color = "#E8E6E1";
  _e245.style.padding = "0.25rem 0.75rem";
  _e245.style.borderRadius = "0.375rem";
  _e245.style.fontSize = "0.75rem";
  _e244.appendChild(_e245);
  const _e246 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e246.style.fontFamily = "JetBrains Mono, monospace";
  _e246.style.background = "#2D2C2A";
  _e246.style.color = "#E8E6E1";
  _e246.style.padding = "0.25rem 0.75rem";
  _e246.style.borderRadius = "0.375rem";
  _e246.style.fontSize = "0.75rem";
  _e244.appendChild(_e246);
  const _e247 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e247.style.fontFamily = "JetBrains Mono, monospace";
  _e247.style.background = "#2D2C2A";
  _e247.style.color = "#E8E6E1";
  _e247.style.padding = "0.25rem 0.75rem";
  _e247.style.borderRadius = "0.375rem";
  _e247.style.fontSize = "0.75rem";
  _e244.appendChild(_e247);
  const _e248 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e248.style.fontFamily = "JetBrains Mono, monospace";
  _e248.style.background = "#2D2C2A";
  _e248.style.color = "#E8E6E1";
  _e248.style.padding = "0.25rem 0.75rem";
  _e248.style.borderRadius = "0.375rem";
  _e248.style.fontSize = "0.75rem";
  _e244.appendChild(_e248);
  _e232.appendChild(_e244);
  _e231.appendChild(_e232);
  _e231.style.background = "#242422";
  _e231.style.border = "1px solid #2D2C2A";
  _e231.style.borderRadius = "0.75rem";
  _e231.style.padding = "2rem";
  _e231.style.marginBottom = "2rem";
  _e169.appendChild(_e231);
  const _e249 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e250 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e251 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e252 = WF.h("p", { className: "wf-text wf-text--bold" }, "EnayaTech");
  _e252.style.fontSize = "1.2rem";
  _e252.style.color = "#E8E6E1";
  _e251.appendChild(_e252);
  const _e253 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Feb 2020 — Jul 2020");
  _e253.style.color = "#C69C6D";
  _e253.style.fontFamily = "JetBrains Mono, monospace";
  _e253.style.fontSize = "0.8rem";
  _e251.appendChild(_e253);
  _e250.appendChild(_e251);
  const _e254 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e254.style.color = "#8C8B88";
  _e254.style.fontSize = "0.95rem";
  _e250.appendChild(_e254);
  const _e255 = WF.h("div", { className: "wf-spacer" });
  _e250.appendChild(_e255);
  const _e256 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e257 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained RESTful APIs using Express.js, MySQL, and MongoDB to support various web applications, gaining hands-on experience in backend development.");
  _e257.style.color = "#E8E6E1";
  _e257.style.lineHeight = "1.7";
  _e257.style.fontSize = "0.95rem";
  _e256.appendChild(_e257);
  const _e258 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers, designers, and product managers to deliver high-quality features and seamless user experiences.");
  _e258.style.color = "#E8E6E1";
  _e258.style.lineHeight = "1.7";
  _e258.style.fontSize = "0.95rem";
  _e256.appendChild(_e258);
  const _e259 = WF.h("p", { className: "wf-text" }, "Actively learned and applied new technologies and tools, participated in code reviews, documentation, and testing processes to contribute to overall codebase quality.");
  _e259.style.color = "#E8E6E1";
  _e259.style.lineHeight = "1.7";
  _e259.style.fontSize = "0.95rem";
  _e256.appendChild(_e259);
  _e250.appendChild(_e256);
  const _e260 = WF.h("div", { className: "wf-spacer" });
  _e250.appendChild(_e260);
  const _e261 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e262 = WF.h("span", { className: "wf-badge" }, "Express.js");
  _e262.style.fontFamily = "JetBrains Mono, monospace";
  _e262.style.background = "#2D2C2A";
  _e262.style.color = "#E8E6E1";
  _e262.style.padding = "0.25rem 0.75rem";
  _e262.style.borderRadius = "0.375rem";
  _e262.style.fontSize = "0.75rem";
  _e261.appendChild(_e262);
  const _e263 = WF.h("span", { className: "wf-badge" }, "MySQL");
  _e263.style.fontFamily = "JetBrains Mono, monospace";
  _e263.style.background = "#2D2C2A";
  _e263.style.color = "#E8E6E1";
  _e263.style.padding = "0.25rem 0.75rem";
  _e263.style.borderRadius = "0.375rem";
  _e263.style.fontSize = "0.75rem";
  _e261.appendChild(_e263);
  const _e264 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e264.style.fontFamily = "JetBrains Mono, monospace";
  _e264.style.background = "#2D2C2A";
  _e264.style.color = "#E8E6E1";
  _e264.style.padding = "0.25rem 0.75rem";
  _e264.style.borderRadius = "0.375rem";
  _e264.style.fontSize = "0.75rem";
  _e261.appendChild(_e264);
  _e250.appendChild(_e261);
  _e249.appendChild(_e250);
  _e249.style.background = "#242422";
  _e249.style.border = "1px solid #2D2C2A";
  _e249.style.borderRadius = "0.75rem";
  _e249.style.padding = "2rem";
  _e249.style.marginBottom = "2rem";
  _e169.appendChild(_e249);
  _e168.appendChild(_e169);
  _e168.style.maxWidth = "800px";
  _e168.style.margin = "0 auto";
  _e168.style.padding = "80px 2rem";
  _e168.classList.add("wf-s265");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s265 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s265 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e168);
  return _root;
}

function Page_Education(params) {
  const _root = document.createDocumentFragment();
  const _e266 = WF.h("div", { className: "wf-container" });
  const _e267 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e268 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Education");
  _e268.style.fontSize = "2rem";
  _e268.style.fontWeight = "700";
  _e268.style.color = "#E8E6E1";
  _e268.style.letterSpacing = "-0.02em";
  _e268.style.marginBottom = "3rem";
  _e267.appendChild(_e268);
  const _e269 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e270 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e271 = WF.h("p", { className: "wf-text wf-text--bold" }, "National Ribat University");
  _e271.style.fontSize = "1.2rem";
  _e271.style.color = "#E8E6E1";
  _e270.appendChild(_e271);
  const _e272 = WF.h("p", { className: "wf-text wf-text--muted" }, "Bachelor of Information Technology");
  _e272.style.color = "#8C8B88";
  _e272.style.fontSize = "0.95rem";
  _e270.appendChild(_e272);
  const _e273 = WF.h("p", { className: "wf-text" }, "Oct 2018 — Feb 2025");
  _e273.style.color = "#C69C6D";
  _e273.style.fontFamily = "JetBrains Mono, monospace";
  _e273.style.fontSize = "0.85rem";
  _e270.appendChild(_e273);
  const _e274 = WF.h("div", { className: "wf-spacer" });
  _e270.appendChild(_e274);
  const _e275 = WF.h("p", { className: "wf-text" }, "Completed a comprehensive IT degree over nearly 7 years, overcoming challenges such as COVID-19, political unrest, and revolution. Gained expertise in programming fundamentals, data structures, software engineering, database management, system analysis, and network technologies.");
  _e275.style.color = "#E8E6E1";
  _e275.style.lineHeight = "1.7";
  _e275.style.fontSize = "0.95rem";
  _e270.appendChild(_e275);
  const _e276 = WF.h("div", { className: "wf-spacer" });
  _e270.appendChild(_e276);
  const _e277 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e278 = WF.h("p", { className: "wf-text wf-text--bold" }, "Highlights:");
  _e278.style.color = "#C69C6D";
  _e278.style.fontSize = "0.9rem";
  _e278.style.fontWeight = "600";
  _e277.appendChild(_e278);
  const _e279 = WF.h("p", { className: "wf-text" }, "Developed practical skills through semester-long projects starting from Semester 3, applying theoretical knowledge to real-world IT solutions");
  _e279.style.fontFamily = "JetBrains Mono, monospace";
  _e279.style.color = "#E8E6E1";
  _e279.style.fontSize = "0.85rem";
  _e277.appendChild(_e279);
  const _e280 = WF.h("p", { className: "wf-text" }, "Enhanced soft skills through courses in communication, research methodology, and professional ethics");
  _e280.style.fontFamily = "JetBrains Mono, monospace";
  _e280.style.color = "#E8E6E1";
  _e280.style.fontSize = "0.85rem";
  _e277.appendChild(_e280);
  const _e281 = WF.h("p", { className: "wf-text" }, "Balanced academics with work experience, gaining hands-on industry insights and strengthening adaptability and time management");
  _e281.style.fontFamily = "JetBrains Mono, monospace";
  _e281.style.color = "#E8E6E1";
  _e281.style.fontSize = "0.85rem";
  _e277.appendChild(_e281);
  const _e282 = WF.h("p", { className: "wf-text" }, "Built a strong foundation in IT, combining technical expertise with problem-solving and teamwork skills");
  _e282.style.fontFamily = "JetBrains Mono, monospace";
  _e282.style.color = "#E8E6E1";
  _e282.style.fontSize = "0.85rem";
  _e277.appendChild(_e282);
  const _e283 = WF.h("p", { className: "wf-text" }, "Activities: GDSC, Open Days, Juniors Welcoming");
  _e283.style.fontFamily = "JetBrains Mono, monospace";
  _e283.style.color = "#8C8B88";
  _e283.style.fontSize = "0.8rem";
  _e277.appendChild(_e283);
  _e270.appendChild(_e277);
  _e269.appendChild(_e270);
  _e269.style.background = "#242422";
  _e269.style.border = "1px solid #2D2C2A";
  _e269.style.borderRadius = "0.75rem";
  _e269.style.padding = "2rem";
  _e269.style.marginBottom = "2rem";
  _e267.appendChild(_e269);
  const _e284 = WF.h("h2", { className: "wf-heading wf-heading--h2 wf-animate-fadeIn" }, "Certifications");
  _e284.style.fontSize = "1.5rem";
  _e284.style.fontWeight = "700";
  _e284.style.color = "#E8E6E1";
  _e284.style.letterSpacing = "-0.02em";
  _e284.style.marginBottom = "1rem";
  _e284.style.marginTop = "1rem";
  _e267.appendChild(_e284);
  const _e285 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e286 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e287 = WF.h("p", { className: "wf-text wf-text--bold" }, "Fundamentals of Backend Engineering");
  _e287.style.fontSize = "1rem";
  _e287.style.color = "#E8E6E1";
  _e286.appendChild(_e287);
  const _e288 = WF.h("p", { className: "wf-text wf-text--muted" }, "Udemy — Aug 2025");
  _e288.style.color = "#C69C6D";
  _e288.style.fontFamily = "JetBrains Mono, monospace";
  _e288.style.fontSize = "0.8rem";
  _e286.appendChild(_e288);
  const _e289 = WF.h("p", { className: "wf-text" }, "Deep dive into the protocols and communication patterns that power modern backend systems.");
  _e289.style.color = "#8C8B88";
  _e289.style.fontSize = "0.9rem";
  _e289.style.lineHeight = "1.6";
  _e286.appendChild(_e289);
  _e285.appendChild(_e286);
  _e285.style.background = "#242422";
  _e285.style.border = "1px solid #2D2C2A";
  _e285.style.borderRadius = "0.75rem";
  _e285.style.padding = "2rem";
  _e285.style.marginBottom = "2rem";
  _e267.appendChild(_e285);
  const _e290 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e291 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e292 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e293 = WF.h("span", { className: "wf-badge" }, "Coursera");
  _e293.style.fontFamily = "JetBrains Mono, monospace";
  _e293.style.background = "#2D2C2A";
  _e293.style.color = "#E8E6E1";
  _e293.style.padding = "0.2rem 0.6rem";
  _e293.style.borderRadius = "0.375rem";
  _e293.style.fontSize = "0.7rem";
  _e292.appendChild(_e293);
  const _e294 = WF.h("span", { className: "wf-badge" }, "2020");
  _e294.style.fontFamily = "JetBrains Mono, monospace";
  _e294.style.background = "#2D2C2A";
  _e294.style.color = "#8C8B88";
  _e294.style.padding = "0.2rem 0.6rem";
  _e294.style.borderRadius = "0.375rem";
  _e294.style.fontSize = "0.7rem";
  _e292.appendChild(_e294);
  _e291.appendChild(_e292);
  const _e295 = WF.h("p", { className: "wf-text" }, "Server-side Development with NodeJS, Express and MongoDB");
  _e295.style.fontFamily = "JetBrains Mono, monospace";
  _e295.style.color = "#E8E6E1";
  _e295.style.fontSize = "0.9rem";
  _e291.appendChild(_e295);
  const _e296 = WF.h("p", { className: "wf-text" }, "Introduction to HTML5 · Interactivity with JavaScript · Front-End Web UI Frameworks: Bootstrap 4 · IT Project Management · Front-End Web Development with React · Introduction to TCP/IP · Introduction to CSS3 · Computer Security and Systems Management");
  _e296.style.color = "#8C8B88";
  _e296.style.fontSize = "0.85rem";
  _e296.style.lineHeight = "1.6";
  _e291.appendChild(_e296);
  _e290.appendChild(_e291);
  _e290.style.background = "#242422";
  _e290.style.border = "1px solid #2D2C2A";
  _e290.style.borderRadius = "0.75rem";
  _e290.style.padding = "2rem";
  _e290.style.marginBottom = "2rem";
  _e267.appendChild(_e290);
  _e266.appendChild(_e267);
  _e266.style.maxWidth = "800px";
  _e266.style.margin = "0 auto";
  _e266.style.padding = "80px 2rem";
  _e266.classList.add("wf-s297");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s297 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s297 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e266);
  return _root;
}

function Page_Home(params) {
  const _root = document.createDocumentFragment();
  const _e298 = WF.h("div", { className: "wf-container" });
  const _e299 = WF.h("div", { className: "wf-stack wf-animate-fadeIn wf-stack--gap-md" });
  const _e300 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Monzer Omer");
  _e300.style.fontSize = "3rem";
  _e300.style.fontWeight = "700";
  _e300.style.color = "#E8E6E1";
  _e300.style.letterSpacing = "-0.02em";
  _e300.style.lineHeight = "1.1";
  _e300.classList.add("wf-s301");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s301 { font-size: 2rem; } } "; document.head.appendChild(_s); }
  _e299.appendChild(_e300);
  const _e302 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e302);
  const _e303 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
  _e303.style.fontSize = "1.25rem";
  _e303.style.color = "#8C8B88";
  _e303.style.fontWeight = "400";
  _e303.classList.add("wf-s304");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s304 { font-size: 1rem; } } "; document.head.appendChild(_s); }
  _e299.appendChild(_e303);
  const _e305 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e305);
  const _e306 = WF.h("p", { className: "wf-text" }, "Architecting scalable, resilient solutions and high-performance systems. Dedicated to clean, maintainable server-side architectures, data integrity, and low-level optimization.");
  _e306.style.fontSize = "1.1rem";
  _e306.style.color = "#E8E6E1";
  _e306.style.lineHeight = "1.7";
  _e306.style.maxWidth = "600px";
  _e299.appendChild(_e306);
  const _e307 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e307);
  const _e308 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e309 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Rust");
  _e309.style.fontFamily = "JetBrains Mono, monospace";
  _e309.style.background = "#C69C6D";
  _e309.style.color = "#1A1A19";
  _e309.style.padding = "0.4rem 1rem";
  _e309.style.borderRadius = "0.375rem";
  _e309.style.fontSize = "0.875rem";
  _e309.style.fontWeight = "600";
  _e308.appendChild(_e309);
  const _e310 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e310.style.fontFamily = "JetBrains Mono, monospace";
  _e310.style.background = "#2D2C2A";
  _e310.style.color = "#E8E6E1";
  _e310.style.padding = "0.4rem 1rem";
  _e310.style.borderRadius = "0.375rem";
  _e310.style.fontSize = "0.875rem";
  _e308.appendChild(_e310);
  const _e311 = WF.h("span", { className: "wf-badge" }, "Distributed Systems");
  _e311.style.fontFamily = "JetBrains Mono, monospace";
  _e311.style.background = "#2D2C2A";
  _e311.style.color = "#E8E6E1";
  _e311.style.padding = "0.4rem 1rem";
  _e311.style.borderRadius = "0.375rem";
  _e311.style.fontSize = "0.875rem";
  _e308.appendChild(_e311);
  _e299.appendChild(_e308);
  const _e312 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e312);
  const _e313 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e314 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e315 = WF.h("p", { className: "wf-text" }, "View Projects →");
  _e315.style.color = "#C69C6D";
  _e315.style.fontWeight = "500";
  _e315.style.fontSize = "1rem";
  _e315.style.transition = "color 200ms ease";
  _e314.appendChild(_e315);
  _e313.appendChild(_e314);
  const _e316 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e317 = WF.h("p", { className: "wf-text" }, "Experience →");
  _e317.style.color = "#8C8B88";
  _e317.style.fontSize = "1rem";
  _e317.style.transition = "color 200ms ease";
  _e316.appendChild(_e317);
  _e313.appendChild(_e316);
  const _e318 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e319 = WF.h("p", { className: "wf-text" }, "Get in Touch →");
  _e319.style.color = "#8C8B88";
  _e319.style.fontSize = "1rem";
  _e319.style.transition = "color 200ms ease";
  _e318.appendChild(_e319);
  _e313.appendChild(_e318);
  _e299.appendChild(_e313);
  const _e320 = WF.h("div", { className: "wf-spacer" });
  _e299.appendChild(_e320);
  const _e321 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e322 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e323 = WF.h("p", { className: "wf-text" }, "GitHub");
  _e323.style.fontFamily = "JetBrains Mono, monospace";
  _e323.style.color = "#8C8B88";
  _e323.style.fontSize = "0.85rem";
  _e323.style.transition = "color 200ms ease";
  _e322.appendChild(_e323);
  _e321.appendChild(_e322);
  const _e324 = WF.h("p", { className: "wf-text wf-text--muted" }, "·");
  _e324.style.color = "#2D2C2A";
  _e321.appendChild(_e324);
  const _e325 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
  const _e326 = WF.h("p", { className: "wf-text" }, "LinkedIn");
  _e326.style.fontFamily = "JetBrains Mono, monospace";
  _e326.style.color = "#8C8B88";
  _e326.style.fontSize = "0.85rem";
  _e326.style.transition = "color 200ms ease";
  _e325.appendChild(_e326);
  _e321.appendChild(_e325);
  const _e327 = WF.h("p", { className: "wf-text wf-text--muted" }, "·");
  _e327.style.color = "#2D2C2A";
  _e321.appendChild(_e327);
  const _e328 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e329 = WF.h("p", { className: "wf-text" }, "Email");
  _e329.style.fontFamily = "JetBrains Mono, monospace";
  _e329.style.color = "#8C8B88";
  _e329.style.fontSize = "0.85rem";
  _e329.style.transition = "color 200ms ease";
  _e328.appendChild(_e329);
  _e321.appendChild(_e328);
  _e299.appendChild(_e321);
  _e298.appendChild(_e299);
  _e298.style.maxWidth = "800px";
  _e298.style.margin = "0 auto";
  _e298.style.padding = "80px 2rem";
  _e298.style.minHeight = "100vh";
  _e298.style.display = "flex";
  _e298.style.flexDirection = "column";
  _e298.style.justifyContent = "center";
  _e298.classList.add("wf-s330");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s330 { padding: 60px 1.5rem; min-height: 90vh; } } @media (max-width: 480px) { .wf-s330 { padding: 40px 1rem; min-height: auto; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e298);
  return _root;
}

function Page_Skills(params) {
  const _root = document.createDocumentFragment();
  const _e331 = WF.h("div", { className: "wf-container" });
  const _e332 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e333 = WF.h("h2", { className: "wf-heading wf-heading--h1 wf-animate-fadeIn" }, "Infrastructure & Capabilities");
  _e333.style.fontSize = "2rem";
  _e333.style.fontWeight = "700";
  _e333.style.color = "#E8E6E1";
  _e333.style.letterSpacing = "-0.02em";
  _e333.style.marginBottom = "1rem";
  _e332.appendChild(_e333);
  const _e334 = WF.h("p", { className: "wf-text wf-text--muted" }, "Languages, frameworks, and systems I architect, build, and deploy with.");
  _e334.style.color = "#8C8B88";
  _e334.style.fontSize = "1rem";
  _e334.style.marginBottom = "3rem";
  _e332.appendChild(_e334);
  const _e335 = WF.h("div", { className: "wf-spacer" });
  _e332.appendChild(_e335);
  const _e336 = WF.h("div", { className: "wf-grid wf-grid--gap-md", style: { gridTemplateColumns: 'repeat(2, 1fr)' } });
  const _e337 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e338 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e339 = WF.h("p", { className: "wf-text wf-text--bold" }, "Languages");
  _e339.style.fontSize = "1rem";
  _e339.style.color = "#C69C6D";
  _e339.style.fontWeight = "600";
  _e339.style.marginBottom = "0.5rem";
  _e338.appendChild(_e339);
  const _e340 = WF.h("p", { className: "wf-text" }, "Rust");
  _e340.style.fontFamily = "JetBrains Mono, monospace";
  _e340.style.color = "#E8E6E1";
  _e340.style.fontSize = "0.9rem";
  _e338.appendChild(_e340);
  const _e341 = WF.h("p", { className: "wf-text" }, "TypeScript");
  _e341.style.fontFamily = "JetBrains Mono, monospace";
  _e341.style.color = "#E8E6E1";
  _e341.style.fontSize = "0.9rem";
  _e338.appendChild(_e341);
  const _e342 = WF.h("p", { className: "wf-text" }, "JavaScript");
  _e342.style.fontFamily = "JetBrains Mono, monospace";
  _e342.style.color = "#E8E6E1";
  _e342.style.fontSize = "0.9rem";
  _e338.appendChild(_e342);
  const _e343 = WF.h("p", { className: "wf-text" }, "SQL");
  _e343.style.fontFamily = "JetBrains Mono, monospace";
  _e343.style.color = "#E8E6E1";
  _e343.style.fontSize = "0.9rem";
  _e338.appendChild(_e343);
  _e337.appendChild(_e338);
  _e337.style.background = "#242422";
  _e337.style.border = "1px solid #2D2C2A";
  _e337.style.borderRadius = "0.75rem";
  _e337.style.padding = "2rem";
  _e336.appendChild(_e337);
  const _e344 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e345 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e346 = WF.h("p", { className: "wf-text wf-text--bold" }, "Databases & Storage");
  _e346.style.fontSize = "1rem";
  _e346.style.color = "#C69C6D";
  _e346.style.fontWeight = "600";
  _e346.style.marginBottom = "0.5rem";
  _e345.appendChild(_e346);
  const _e347 = WF.h("p", { className: "wf-text" }, "PostgreSQL");
  _e347.style.fontFamily = "JetBrains Mono, monospace";
  _e347.style.color = "#E8E6E1";
  _e347.style.fontSize = "0.9rem";
  _e345.appendChild(_e347);
  const _e348 = WF.h("p", { className: "wf-text" }, "MySQL");
  _e348.style.fontFamily = "JetBrains Mono, monospace";
  _e348.style.color = "#E8E6E1";
  _e348.style.fontSize = "0.9rem";
  _e345.appendChild(_e348);
  const _e349 = WF.h("p", { className: "wf-text" }, "MongoDB");
  _e349.style.fontFamily = "JetBrains Mono, monospace";
  _e349.style.color = "#E8E6E1";
  _e349.style.fontSize = "0.9rem";
  _e345.appendChild(_e349);
  const _e350 = WF.h("p", { className: "wf-text" }, "Firebase");
  _e350.style.fontFamily = "JetBrains Mono, monospace";
  _e350.style.color = "#E8E6E1";
  _e350.style.fontSize = "0.9rem";
  _e345.appendChild(_e350);
  const _e351 = WF.h("p", { className: "wf-text" }, "Redis");
  _e351.style.fontFamily = "JetBrains Mono, monospace";
  _e351.style.color = "#E8E6E1";
  _e351.style.fontSize = "0.9rem";
  _e345.appendChild(_e351);
  _e344.appendChild(_e345);
  _e344.style.background = "#242422";
  _e344.style.border = "1px solid #2D2C2A";
  _e344.style.borderRadius = "0.75rem";
  _e344.style.padding = "2rem";
  _e336.appendChild(_e344);
  const _e352 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e353 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e354 = WF.h("p", { className: "wf-text wf-text--bold" }, "Messaging & Streaming");
  _e354.style.fontSize = "1rem";
  _e354.style.color = "#C69C6D";
  _e354.style.fontWeight = "600";
  _e354.style.marginBottom = "0.5rem";
  _e353.appendChild(_e354);
  const _e355 = WF.h("p", { className: "wf-text" }, "Apache Kafka");
  _e355.style.fontFamily = "JetBrains Mono, monospace";
  _e355.style.color = "#E8E6E1";
  _e355.style.fontSize = "0.9rem";
  _e353.appendChild(_e355);
  const _e356 = WF.h("p", { className: "wf-text" }, "RabbitMQ");
  _e356.style.fontFamily = "JetBrains Mono, monospace";
  _e356.style.color = "#E8E6E1";
  _e356.style.fontSize = "0.9rem";
  _e353.appendChild(_e356);
  const _e357 = WF.h("p", { className: "wf-text" }, "Event-Driven Design");
  _e357.style.fontFamily = "JetBrains Mono, monospace";
  _e357.style.color = "#E8E6E1";
  _e357.style.fontSize = "0.9rem";
  _e353.appendChild(_e357);
  const _e358 = WF.h("p", { className: "wf-text" }, "WebSocket");
  _e358.style.fontFamily = "JetBrains Mono, monospace";
  _e358.style.color = "#E8E6E1";
  _e358.style.fontSize = "0.9rem";
  _e353.appendChild(_e358);
  const _e359 = WF.h("p", { className: "wf-text" }, "gRPC");
  _e359.style.fontFamily = "JetBrains Mono, monospace";
  _e359.style.color = "#E8E6E1";
  _e359.style.fontSize = "0.9rem";
  _e353.appendChild(_e359);
  _e352.appendChild(_e353);
  _e352.style.background = "#242422";
  _e352.style.border = "1px solid #2D2C2A";
  _e352.style.borderRadius = "0.75rem";
  _e352.style.padding = "2rem";
  _e336.appendChild(_e352);
  const _e360 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e361 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e362 = WF.h("p", { className: "wf-text wf-text--bold" }, "Systems & Architecture");
  _e362.style.fontSize = "1rem";
  _e362.style.color = "#C69C6D";
  _e362.style.fontWeight = "600";
  _e362.style.marginBottom = "0.5rem";
  _e361.appendChild(_e362);
  const _e363 = WF.h("p", { className: "wf-text" }, "Microservices Architecture");
  _e363.style.fontFamily = "JetBrains Mono, monospace";
  _e363.style.color = "#E8E6E1";
  _e363.style.fontSize = "0.9rem";
  _e361.appendChild(_e363);
  const _e364 = WF.h("p", { className: "wf-text" }, "Distributed Systems");
  _e364.style.fontFamily = "JetBrains Mono, monospace";
  _e364.style.color = "#E8E6E1";
  _e364.style.fontSize = "0.9rem";
  _e361.appendChild(_e364);
  const _e365 = WF.h("p", { className: "wf-text" }, "WebAssembly");
  _e365.style.fontFamily = "JetBrains Mono, monospace";
  _e365.style.color = "#E8E6E1";
  _e365.style.fontSize = "0.9rem";
  _e361.appendChild(_e365);
  const _e366 = WF.h("p", { className: "wf-text" }, "System Design");
  _e366.style.fontFamily = "JetBrains Mono, monospace";
  _e366.style.color = "#E8E6E1";
  _e366.style.fontSize = "0.9rem";
  _e361.appendChild(_e366);
  const _e367 = WF.h("p", { className: "wf-text" }, "Compiler Design");
  _e367.style.fontFamily = "JetBrains Mono, monospace";
  _e367.style.color = "#E8E6E1";
  _e367.style.fontSize = "0.9rem";
  _e361.appendChild(_e367);
  _e360.appendChild(_e361);
  _e360.style.background = "#242422";
  _e360.style.border = "1px solid #2D2C2A";
  _e360.style.borderRadius = "0.75rem";
  _e360.style.padding = "2rem";
  _e336.appendChild(_e360);
  const _e368 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e369 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e370 = WF.h("p", { className: "wf-text wf-text--bold" }, "DevOps & Infrastructure");
  _e370.style.fontSize = "1rem";
  _e370.style.color = "#C69C6D";
  _e370.style.fontWeight = "600";
  _e370.style.marginBottom = "0.5rem";
  _e369.appendChild(_e370);
  const _e371 = WF.h("p", { className: "wf-text" }, "Docker");
  _e371.style.fontFamily = "JetBrains Mono, monospace";
  _e371.style.color = "#E8E6E1";
  _e371.style.fontSize = "0.9rem";
  _e369.appendChild(_e371);
  const _e372 = WF.h("p", { className: "wf-text" }, "Nginx");
  _e372.style.fontFamily = "JetBrains Mono, monospace";
  _e372.style.color = "#E8E6E1";
  _e372.style.fontSize = "0.9rem";
  _e369.appendChild(_e372);
  const _e373 = WF.h("p", { className: "wf-text" }, "Linux");
  _e373.style.fontFamily = "JetBrains Mono, monospace";
  _e373.style.color = "#E8E6E1";
  _e373.style.fontSize = "0.9rem";
  _e369.appendChild(_e373);
  const _e374 = WF.h("p", { className: "wf-text" }, "CI/CD");
  _e374.style.fontFamily = "JetBrains Mono, monospace";
  _e374.style.color = "#E8E6E1";
  _e374.style.fontSize = "0.9rem";
  _e369.appendChild(_e374);
  const _e375 = WF.h("p", { className: "wf-text" }, "Git");
  _e375.style.fontFamily = "JetBrains Mono, monospace";
  _e375.style.color = "#E8E6E1";
  _e375.style.fontSize = "0.9rem";
  _e369.appendChild(_e375);
  _e368.appendChild(_e369);
  _e368.style.background = "#242422";
  _e368.style.border = "1px solid #2D2C2A";
  _e368.style.borderRadius = "0.75rem";
  _e368.style.padding = "2rem";
  _e336.appendChild(_e368);
  const _e376 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e377 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e378 = WF.h("p", { className: "wf-text wf-text--bold" }, "Frontend & Desktop");
  _e378.style.fontSize = "1rem";
  _e378.style.color = "#C69C6D";
  _e378.style.fontWeight = "600";
  _e378.style.marginBottom = "0.5rem";
  _e377.appendChild(_e378);
  const _e379 = WF.h("p", { className: "wf-text" }, "React");
  _e379.style.fontFamily = "JetBrains Mono, monospace";
  _e379.style.color = "#E8E6E1";
  _e379.style.fontSize = "0.9rem";
  _e377.appendChild(_e379);
  const _e380 = WF.h("p", { className: "wf-text" }, "React Native");
  _e380.style.fontFamily = "JetBrains Mono, monospace";
  _e380.style.color = "#E8E6E1";
  _e380.style.fontSize = "0.9rem";
  _e377.appendChild(_e380);
  const _e381 = WF.h("p", { className: "wf-text" }, "Electron");
  _e381.style.fontFamily = "JetBrains Mono, monospace";
  _e381.style.color = "#E8E6E1";
  _e381.style.fontSize = "0.9rem";
  _e377.appendChild(_e381);
  const _e382 = WF.h("p", { className: "wf-text" }, "Tauri");
  _e382.style.fontFamily = "JetBrains Mono, monospace";
  _e382.style.color = "#E8E6E1";
  _e382.style.fontSize = "0.9rem";
  _e377.appendChild(_e382);
  const _e383 = WF.h("p", { className: "wf-text" }, "GTK4 / libadwaita");
  _e383.style.fontFamily = "JetBrains Mono, monospace";
  _e383.style.color = "#E8E6E1";
  _e383.style.fontSize = "0.9rem";
  _e377.appendChild(_e383);
  _e376.appendChild(_e377);
  _e376.style.background = "#242422";
  _e376.style.border = "1px solid #2D2C2A";
  _e376.style.borderRadius = "0.75rem";
  _e376.style.padding = "2rem";
  _e336.appendChild(_e376);
  const _e384 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e385 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e386 = WF.h("p", { className: "wf-text wf-text--bold" }, "Security & Quality");
  _e386.style.fontSize = "1rem";
  _e386.style.color = "#C69C6D";
  _e386.style.fontWeight = "600";
  _e386.style.marginBottom = "0.5rem";
  _e385.appendChild(_e386);
  const _e387 = WF.h("p", { className: "wf-text" }, "AES Encryption");
  _e387.style.fontFamily = "JetBrains Mono, monospace";
  _e387.style.color = "#E8E6E1";
  _e387.style.fontSize = "0.9rem";
  _e385.appendChild(_e387);
  const _e388 = WF.h("p", { className: "wf-text" }, "JWT / OAuth");
  _e388.style.fontFamily = "JetBrains Mono, monospace";
  _e388.style.color = "#E8E6E1";
  _e388.style.fontSize = "0.9rem";
  _e385.appendChild(_e388);
  const _e389 = WF.h("p", { className: "wf-text" }, "Unit Testing");
  _e389.style.fontFamily = "JetBrains Mono, monospace";
  _e389.style.color = "#E8E6E1";
  _e389.style.fontSize = "0.9rem";
  _e385.appendChild(_e389);
  const _e390 = WF.h("p", { className: "wf-text" }, "Code Review");
  _e390.style.fontFamily = "JetBrains Mono, monospace";
  _e390.style.color = "#E8E6E1";
  _e390.style.fontSize = "0.9rem";
  _e385.appendChild(_e390);
  const _e391 = WF.h("p", { className: "wf-text" }, "Agile / Scrum");
  _e391.style.fontFamily = "JetBrains Mono, monospace";
  _e391.style.color = "#E8E6E1";
  _e391.style.fontSize = "0.9rem";
  _e385.appendChild(_e391);
  _e384.appendChild(_e385);
  _e384.style.background = "#242422";
  _e384.style.border = "1px solid #2D2C2A";
  _e384.style.borderRadius = "0.75rem";
  _e384.style.padding = "2rem";
  _e336.appendChild(_e384);
  _e332.appendChild(_e336);
  _e331.appendChild(_e332);
  _e331.style.maxWidth = "800px";
  _e331.style.margin = "0 auto";
  _e331.style.padding = "80px 2rem";
  _e331.classList.add("wf-s392");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s392 { padding: 60px 1.5rem; } } @media (max-width: 480px) { .wf-s392 { padding: 40px 1rem; } } "; document.head.appendChild(_s); }
  _root.appendChild(_e331);
  return _root;
}

(function() {
  const _app = document.getElementById('app');
  _app.innerHTML = '';
  const _e393 = WF.h("div", { className: "wf-row wf-row--center wf-row--between" });
  const _e394 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e395 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
  _e395.style.fontFamily = "JetBrains Mono, monospace";
  _e395.style.color = "#E8E6E1";
  _e395.style.fontSize = "0.9rem";
  _e395.style.fontWeight = "600";
  _e394.appendChild(_e395);
  _e393.appendChild(_e394);
  const _e396 = WF.h("button", { className: "wf-btn wf-btn--small wf-btn--outlined", "on:click": (e) => { NavStore.toggle(); } }, "Menu");
  _e396.style.color = "#8C8B88";
  _e396.style.background = "transparent";
  _e396.style.border = "1px solid #2D2C2A";
  _e396.style.cursor = "pointer";
  _e396.style.fontFamily = "JetBrains Mono, monospace";
  _e396.style.fontSize = "0.75rem";
  _e396.style.padding = "0.35rem 0.75rem";
  _e396.style.borderRadius = "0.375rem";
  _e396.classList.add("wf-s397");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s397 { padding: 0.5rem 1rem; font-size: 0.85rem; min-height: 44px; min-width: 44px; } } "; document.head.appendChild(_s); }
  _e393.appendChild(_e396);
  _e393.style.display = "none";
  _e393.style.background = "#1A1A19";
  _e393.style.borderBottom = "1px solid #2D2C2A";
  _e393.style.padding = "0.75rem 1.25rem";
  _e393.style.position = "sticky";
  _e393.style.top = "0";
  _e393.style.zIndex = "200";
  _e393.style.flexDirection = "row";
  _e393.style.flexWrap = "nowrap";
  _e393.classList.add("wf-s398");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s398 { display: flex; } } @media (max-width: 480px) { .wf-s398 { padding: 0.6rem 1rem; } } "; document.head.appendChild(_s); }
  _app.appendChild(_e393);
  WF.condRender(_app,
    () => NavStore.sidebarOpen,
    () => {
      const _e399 = document.createDocumentFragment();
      const _e400 = WF.h("div", { className: "wf-container", "on:click": (event) => { NavStore.close(); } });
      _e400.style.position = "fixed";
      _e400.style.top = "0";
      _e400.style.left = "0";
      _e400.style.right = "0";
      _e400.style.bottom = "0";
      _e400.style.background = "rgba(0, 0, 0, 0.5)";
      _e400.style.zIndex = "399";
      _e400.style.maxWidth = "100%";
      _e400.style.padding = "0";
      _e399.appendChild(_e400);
      const _e401 = WF.h("div", { className: "wf-container" });
      const _e402 = WF.h("div", { className: "wf-container" });
      const _e403 = WF.h("button", { className: "wf-btn wf-btn--small wf-btn--outlined", "on:click": (e) => { NavStore.close(); } }, "✕");
      _e403.style.color = "#8C8B88";
      _e403.style.background = "transparent";
      _e403.style.border = "1px solid #2D2C2A";
      _e403.style.cursor = "pointer";
      _e403.style.fontSize = "0.9rem";
      _e403.style.padding = "0.35rem 0.65rem";
      _e403.style.borderRadius = "0.375rem";
      _e403.style.minHeight = "36px";
      _e403.style.minWidth = "36px";
      _e403.style.lineHeight = "1";
      _e402.appendChild(_e403);
      _e402.style.display = "flex";
      _e402.style.justifyContent = "flex-end";
      _e402.style.padding = "0.75rem 1rem";
      _e402.style.borderBottom = "1px solid #2D2C2A";
      _e401.appendChild(_e402);
      const _e404 = WF.h("div", { className: "wf-container" });
      const _e405 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
      const _e406 = WF.h("a", { className: "wf-link", href: WF._basePath + "/", "on:click": (event) => { NavStore.close(); } });
      const _e407 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
      _e407.style.fontFamily = "JetBrains Mono, monospace";
      _e407.style.color = "#E8E6E1";
      _e407.style.fontSize = "1rem";
      _e407.style.fontWeight = "600";
      _e406.appendChild(_e407);
      _e405.appendChild(_e406);
      const _e408 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
      _e408.style.color = "#8C8B88";
      _e408.style.fontSize = "0.75rem";
      _e405.appendChild(_e408);
      _e404.appendChild(_e405);
      _e404.style.padding = "1.5rem";
      _e404.style.borderBottom = "1px solid #2D2C2A";
      _e404.style.maxWidth = "100%";
      _e401.appendChild(_e404);
      const _e409 = WF.h("div", { className: "wf-stack" });
      const _e410 = WF.h("a", { className: "wf-link", href: WF._basePath + "/", "on:click": (event) => { NavStore.close(); } });
      const _e411 = WF.h("p", { className: "wf-text" }, "Home");
      _e411.style.display = "block";
      _e411.style.padding = "0.75rem 1.5rem";
      _e411.style.color = "#8C8B88";
      _e411.style.fontSize = "0.95rem";
      _e411.style.minHeight = "44px";
      _e411.style.lineHeight = "1.4";
      _e410.appendChild(_e411);
      _e409.appendChild(_e410);
      const _e412 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects", "on:click": (event) => { NavStore.close(); } });
      const _e413 = WF.h("p", { className: "wf-text" }, "Projects");
      _e413.style.display = "block";
      _e413.style.padding = "0.75rem 1.5rem";
      _e413.style.color = "#8C8B88";
      _e413.style.fontSize = "0.95rem";
      _e413.style.minHeight = "44px";
      _e413.style.lineHeight = "1.4";
      _e412.appendChild(_e413);
      _e409.appendChild(_e412);
      const _e414 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience", "on:click": (event) => { NavStore.close(); } });
      const _e415 = WF.h("p", { className: "wf-text" }, "Experience");
      _e415.style.display = "block";
      _e415.style.padding = "0.75rem 1.5rem";
      _e415.style.color = "#8C8B88";
      _e415.style.fontSize = "0.95rem";
      _e415.style.minHeight = "44px";
      _e415.style.lineHeight = "1.4";
      _e414.appendChild(_e415);
      _e409.appendChild(_e414);
      const _e416 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills", "on:click": (event) => { NavStore.close(); } });
      const _e417 = WF.h("p", { className: "wf-text" }, "Skills");
      _e417.style.display = "block";
      _e417.style.padding = "0.75rem 1.5rem";
      _e417.style.color = "#8C8B88";
      _e417.style.fontSize = "0.95rem";
      _e417.style.minHeight = "44px";
      _e417.style.lineHeight = "1.4";
      _e416.appendChild(_e417);
      _e409.appendChild(_e416);
      const _e418 = WF.h("a", { className: "wf-link", href: WF._basePath + "/education", "on:click": (event) => { NavStore.close(); } });
      const _e419 = WF.h("p", { className: "wf-text" }, "Education");
      _e419.style.display = "block";
      _e419.style.padding = "0.75rem 1.5rem";
      _e419.style.color = "#8C8B88";
      _e419.style.fontSize = "0.95rem";
      _e419.style.minHeight = "44px";
      _e419.style.lineHeight = "1.4";
      _e418.appendChild(_e419);
      _e409.appendChild(_e418);
      const _e420 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact", "on:click": (event) => { NavStore.close(); } });
      const _e421 = WF.h("p", { className: "wf-text" }, "Contact");
      _e421.style.display = "block";
      _e421.style.padding = "0.75rem 1.5rem";
      _e421.style.color = "#8C8B88";
      _e421.style.fontSize = "0.95rem";
      _e421.style.minHeight = "44px";
      _e421.style.lineHeight = "1.4";
      _e420.appendChild(_e421);
      _e409.appendChild(_e420);
      _e409.style.padding = "1rem 0";
      _e409.style.gap = "2px";
      _e401.appendChild(_e409);
      const _e422 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
      const _e423 = WF.h("div", { className: "wf-row wf-row--gap-md" });
      const _e424 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
      const _e425 = WF.h("p", { className: "wf-text" }, "GitHub");
      _e425.style.fontFamily = "JetBrains Mono, monospace";
      _e425.style.color = "#8C8B88";
      _e425.style.fontSize = "0.75rem";
      _e424.appendChild(_e425);
      _e423.appendChild(_e424);
      const _e426 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
      const _e427 = WF.h("p", { className: "wf-text" }, "LinkedIn");
      _e427.style.fontFamily = "JetBrains Mono, monospace";
      _e427.style.color = "#8C8B88";
      _e427.style.fontSize = "0.75rem";
      _e426.appendChild(_e427);
      _e423.appendChild(_e426);
      _e422.appendChild(_e423);
      const _e428 = WF.h("p", { className: "wf-text wf-text--muted" }, "Built with WebFluent");
      _e428.style.fontFamily = "JetBrains Mono, monospace";
      _e428.style.color = "#555";
      _e428.style.fontSize = "0.7rem";
      _e428.style.marginTop = "0.5rem";
      _e422.appendChild(_e428);
      _e422.style.padding = "1rem 1.5rem";
      _e422.style.marginTop = "auto";
      _e422.style.borderTop = "1px solid #2D2C2A";
      _e401.appendChild(_e422);
      _e401.style.position = "fixed";
      _e401.style.top = "0";
      _e401.style.left = "0";
      _e401.style.bottom = "0";
      _e401.style.width = "280px";
      _e401.style.maxWidth = "75vw";
      _e401.style.zIndex = "400";
      _e401.style.padding = "0";
      _e401.style.background = "#1A1A19";
      _e401.style.borderRight = "1px solid #2D2C2A";
      _e401.style.overflowY = "auto";
      _e401.style.display = "flex";
      _e401.style.flexDirection = "column";
      _e401.style.boxShadow = "4px 0 24px rgba(0,0,0,0.4)";
      _e401.classList.add("wf-s429");
      { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 400px) { .wf-s429 { width: 100%; max-width: 100vw; } } "; document.head.appendChild(_s); }
      _e399.appendChild(_e401);
      return _e399;
    },
    null,
    null
  );
  const _e430 = WF.h("div", { className: "wf-row" });
  _e430.style.minHeight = "100vh";
  _e430.style.flexDirection = "row";
  _e430.style.flexWrap = "nowrap";
  _app.appendChild(_e430);
  const _e431 = WF.h("div", { className: "wf-container" });
  const _e432 = WF.h("div", { className: "wf-container" });
  const _e433 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
  const _e434 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e435 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
  _e435.style.fontFamily = "JetBrains Mono, monospace";
  _e435.style.color = "#E8E6E1";
  _e435.style.fontSize = "1rem";
  _e435.style.fontWeight = "600";
  _e434.appendChild(_e435);
  _e433.appendChild(_e434);
  const _e436 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
  _e436.style.color = "#8C8B88";
  _e436.style.fontSize = "0.75rem";
  _e433.appendChild(_e436);
  _e432.appendChild(_e433);
  _e432.style.padding = "1.5rem";
  _e432.style.borderBottom = "1px solid #2D2C2A";
  _e432.style.maxWidth = "100%";
  _e431.appendChild(_e432);
  const _e437 = WF.h("div", { className: "wf-stack" });
  const _e438 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e439 = WF.h("p", { className: "wf-text" }, "Home");
  _e439.style.display = "block";
  _e439.style.padding = "0.55rem 1.5rem";
  _e439.style.color = "#8C8B88";
  _e439.style.fontSize = "0.875rem";
  _e438.appendChild(_e439);
  _e437.appendChild(_e438);
  const _e440 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e441 = WF.h("p", { className: "wf-text" }, "Projects");
  _e441.style.display = "block";
  _e441.style.padding = "0.55rem 1.5rem";
  _e441.style.color = "#8C8B88";
  _e441.style.fontSize = "0.875rem";
  _e440.appendChild(_e441);
  _e437.appendChild(_e440);
  const _e442 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e443 = WF.h("p", { className: "wf-text" }, "Experience");
  _e443.style.display = "block";
  _e443.style.padding = "0.55rem 1.5rem";
  _e443.style.color = "#8C8B88";
  _e443.style.fontSize = "0.875rem";
  _e442.appendChild(_e443);
  _e437.appendChild(_e442);
  const _e444 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills" });
  const _e445 = WF.h("p", { className: "wf-text" }, "Skills");
  _e445.style.display = "block";
  _e445.style.padding = "0.55rem 1.5rem";
  _e445.style.color = "#8C8B88";
  _e445.style.fontSize = "0.875rem";
  _e444.appendChild(_e445);
  _e437.appendChild(_e444);
  const _e446 = WF.h("a", { className: "wf-link", href: WF._basePath + "/education" });
  const _e447 = WF.h("p", { className: "wf-text" }, "Education");
  _e447.style.display = "block";
  _e447.style.padding = "0.55rem 1.5rem";
  _e447.style.color = "#8C8B88";
  _e447.style.fontSize = "0.875rem";
  _e446.appendChild(_e447);
  _e437.appendChild(_e446);
  const _e448 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e449 = WF.h("p", { className: "wf-text" }, "Contact");
  _e449.style.display = "block";
  _e449.style.padding = "0.55rem 1.5rem";
  _e449.style.color = "#8C8B88";
  _e449.style.fontSize = "0.875rem";
  _e448.appendChild(_e449);
  _e437.appendChild(_e448);
  _e437.style.padding = "1rem 0";
  _e437.style.gap = "2px";
  _e431.appendChild(_e437);
  const _e450 = WF.h("div", { className: "wf-stack wf-stack--gap-sm" });
  const _e451 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e452 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e453 = WF.h("p", { className: "wf-text" }, "GitHub");
  _e453.style.fontFamily = "JetBrains Mono, monospace";
  _e453.style.color = "#8C8B88";
  _e453.style.fontSize = "0.75rem";
  _e452.appendChild(_e453);
  _e451.appendChild(_e452);
  const _e454 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.linkedin.com/in/monzeromer/" });
  const _e455 = WF.h("p", { className: "wf-text" }, "LinkedIn");
  _e455.style.fontFamily = "JetBrains Mono, monospace";
  _e455.style.color = "#8C8B88";
  _e455.style.fontSize = "0.75rem";
  _e454.appendChild(_e455);
  _e451.appendChild(_e454);
  _e450.appendChild(_e451);
  const _e456 = WF.h("p", { className: "wf-text wf-text--muted" }, "Built with WebFluent");
  _e456.style.fontFamily = "JetBrains Mono, monospace";
  _e456.style.color = "#555";
  _e456.style.fontSize = "0.7rem";
  _e456.style.marginTop = "0.5rem";
  _e450.appendChild(_e456);
  _e450.style.padding = "1rem 1.5rem";
  _e450.style.marginTop = "auto";
  _e450.style.borderTop = "1px solid #2D2C2A";
  _e431.appendChild(_e450);
  _e431.style.width = "220px";
  _e431.style.minWidth = "220px";
  _e431.style.maxWidth = "220px";
  _e431.style.padding = "0";
  _e431.style.position = "sticky";
  _e431.style.top = "0";
  _e431.style.height = "100vh";
  _e431.style.background = "#1A1A19";
  _e431.style.borderRight = "1px solid #2D2C2A";
  _e431.style.overflowY = "auto";
  _e431.style.display = "flex";
  _e431.style.flexDirection = "column";
  _e431.style.flexShrink = "0";
  _e431.classList.add("wf-s457");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s457 { display: none; } } "; document.head.appendChild(_s); }
  _e430.appendChild(_e431);
  const _e458 = WF.h("div", { className: "wf-container" });
  _e458.style.flex = "1";
  _e458.style.maxWidth = "100%";
  _e458.style.minHeight = "100vh";
  _e458.style.padding = "0";
  _e458.style.minWidth = "0";
  _e430.appendChild(_e458);
  const _routerEl = document.createElement('div');
  _routerEl.id = 'wf-router';
  _routerEl.style.flex = '1';
  _e458.appendChild(_routerEl);
  const _routes = [
    { path: "/", render: (params) => Page_Home(params) },
    { path: "/projects", render: (params) => Page_Projects(params) },
    { path: "/experience", render: (params) => Page_Experience(params) },
    { path: "/skills", render: (params) => Page_Skills(params) },
    { path: "/education", render: (params) => Page_Education(params) },
    { path: "/contact", render: (params) => Page_Contact(params) },
  ];
  WF.createRouter(_routes, _routerEl);
})();
