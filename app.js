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
function Component_AICallout() {
  const _frag = document.createDocumentFragment();
  const _e0 = WF.h("div", { className: "wf-stack" });
  const _e1 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-sm" });
  const _e2 = WF.h("i", { className: "wf-icon wf-icon--small wf-icon--primary" }, "sparkles");
  _e1.appendChild(_e2);
  const _e3 = WF.h("p", { className: "wf-text wf-text--bold" }, "I code with AI — intentionally");
  _e1.appendChild(_e3);
  _e1.style.marginBottom = "6px";
  _e0.appendChild(_e1);
  const _e4 = WF.h("p", { className: "wf-text" }, "95% of my code is now written with AI assistance. I treat it as a force multiplier: I architect, review, and own the output — the AI accelerates execution. The results speak for themselves: a Rust image service that improved performance by 98%, a compiler built with WebFluent, and production systems running across MENA and Africa.");
  _e0.appendChild(_e4);
  _e0.style.background = "var(--color-surface-alt)";
  _e0.style.border = "0.5px solid var(--color-border)";
  _e0.style.borderLeft = "2px solid var(--color-primary)";
  _e0.style.borderRadius = "0 8px 8px 0";
  _e0.style.padding = "1.1rem 1.25rem";
  _frag.appendChild(_e0);
  return _frag;
}

function Component_SiteFooter() {
  const _frag = document.createDocumentFragment();
  const _e5 = WF.h("hr", { className: "wf-divider" });
  _frag.appendChild(_e5);
  const _e6 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e7 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "© 2026 Monzer Omer");
  _e7.style.fontFamily = "var(--font-family-mono)";
  _e6.appendChild(_e7);
  const _e8 = WF.h("div", { className: "wf-row wf-row--gap-lg" });
  const _e9 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e10 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "GitHub");
  _e9.appendChild(_e10);
  _e8.appendChild(_e9);
  const _e11 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://linkedin.com/in/monzeromer" });
  const _e12 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "LinkedIn");
  _e11.appendChild(_e12);
  _e8.appendChild(_e11);
  const _e13 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e14 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Email");
  _e13.appendChild(_e14);
  _e8.appendChild(_e13);
  _e6.appendChild(_e8);
  _e6.style.padding = "1.5rem 0 0";
  _frag.appendChild(_e6);
  return _frag;
}

function Component_SiteNav() {
  const _frag = document.createDocumentFragment();
  WF.effect(() => {
    eval((((((((((((((((((((("var l = document.getElementById('wf-tabler'); " + "var fn = function() { ") + "  document.querySelectorAll('.wf-icon').forEach(function(el) { ") + "    var name = el.textContent.trim(); ") + "    if (name) { ") + "      var i = document.createElement('i'); ") + "      i.className = 'ti ti-' + name; ") + "      if (el.style.cssText) { i.style.cssText = el.style.cssText; } ") + "      el.replaceWith(i); ") + "    } ") + "  }); ") + "}; ") + "if (!l) { ") + "  l = document.createElement('link'); l.id = 'wf-tabler'; l.rel = 'stylesheet'; ") + "  l.href = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css'; ") + "  l.onload = fn; ") + "  l.onerror = fn; ") + "  document.head.appendChild(l); ") + "} ") + "fn(); ") + "setTimeout(fn, 0);"));
  });
  WF.effect(() => {
    eval((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((("if (!document.getElementById('wf-mobile-styles')) { " + "  var s = document.createElement('style'); s.id = 'wf-mobile-styles'; ") + "  s.textContent = ") + "    ':root { --color-surface-alt: #F1F5F9; } ") + "    @media (max-width: 768px) { ") + "      .wf-row { flex-direction: row !important; flex-wrap: wrap; } ") + "      .wf-container { max-width: 100% !important; padding-left: 16px; padding-right: 16px; } ") + "      h1.wf-heading, .wf-heading--h1 { font-size: 28px !important; line-height: 1.2 !important; } ") + "      h2.wf-heading, .wf-heading--h2 { font-size: 24px !important; line-height: 1.25 !important; } ") + "      h3.wf-heading, .wf-heading--h3 { font-size: var(--font-size-xl) !important; } ") + "      .wf-navbar { flex-wrap: wrap; margin-bottom: 1.5rem; padding: 0.75rem 0; } ") + "      .wf-navbar > .wf-btn--small { display: inline-flex !important; margin-left: auto; border: none; background: none; font-size: 1.5rem; padding: 0; color: var(--color-text-muted); min-width: 44px; min-height: 44px; align-items: center; justify-content: center; border-radius: 8px; } ") + "      .wf-navbar > .wf-btn--small:active { background: var(--color-surface-alt); } ") + "      .wf-navbar .wf-navbar__links { display: none; } ") + "      .wf-navbar .wf-navbar__brand { width: auto; } ") + "      .wf-navbar__actions { display: none; } ") + "      .wf-navbar .wf-row { flex-direction: row !important; flex-wrap: nowrap; } ") + "      .wf-grid { grid-template-columns: repeat(2, 1fr) !important; gap: var(--spacing-sm); } ") + "      .wf-card { padding: 1rem !important; } ") + "      .wf-sidebar { display: none; } ") + "      pre.wf-code { font-size: var(--font-size-xs); overflow-x: auto; } ") + "    } ") + "    @media (max-width: 480px) { ") + "      .wf-grid { grid-template-columns: 1fr !important; } ") + "      h1.wf-heading, .wf-heading--h1 { font-size: 24px !important; } ") + "      h2.wf-heading, .wf-heading--h2 { font-size: 20px !important; } ") + "      .wf-container { padding-left: 12px; padding-right: 12px; } ") + "      .wf-navbar { margin-bottom: 1.2rem; padding: 0.6rem 0; } ") + "      body { font-size: var(--font-size-sm); } ") + "      .wf-stack > .wf-row:has(> .wf-btn) { flex-direction: column !important; } ") + "      .wf-stack > .wf-row:has(> .wf-btn) > .wf-btn { width: 100%; } ") + "      .wf-card { padding: 0.75rem !important; } ") + "    } ") + "    @media (min-width: 769px) { ") + "      #wf-mobile-backdrop { display: none !important; } ") + "      #wf-mobile-drawer { display: none !important; } ") + "    }'; ") + "  document.head.appendChild(s); ") + "} ") + "if (!document.getElementById('wf-mobile-drawer')) { ") + "  var bd = document.createElement('div'); bd.id = 'wf-mobile-backdrop'; ") + "  bd.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:998;transition:opacity 0.2s ease;opacity:0;'; ") + "  document.body.appendChild(bd); ") + "  var dr = document.createElement('div'); dr.id = 'wf-mobile-drawer'; ") + "  dr.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--color-surface);border-radius:16px 16px 0 0;z-index:999;transform:translateY(100%);transition:transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);box-shadow:0 -8px 24px rgba(0,0,0,0.12);padding:0 0 env(safe-area-inset-bottom, 20px);'; ") + "  var hd = document.createElement('div'); ") + "  hd.style.cssText = 'width:32px;height:4px;background:var(--color-border);border-radius:2px;margin:12px auto 4px;'; ") + "  dr.appendChild(hd); ") + "  var closeBtn = document.createElement('button'); ") + "  closeBtn.textContent = '×'; ") + "  closeBtn.setAttribute('aria-label', 'Close navigation'); ") + "  closeBtn.style.cssText = 'position:absolute;top:2px;right:8px;background:none;border:none;font-size:24px;cursor:pointer;color:var(--color-text-muted);min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;line-height:1;'; ") + "  closeBtn.onclick = function(){ closeMobileNav(); }; ") + "  dr.appendChild(closeBtn); ") + "  var pages = [ 'Home', '/', 'Projects', '/projects', 'Experience', '/experience', 'Skills', '/skills', 'Education', '/education', 'Contact', '/contact' ]; ") + "  for (var i = 0; i < pages.length; i += 2) { ") + "    var a = document.createElement('a'); ") + "    a.href = pages[i + 1]; ") + "    a.textContent = pages[i]; ") + "    var isActive = (window.location.pathname === pages[i + 1]) || (pages[i + 1] !== '/' && window.location.pathname.startsWith(pages[i + 1])); ") + "    a.style.cssText = 'display:flex;align-items:center;padding:14px 20px;min-height:48px;color:var(--color-text);text-decoration:none;font-size:16px;border-bottom:0.5px solid var(--color-border);font-weight:' + (isActive ? '600' : '400') + ';'; ") + "    a.onclick = function(){ closeMobileNav(); }; ") + "    dr.appendChild(a); ") + "  } ") + "  document.body.appendChild(dr); ") + "  bd.onclick = function(){ closeMobileNav(); }; ") + "  window.closeMobileNav = function() { ") + "    var _bd = document.getElementById('wf-mobile-backdrop'); ") + "    var _dr = document.getElementById('wf-mobile-drawer'); ") + "    _bd.style.opacity = '0'; ") + "    _dr.style.transform = 'translateY(100%)'; ") + "    setTimeout(function() { _bd.style.display = 'none'; }, 260); ") + "  }; ") + "  window.openMobileNav = function() { ") + "    var _bd = document.getElementById('wf-mobile-backdrop'); ") + "    var _dr = document.getElementById('wf-mobile-drawer'); ") + "    _bd.style.display = 'block'; ") + "    requestAnimationFrame(function() { ") + "      _bd.style.opacity = '1'; ") + "      _dr.style.transform = 'translateY(0)'; ") + "    }); ") + "  }; ") + "}"));
  });
  const _e15 = WF.h("nav", { className: "wf-navbar" });
  const _e16 = WF.h("div", { className: "wf-navbar__brand" });
  const _e17 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e18 = WF.h("div", { className: "wf-row" });
  const _e19 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer");
  _e19.style.fontFamily = "var(--font-family-mono)";
  _e18.appendChild(_e19);
  const _e20 = WF.h("p", { className: "wf-text wf-text--primary" }, ".omer");
  _e20.style.fontFamily = "var(--font-family-mono)";
  _e18.appendChild(_e20);
  _e18.style.flexWrap = "nowrap";
  _e18.style.gap = "0";
  _e17.appendChild(_e18);
  _e16.appendChild(_e17);
  _e15.appendChild(_e16);
  const _e21 = WF.h("button", { className: "wf-btn wf-btn--small", "on:click": (e) => { eval("var nav = e.currentTarget.closest('.wf-navbar'); if (!nav.classList.contains('wf-navbar--open')) { nav.classList.add('wf-navbar--open'); openMobileNav(); } else { nav.classList.remove('wf-navbar--open'); closeMobileNav(); }"); } }, "☰");
  _e21.style.display = "none";
  _e15.appendChild(_e21);
  const _e22 = WF.h("div", { className: "wf-navbar__links" });
  const _e23 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e24 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "projects");
  _e23.appendChild(_e24);
  _e22.appendChild(_e23);
  const _e25 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e26 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "experience");
  _e25.appendChild(_e26);
  _e22.appendChild(_e25);
  const _e27 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills" });
  const _e28 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "skills");
  _e27.appendChild(_e28);
  _e22.appendChild(_e27);
  const _e29 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e30 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "contact");
  _e29.appendChild(_e30);
  _e22.appendChild(_e29);
  _e15.appendChild(_e22);
  _e15.style.borderBottom = "0.5px solid var(--color-border)";
  _e15.style.padding = "1.25rem 0";
  _e15.style.marginBottom = "2.5rem";
  _frag.appendChild(_e15);
  return _frag;
}

function Component_AIBadge() {
  const _frag = document.createDocumentFragment();
  const _e31 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-sm" });
  const _e32 = WF.h("i", { className: "wf-icon wf-icon--small wf-icon--primary" }, "cpu");
  _e31.appendChild(_e32);
  const _e33 = WF.h("p", { className: "wf-text wf-text--small wf-text--primary" }, "AI-augmented workflow");
  _e33.style.fontFamily = "var(--font-family-mono)";
  _e31.appendChild(_e33);
  const _e34 = WF.h("div", { className: "wf-row wf-row--gap-xs wf-row--center" });
  const _e35 = WF.h("div", { className: "wf-stack" });
  _e35.style.width = "42px";
  _e35.style.height = "3px";
  _e35.style.background = "var(--color-primary)";
  _e35.style.borderRadius = "2px";
  _e34.appendChild(_e35);
  const _e36 = WF.h("div", { className: "wf-stack" });
  _e36.style.width = "2px";
  _e36.style.height = "3px";
  _e36.style.background = "var(--color-muted)";
  _e36.style.borderRadius = "2px";
  _e36.style.opacity = "0.4";
  _e34.appendChild(_e36);
  const _e37 = WF.h("p", { className: "wf-text wf-text--small wf-text--primary wf-text--bold" }, "95%");
  _e37.style.fontFamily = "var(--font-family-mono)";
  _e34.appendChild(_e37);
  _e31.appendChild(_e34);
  _e31.style.display = "inline-flex";
  _e31.style.flexWrap = "wrap";
  _e31.style.border = "0.5px solid var(--color-primary)";
  _e31.style.background = "rgba(37,99,235,0.08)";
  _e31.style.borderRadius = "6px";
  _e31.style.padding = "7px 13px";
  _e31.classList.add("wf-s38");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s38 { padding: 6px 10px; gap: var(--spacing-xs); } } "; document.head.appendChild(_s); }
  _frag.appendChild(_e31);
  return _frag;
}

function Page_Contact(params) {
  const _root = document.createDocumentFragment();
  const _e39 = WF.h("div", { className: "wf-container" });
  const _e40 = Component_SiteNav({});
  _e39.appendChild(_e40);
  const _e41 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Let's build something robust.");
  _e41.style.marginBottom = "0.4rem";
  _e39.appendChild(_e41);
  const _e42 = WF.h("p", { className: "wf-text wf-text--muted" }, "Available for senior backend roles, architecture consulting, and high-impact engineering challenges.");
  _e42.style.marginBottom = "2.5rem";
  _e39.appendChild(_e42);
  const _e43 = WF.h("div", { className: "wf-stack wf-stack--gap-lg" });
  const _e44 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-md" });
  const _e45 = WF.h("i", { className: "wf-icon wf-icon--primary" }, "mail");
  _e45.style.fontSize = "1.5rem";
  _e45.style.flexShrink = "0";
  _e44.appendChild(_e45);
  const _e46 = WF.h("div", { className: "wf-stack" });
  const _e47 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Email");
  _e47.style.fontFamily = "var(--font-family-mono)";
  _e47.style.letterSpacing = "0.08em";
  _e46.appendChild(_e47);
  const _e48 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e49 = WF.h("p", { className: "wf-text wf-text--primary" }, "monzer.a.omer@gmail.com");
  _e48.appendChild(_e49);
  _e46.appendChild(_e48);
  _e44.appendChild(_e46);
  _e44.style.flexWrap = "nowrap";
  _e44.style.padding = "1rem 0";
  _e44.style.borderBottom = "0.5px solid var(--color-border)";
  _e43.appendChild(_e44);
  const _e50 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-md" });
  const _e51 = WF.h("i", { className: "wf-icon wf-icon--primary" }, "brand-linkedin");
  _e51.style.fontSize = "1.5rem";
  _e51.style.flexShrink = "0";
  _e50.appendChild(_e51);
  const _e52 = WF.h("div", { className: "wf-stack" });
  const _e53 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "LinkedIn");
  _e53.style.fontFamily = "var(--font-family-mono)";
  _e53.style.letterSpacing = "0.08em";
  _e52.appendChild(_e53);
  const _e54 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://linkedin.com/in/monzeromer" });
  const _e55 = WF.h("p", { className: "wf-text wf-text--primary" }, "linkedin.com/in/monzeromer");
  _e54.appendChild(_e55);
  _e52.appendChild(_e54);
  _e50.appendChild(_e52);
  _e50.style.flexWrap = "nowrap";
  _e50.style.padding = "1rem 0";
  _e50.style.borderBottom = "0.5px solid var(--color-border)";
  _e43.appendChild(_e50);
  const _e56 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-md" });
  const _e57 = WF.h("i", { className: "wf-icon wf-icon--primary" }, "brand-github");
  _e57.style.fontSize = "1.5rem";
  _e57.style.flexShrink = "0";
  _e56.appendChild(_e57);
  const _e58 = WF.h("div", { className: "wf-stack" });
  const _e59 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "GitHub");
  _e59.style.fontFamily = "var(--font-family-mono)";
  _e59.style.letterSpacing = "0.08em";
  _e58.appendChild(_e59);
  const _e60 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab" });
  const _e61 = WF.h("p", { className: "wf-text wf-text--primary" }, "github.com/monzeromer-lab");
  _e60.appendChild(_e61);
  _e58.appendChild(_e60);
  _e56.appendChild(_e58);
  _e56.style.flexWrap = "nowrap";
  _e56.style.padding = "1rem 0";
  _e43.appendChild(_e56);
  _e39.appendChild(_e43);
  const _e62 = WF.h("div", { className: "wf-spacer" });
  _e39.appendChild(_e62);
  const _e63 = WF.h("div", { className: "wf-stack" });
  const _e64 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Working with me");
  _e64.style.marginBottom = "4px";
  _e63.appendChild(_e64);
  const _e65 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "I move fast. 95% of my coding workflow is AI-assisted, which means I prototype quickly, iterate in hours not days, and deliver production-quality code without the usual overhead. If you value speed and quality together, we'll work well.");
  _e63.appendChild(_e65);
  _e63.style.background = "var(--color-surface-alt)";
  _e63.style.border = "0.5px solid var(--color-border)";
  _e63.style.borderLeft = "2px solid var(--color-primary)";
  _e63.style.borderRadius = "0 8px 8px 0";
  _e63.style.padding = "1rem 1.25rem";
  _e39.appendChild(_e63);
  const _e66 = Component_SiteFooter({});
  _e39.appendChild(_e66);
  _e39.style.maxWidth = "860px";
  _root.appendChild(_e39);
  return _root;
}

function Page_Projects(params) {
  const _root = document.createDocumentFragment();
  const _e67 = WF.h("div", { className: "wf-container" });
  const _e68 = Component_SiteNav({});
  _e67.appendChild(_e68);
  const _e69 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Projects");
  _e69.style.marginBottom = "0.4rem";
  _e67.appendChild(_e69);
  const _e70 = WF.h("p", { className: "wf-text wf-text--muted" }, "Things I've designed, built, and shipped.");
  _e70.style.marginBottom = "2.5rem";
  _e67.appendChild(_e70);
  const _e71 = WF.h("div", { className: "wf-stack" });
  const _e72 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e73 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/WebFluent" });
  const _e74 = WF.h("p", { className: "wf-text wf-text--bold" }, "WebFluent");
  _e74.style.fontSize = "18px";
  _e73.appendChild(_e74);
  _e72.appendChild(_e73);
  const _e75 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Flagship");
  _e72.appendChild(_e75);
  _e72.style.marginBottom = "0.5rem";
  _e71.appendChild(_e72);
  const _e76 = WF.h("p", { className: "wf-text" }, "A web-first programming language that compiles to HTML, CSS, JavaScript, and PDF.");
  _e76.style.marginBottom = "0.75rem";
  _e71.appendChild(_e76);
  const _e77 = WF.h("p", { className: "wf-text" }, "WebFluent replaces the traditional web stack with a single, expressive language. It features reactive state, declarative UI components, built-in routing, i18n, SSG, and PDF output — all from .wf source files. This portfolio is built entirely with WebFluent.");
  _e71.appendChild(_e77);
  const _e78 = WF.h("div", { className: "wf-spacer" });
  _e71.appendChild(_e78);
  const _e79 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Key features:");
  _e79.style.marginBottom = "4px";
  _e71.appendChild(_e79);
  const _e80 = WF.h("ul", { className: "wf-list" });
  const _e81 = WF.h("p", { className: "wf-text" }, "Reactive state with automatic UI updates");
  _e80.appendChild(_e81);
  const _e82 = WF.h("p", { className: "wf-text" }, "Full component library — layout, forms, navigation, data display");
  _e80.appendChild(_e82);
  const _e83 = WF.h("p", { className: "wf-text" }, "Static site generation with JS hydration");
  _e80.appendChild(_e83);
  const _e84 = WF.h("p", { className: "wf-text" }, "PDF compilation with page layout, headers, footers");
  _e80.appendChild(_e84);
  const _e85 = WF.h("p", { className: "wf-text" }, "Built-in i18n with automatic RTL support");
  _e80.appendChild(_e85);
  _e71.appendChild(_e80);
  const _e86 = WF.h("div", { className: "wf-spacer" });
  _e71.appendChild(_e86);
  const _e87 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e88 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e87.appendChild(_e88);
  const _e89 = WF.h("span", { className: "wf-badge" }, "Compiler Design");
  _e87.appendChild(_e89);
  const _e90 = WF.h("span", { className: "wf-badge" }, "Language Design");
  _e87.appendChild(_e90);
  const _e91 = WF.h("span", { className: "wf-badge" }, "PDF Generation");
  _e87.appendChild(_e91);
  _e71.appendChild(_e87);
  _e71.style.borderBottom = "0.5px solid var(--color-border)";
  _e71.style.paddingBottom = "2rem";
  _e71.style.marginBottom = "2rem";
  _e67.appendChild(_e71);
  const _e92 = WF.h("div", { className: "wf-stack" });
  const _e93 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e94 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://www.circles.clinic/ar/" });
  const _e95 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e95.style.fontSize = "18px";
  _e94.appendChild(_e95);
  _e93.appendChild(_e94);
  const _e96 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Team Lead");
  _e93.appendChild(_e96);
  _e93.style.marginBottom = "0.5rem";
  _e92.appendChild(_e93);
  const _e97 = WF.h("p", { className: "wf-text" }, "A comprehensive business operating system for small and medium clinics.");
  _e97.style.marginBottom = "0.75rem";
  _e92.appendChild(_e97);
  const _e98 = WF.h("p", { className: "wf-text" }, "Circles manages every aspect of clinic operations — from financials and patient scheduling to HIPAA-compliant EMR, telehealth, AI-powered diagnostics, multi-branch support, and branded patient apps. Available across MENA and Africa through local partners.");
  _e92.appendChild(_e98);
  const _e99 = WF.h("div", { className: "wf-spacer" });
  _e92.appendChild(_e99);
  const _e100 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e101 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e100.appendChild(_e101);
  const _e102 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e100.appendChild(_e102);
  const _e103 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e100.appendChild(_e103);
  const _e104 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e100.appendChild(_e104);
  _e92.appendChild(_e100);
  _e92.style.borderBottom = "0.5px solid var(--color-border)";
  _e92.style.paddingBottom = "2rem";
  _e92.style.marginBottom = "2rem";
  _e67.appendChild(_e92);
  const _e105 = WF.h("div", { className: "wf-stack" });
  const _e106 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e107 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://platform.alhakeem.app/" });
  const _e108 = WF.h("p", { className: "wf-text wf-text--bold" }, "Al-Hakeem");
  _e108.style.fontSize = "18px";
  _e107.appendChild(_e108);
  _e106.appendChild(_e107);
  const _e109 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Engineering Lead");
  _e106.appendChild(_e109);
  _e106.style.marginBottom = "0.5rem";
  _e105.appendChild(_e106);
  const _e110 = WF.h("p", { className: "wf-text" }, "A healthcare platform connecting physicians with medical services.");
  _e110.style.marginBottom = "0.75rem";
  _e105.appendChild(_e110);
  const _e111 = WF.h("p", { className: "wf-text" }, "Al-Hakeem streamlines physician onboarding and medical service delivery. The platform supports bilingual operation in Arabic and English, serving healthcare professionals across the region with credential management and service coordination.");
  _e105.appendChild(_e111);
  const _e112 = WF.h("div", { className: "wf-spacer" });
  _e105.appendChild(_e112);
  const _e113 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e114 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e113.appendChild(_e114);
  const _e115 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e113.appendChild(_e115);
  const _e116 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e113.appendChild(_e116);
  _e105.appendChild(_e113);
  _e105.style.borderBottom = "0.5px solid var(--color-border)";
  _e105.style.paddingBottom = "2rem";
  _e105.style.marginBottom = "2rem";
  _e67.appendChild(_e105);
  const _e117 = WF.h("div", { className: "wf-stack" });
  const _e118 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e119 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://dabdoob.com/" });
  const _e120 = WF.h("p", { className: "wf-text wf-text--bold" }, "Dabdoob");
  _e120.style.fontSize = "18px";
  _e119.appendChild(_e120);
  _e118.appendChild(_e119);
  const _e121 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Featured");
  _e118.appendChild(_e121);
  _e118.style.marginBottom = "0.5rem";
  _e117.appendChild(_e118);
  const _e122 = WF.h("p", { className: "wf-text" }, "A mobile-first e-commerce platform serving the Middle East.");
  _e122.style.marginBottom = "0.75rem";
  _e117.appendChild(_e122);
  const _e123 = WF.h("p", { className: "wf-text" }, "Dabdoob is a cross-platform shopping application available on iOS and Android, operating across Kuwait, Saudi Arabia, UAE, Qatar, and Bahrain. The platform delivers exclusive deals and a seamless mobile shopping experience across the GCC region.");
  _e117.appendChild(_e123);
  const _e124 = WF.h("div", { className: "wf-spacer" });
  _e117.appendChild(_e124);
  const _e125 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e126 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e125.appendChild(_e126);
  const _e127 = WF.h("span", { className: "wf-badge" }, "E-Commerce");
  _e125.appendChild(_e127);
  const _e128 = WF.h("span", { className: "wf-badge" }, "Mobile");
  _e125.appendChild(_e128);
  _e117.appendChild(_e125);
  _e117.style.borderBottom = "0.5px solid var(--color-border)";
  _e117.style.paddingBottom = "2rem";
  _e117.style.marginBottom = "2rem";
  _e67.appendChild(_e117);
  const _e129 = WF.h("div", { className: "wf-stack" });
  const _e130 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e131 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/sys-voice-daemon" });
  const _e132 = WF.h("p", { className: "wf-text wf-text--bold" }, "sys-voice-daemon");
  _e132.style.fontSize = "18px";
  _e131.appendChild(_e132);
  _e130.appendChild(_e131);
  const _e133 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e130.appendChild(_e133);
  _e130.style.marginBottom = "0.5rem";
  _e129.appendChild(_e130);
  const _e134 = WF.h("p", { className: "wf-text" }, "Privacy-first, offline voice-to-text daemon for Linux.");
  _e134.style.marginBottom = "0.75rem";
  _e129.appendChild(_e134);
  const _e135 = WF.h("p", { className: "wf-text" }, "A system-level daemon that automatically detects active text fields and injects transcriptions into any window. Uses a kernel-level virtual keyboard via uinput for seamless, privacy-respecting voice input — entirely offline with no cloud dependency.");
  _e129.appendChild(_e135);
  const _e136 = WF.h("div", { className: "wf-spacer" });
  _e129.appendChild(_e136);
  const _e137 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e138 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e137.appendChild(_e138);
  const _e139 = WF.h("span", { className: "wf-badge" }, "Linux");
  _e137.appendChild(_e139);
  const _e140 = WF.h("span", { className: "wf-badge" }, "uinput");
  _e137.appendChild(_e140);
  const _e141 = WF.h("span", { className: "wf-badge" }, "Systems");
  _e137.appendChild(_e141);
  _e129.appendChild(_e137);
  _e129.style.borderBottom = "0.5px solid var(--color-border)";
  _e129.style.paddingBottom = "2rem";
  _e129.style.marginBottom = "2rem";
  _e67.appendChild(_e129);
  const _e142 = WF.h("div", { className: "wf-stack" });
  const _e143 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e144 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/rubik-cube-trainer" });
  const _e145 = WF.h("p", { className: "wf-text wf-text--bold" }, "rubiks-trainer");
  _e145.style.fontSize = "18px";
  _e144.appendChild(_e145);
  _e143.appendChild(_e144);
  const _e146 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e143.appendChild(_e146);
  _e143.style.marginBottom = "0.5rem";
  _e142.appendChild(_e143);
  const _e147 = WF.h("p", { className: "wf-text" }, "A virtual 3D Rubik's cube game and speedcubing trainer built in Rust.");
  _e147.style.marginBottom = "0.75rem";
  _e142.appendChild(_e147);
  const _e148 = WF.h("p", { className: "wf-text" }, "Supports 2×2, 3×3, 4×4, and 5×5 cubes with custom-built solvers written from scratch — no external solver crates. Features a progressive learning track from beginner LBL through advanced CFOP, plus a daily-use timer and drill mode designed for speedcubers.");
  _e142.appendChild(_e148);
  const _e149 = WF.h("div", { className: "wf-spacer" });
  _e142.appendChild(_e149);
  const _e150 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e151 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e150.appendChild(_e151);
  const _e152 = WF.h("span", { className: "wf-badge" }, "Bevy");
  _e150.appendChild(_e152);
  const _e153 = WF.h("span", { className: "wf-badge" }, "3D Graphics");
  _e150.appendChild(_e153);
  const _e154 = WF.h("span", { className: "wf-badge" }, "Algorithms");
  _e150.appendChild(_e154);
  _e142.appendChild(_e150);
  _e142.style.borderBottom = "0.5px solid var(--color-border)";
  _e142.style.paddingBottom = "2rem";
  _e142.style.marginBottom = "2rem";
  _e67.appendChild(_e142);
  const _e155 = WF.h("div", { className: "wf-stack" });
  const _e156 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e157 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/oxide-explorer" });
  const _e158 = WF.h("p", { className: "wf-text wf-text--bold" }, "Oxide Explorer");
  _e158.style.fontSize = "18px";
  _e157.appendChild(_e158);
  _e156.appendChild(_e157);
  const _e159 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e156.appendChild(_e159);
  _e156.style.marginBottom = "0.5rem";
  _e155.appendChild(_e156);
  const _e160 = WF.h("p", { className: "wf-text" }, "A blazing-fast, power-user-centric file manager built with Rust, GTK4, and libadwaita.");
  _e160.style.marginBottom = "0.75rem";
  _e155.appendChild(_e160);
  const _e161 = WF.h("p", { className: "wf-text" }, "Combines the visual elegance of GNOME Files with the advanced productivity features of Directory Opus and Total Commander. Designed for developers and power users who need dual-pane browsing, batch operations, and keyboard-driven workflows in a native Linux environment.");
  _e155.appendChild(_e161);
  const _e162 = WF.h("div", { className: "wf-spacer" });
  _e155.appendChild(_e162);
  const _e163 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e164 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e163.appendChild(_e164);
  const _e165 = WF.h("span", { className: "wf-badge" }, "GTK4");
  _e163.appendChild(_e165);
  const _e166 = WF.h("span", { className: "wf-badge" }, "libadwaita");
  _e163.appendChild(_e166);
  const _e167 = WF.h("span", { className: "wf-badge" }, "Linux Desktop");
  _e163.appendChild(_e167);
  _e155.appendChild(_e163);
  _e155.style.borderBottom = "0.5px solid var(--color-border)";
  _e155.style.paddingBottom = "2rem";
  _e155.style.marginBottom = "2rem";
  _e67.appendChild(_e155);
  const _e168 = WF.h("div", { className: "wf-stack" });
  const _e169 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e170 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/rust-mobile/xbuild" });
  const _e171 = WF.h("p", { className: "wf-text wf-text--bold" }, "xbuild");
  _e171.style.fontSize = "18px";
  _e170.appendChild(_e171);
  _e169.appendChild(_e170);
  const _e172 = WF.h("span", { className: "wf-badge" }, "Contribution");
  _e169.appendChild(_e172);
  _e169.style.marginBottom = "0.5rem";
  _e168.appendChild(_e169);
  const _e173 = WF.h("p", { className: "wf-text" }, "A build tool for Rust projects with cross-compilation and publishing to all major app stores.");
  _e173.style.marginBottom = "0.75rem";
  _e168.appendChild(_e173);
  const _e174 = WF.h("p", { className: "wf-text" }, "Contributed ARM 32-bit target support to xbuild, expanding the tool's cross-compilation reach to legacy and embedded ARM devices. xbuild aims to make native app development as easy as web development — build once, publish everywhere.");
  _e168.appendChild(_e174);
  const _e175 = WF.h("div", { className: "wf-spacer" });
  _e168.appendChild(_e175);
  const _e176 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e177 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e176.appendChild(_e177);
  const _e178 = WF.h("span", { className: "wf-badge" }, "Cross-Compilation");
  _e176.appendChild(_e178);
  const _e179 = WF.h("span", { className: "wf-badge" }, "ARM");
  _e176.appendChild(_e179);
  const _e180 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e176.appendChild(_e180);
  _e168.appendChild(_e176);
  _e168.style.borderBottom = "0.5px solid var(--color-border)";
  _e168.style.paddingBottom = "2rem";
  _e168.style.marginBottom = "2rem";
  _e67.appendChild(_e168);
  const _e181 = WF.h("div", { className: "wf-stack" });
  const _e182 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e183 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzeromer-lab/micro-kernel-backend" });
  const _e184 = WF.h("p", { className: "wf-text wf-text--bold" }, "Micro-kernel Architecture");
  _e184.style.fontSize = "18px";
  _e183.appendChild(_e184);
  _e182.appendChild(_e183);
  const _e185 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Tech Talk");
  _e182.appendChild(_e185);
  _e182.style.marginBottom = "0.5rem";
  _e181.appendChild(_e182);
  const _e186 = WF.h("p", { className: "wf-text" }, "A micro-kernel web backend where business logic lives in dynamically-loaded WebAssembly modules.");
  _e186.style.marginBottom = "0.75rem";
  _e181.appendChild(_e186);
  const _e187 = WF.h("p", { className: "wf-text" }, "The server core is intentionally minimal — routing, auth, and module lifecycle. All business logic runs in sandboxed WebAssembly modules that can be deployed, hot-swapped, rolled back, call external services, and call each other via an internal IPC layer. A demonstration of how micro-kernel principles apply to backend architecture.");
  _e181.appendChild(_e187);
  const _e188 = WF.h("div", { className: "wf-spacer" });
  _e181.appendChild(_e188);
  const _e189 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e190 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e189.appendChild(_e190);
  const _e191 = WF.h("span", { className: "wf-badge" }, "WebAssembly");
  _e189.appendChild(_e191);
  const _e192 = WF.h("span", { className: "wf-badge" }, "Systems Design");
  _e189.appendChild(_e192);
  const _e193 = WF.h("span", { className: "wf-badge" }, "Architecture");
  _e189.appendChild(_e193);
  _e181.appendChild(_e189);
  _e67.appendChild(_e181);
  const _e194 = Component_SiteFooter({});
  _e67.appendChild(_e194);
  _e67.style.maxWidth = "860px";
  _root.appendChild(_e67);
  return _root;
}

function Page_Experience(params) {
  const _root = document.createDocumentFragment();
  const _e195 = WF.h("div", { className: "wf-container" });
  const _e196 = Component_SiteNav({});
  _e195.appendChild(_e196);
  const _e197 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Experience");
  _e197.style.marginBottom = "0.4rem";
  _e195.appendChild(_e197);
  const _e198 = WF.h("p", { className: "wf-text wf-text--muted" }, "A reverse-chronological record of roles, responsibilities, and impact.");
  _e198.style.marginBottom = "2.5rem";
  _e195.appendChild(_e198);
  const _e199 = WF.h("div", { className: "wf-stack" });
  const _e200 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e201 = WF.h("p", { className: "wf-text wf-text--bold" }, "SilverKey Technologies");
  _e201.style.fontSize = "16px";
  _e200.appendChild(_e201);
  const _e202 = WF.h("span", { className: "wf-badge wf-badge--success" }, "Current");
  _e200.appendChild(_e202);
  _e199.appendChild(_e200);
  const _e203 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Mar 2025 — Present");
  _e203.style.fontFamily = "var(--font-family-mono)";
  _e203.style.marginBottom = "0.3rem";
  _e199.appendChild(_e203);
  const _e204 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Senior Node.js Developer");
  _e204.style.marginBottom = "0.75rem";
  _e199.appendChild(_e204);
  const _e205 = WF.h("ul", { className: "wf-list" });
  const _e206 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained core backend functionality to improve reliability and performance across web and mobile platforms.");
  _e205.appendChild(_e206);
  const _e207 = WF.h("p", { className: "wf-text" }, "Integrated Firebase Analytics, Adjust, and MoEngage to enable data-driven marketing and user engagement strategies.");
  _e205.appendChild(_e207);
  const _e208 = WF.h("p", { className: "wf-text" }, "Optimized product view endpoints and resolved crawler-related issues to enhance SEO and product discoverability.");
  _e205.appendChild(_e208);
  const _e209 = WF.h("p", { className: "wf-text" }, "Built a high-performance image processing microservice using Rust, achieving an average performance increase of over 98%.");
  _e205.appendChild(_e209);
  const _e210 = WF.h("p", { className: "wf-text" }, "Migrated the codebase to TypeScript, improving code maintainability, type safety, and long-term scalability.");
  _e205.appendChild(_e210);
  const _e211 = WF.h("p", { className: "wf-text" }, "Improved internal documentation and tooling, streamlining onboarding and enhancing cross-team collaboration.");
  _e205.appendChild(_e211);
  const _e212 = WF.h("p", { className: "wf-text" }, "Improved platform performance by optimizing queries and system design.");
  _e205.appendChild(_e212);
  _e199.appendChild(_e205);
  const _e213 = WF.h("div", { className: "wf-spacer" });
  _e199.appendChild(_e213);
  const _e214 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e215 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e214.appendChild(_e215);
  const _e216 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e214.appendChild(_e216);
  const _e217 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e214.appendChild(_e217);
  const _e218 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e214.appendChild(_e218);
  _e199.appendChild(_e214);
  _e199.style.borderBottom = "0.5px solid var(--color-border)";
  _e199.style.paddingBottom = "2rem";
  _e199.style.marginBottom = "2rem";
  _e195.appendChild(_e199);
  const _e219 = WF.h("div", { className: "wf-stack" });
  const _e220 = WF.h("p", { className: "wf-text wf-text--bold" }, "Ecom Payments");
  _e220.style.fontSize = "16px";
  _e219.appendChild(_e220);
  const _e221 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Aug 2024 — Feb 2025");
  _e221.style.fontFamily = "var(--font-family-mono)";
  _e221.style.marginBottom = "0.3rem";
  _e219.appendChild(_e221);
  const _e222 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Backend Developer");
  _e222.style.marginBottom = "0.75rem";
  _e219.appendChild(_e222);
  const _e223 = WF.h("ul", { className: "wf-list" });
  const _e224 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained high-performance, scalable microservices using NestJS, enabling seamless integration with front-end systems and third-party APIs.");
  _e223.appendChild(_e224);
  const _e225 = WF.h("p", { className: "wf-text" }, "Built and managed microservices for document generation, file storage, and file uploads, implementing AES encryption to ensure data security and compliance.");
  _e223.appendChild(_e225);
  const _e226 = WF.h("p", { className: "wf-text" }, "Developed a merchant management microservice to handle critical merchant data, including bank details, user information, payment methods, and fee structures.");
  _e223.appendChild(_e226);
  const _e227 = WF.h("p", { className: "wf-text" }, "Created a statistics microservice to calculate and analyze key metrics, providing actionable insights for business decision-making.");
  _e223.appendChild(_e227);
  const _e228 = WF.h("p", { className: "wf-text" }, "Utilized RabbitMQ for efficient message queuing and Docker for containerization, streamlining deployment processes and improving system reliability.");
  _e223.appendChild(_e228);
  _e219.appendChild(_e223);
  const _e229 = WF.h("div", { className: "wf-spacer" });
  _e219.appendChild(_e229);
  const _e230 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e231 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e230.appendChild(_e231);
  const _e232 = WF.h("span", { className: "wf-badge" }, "RabbitMQ");
  _e230.appendChild(_e232);
  const _e233 = WF.h("span", { className: "wf-badge" }, "Docker");
  _e230.appendChild(_e233);
  const _e234 = WF.h("span", { className: "wf-badge" }, "AES");
  _e230.appendChild(_e234);
  _e219.appendChild(_e230);
  _e219.style.borderBottom = "0.5px solid var(--color-border)";
  _e219.style.paddingBottom = "2rem";
  _e219.style.marginBottom = "2rem";
  _e195.appendChild(_e219);
  const _e235 = WF.h("div", { className: "wf-stack" });
  const _e236 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e236.style.fontSize = "16px";
  _e235.appendChild(_e236);
  const _e237 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Dec 2022 — Jan 2024");
  _e237.style.fontFamily = "var(--font-family-mono)";
  _e237.style.marginBottom = "0.3rem";
  _e235.appendChild(_e237);
  const _e238 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Backend Developer");
  _e238.style.marginBottom = "0.75rem";
  _e235.appendChild(_e238);
  const _e239 = WF.h("ul", { className: "wf-list" });
  const _e240 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained a highly scalable Healthcare Management System using a microservices architecture, leveraging GraphQL for optimized data fetching and Kafka for real-time data streaming and event-driven communication.");
  _e239.appendChild(_e240);
  const _e241 = WF.h("p", { className: "wf-text" }, "Built and enhanced a Community & Learning Platform to foster knowledge sharing and collaboration among users, ensuring seamless performance and scalability.");
  _e239.appendChild(_e241);
  const _e242 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers to deliver high-quality, user-centric features, ensuring smooth integration between backend services and frontend applications.");
  _e239.appendChild(_e242);
  const _e243 = WF.h("p", { className: "wf-text" }, "Continuously expanded technical expertise by mastering NestJS, Rust, and GraphQL, applying these technologies to optimize platform performance, reliability, and maintainability.");
  _e239.appendChild(_e243);
  _e235.appendChild(_e239);
  const _e244 = WF.h("div", { className: "wf-spacer" });
  _e235.appendChild(_e244);
  const _e245 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e246 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e245.appendChild(_e246);
  const _e247 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e245.appendChild(_e247);
  const _e248 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e245.appendChild(_e248);
  const _e249 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e245.appendChild(_e249);
  _e235.appendChild(_e245);
  _e235.style.borderBottom = "0.5px solid var(--color-border)";
  _e235.style.paddingBottom = "2rem";
  _e235.style.marginBottom = "2rem";
  _e195.appendChild(_e235);
  const _e250 = WF.h("div", { className: "wf-stack" });
  const _e251 = WF.h("p", { className: "wf-text wf-text--bold" }, "Alimny");
  _e251.style.fontSize = "16px";
  _e250.appendChild(_e251);
  const _e252 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Jan 2021 — Dec 2022");
  _e252.style.fontFamily = "var(--font-family-mono)";
  _e252.style.marginBottom = "0.3rem";
  _e250.appendChild(_e252);
  const _e253 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Backend Developer & Co-founder");
  _e253.style.marginBottom = "0.75rem";
  _e250.appendChild(_e253);
  const _e254 = WF.h("ul", { className: "wf-list" });
  const _e255 = WF.h("p", { className: "wf-text" }, "Co-founded a startup providing innovative and accessible e-learning solutions for students and teachers, using technologies such as web development, machine learning, and cloud computing.");
  _e254.appendChild(_e255);
  const _e256 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained server-side logic, APIs, and databases for web applications powering the e-learning platform using Node.js, Express.js, MongoDB, GraphQL, and Firebase.");
  _e254.appendChild(_e256);
  const _e257 = WF.h("p", { className: "wf-text" }, "Developed a robust authentication system using JWT and Firebase, and optimized database queries and indexes to improve response time and reduce server load.");
  _e254.appendChild(_e257);
  const _e258 = WF.h("p", { className: "wf-text" }, "Wrote unit tests and documentation for the codebase, and collaborated with co-founders and frontend developers to ensure application quality and performance.");
  _e254.appendChild(_e258);
  _e250.appendChild(_e254);
  const _e259 = WF.h("div", { className: "wf-spacer" });
  _e250.appendChild(_e259);
  const _e260 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e261 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e260.appendChild(_e261);
  const _e262 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e260.appendChild(_e262);
  const _e263 = WF.h("span", { className: "wf-badge" }, "Firebase");
  _e260.appendChild(_e263);
  const _e264 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e260.appendChild(_e264);
  _e250.appendChild(_e260);
  _e250.style.borderBottom = "0.5px solid var(--color-border)";
  _e250.style.paddingBottom = "2rem";
  _e250.style.marginBottom = "2rem";
  _e195.appendChild(_e250);
  const _e265 = WF.h("div", { className: "wf-stack" });
  const _e266 = WF.h("p", { className: "wf-text wf-text--bold" }, "EnayaTech");
  _e266.style.fontSize = "16px";
  _e265.appendChild(_e266);
  const _e267 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Feb 2020 — Jul 2020");
  _e267.style.fontFamily = "var(--font-family-mono)";
  _e267.style.marginBottom = "0.3rem";
  _e265.appendChild(_e267);
  const _e268 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Backend Developer");
  _e268.style.marginBottom = "0.75rem";
  _e265.appendChild(_e268);
  const _e269 = WF.h("ul", { className: "wf-list" });
  const _e270 = WF.h("p", { className: "wf-text" }, "Designed, developed, and maintained RESTful APIs using Express.js, MySQL, and MongoDB to support various web applications, gaining hands-on experience in backend development.");
  _e269.appendChild(_e270);
  const _e271 = WF.h("p", { className: "wf-text" }, "Collaborated closely with frontend developers, designers, and product managers to deliver high-quality features and seamless user experiences.");
  _e269.appendChild(_e271);
  const _e272 = WF.h("p", { className: "wf-text" }, "Actively learned and applied new technologies and tools, participated in code reviews, documentation, and testing processes to contribute to overall codebase quality.");
  _e269.appendChild(_e272);
  _e265.appendChild(_e269);
  const _e273 = WF.h("div", { className: "wf-spacer" });
  _e265.appendChild(_e273);
  const _e274 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e275 = WF.h("span", { className: "wf-badge" }, "Express.js");
  _e274.appendChild(_e275);
  const _e276 = WF.h("span", { className: "wf-badge" }, "MySQL");
  _e274.appendChild(_e276);
  const _e277 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e274.appendChild(_e277);
  _e265.appendChild(_e274);
  _e195.appendChild(_e265);
  const _e278 = Component_SiteFooter({});
  _e195.appendChild(_e278);
  _e195.style.maxWidth = "860px";
  _root.appendChild(_e195);
  return _root;
}

function Page_Education(params) {
  const _root = document.createDocumentFragment();
  const _e279 = WF.h("div", { className: "wf-container" });
  const _e280 = Component_SiteNav({});
  _e279.appendChild(_e280);
  const _e281 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Education");
  _e281.style.marginBottom = "2.5rem";
  _e279.appendChild(_e281);
  const _e282 = WF.h("div", { className: "wf-stack" });
  const _e283 = WF.h("p", { className: "wf-text wf-text--bold" }, "National Ribat University");
  _e283.style.fontSize = "18px";
  _e283.style.marginBottom = "2px";
  _e282.appendChild(_e283);
  const _e284 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Bachelor of Information Technology");
  _e284.style.marginBottom = "2px";
  _e282.appendChild(_e284);
  const _e285 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Oct 2018 — Feb 2025");
  _e285.style.fontFamily = "var(--font-family-mono)";
  _e282.appendChild(_e285);
  const _e286 = WF.h("div", { className: "wf-spacer" });
  _e282.appendChild(_e286);
  const _e287 = WF.h("p", { className: "wf-text" }, "Completed a comprehensive IT degree over nearly 7 years, overcoming challenges such as COVID-19, political unrest, and revolution. Gained expertise in programming fundamentals, data structures, software engineering, database management, system analysis, and network technologies.");
  _e282.appendChild(_e287);
  const _e288 = WF.h("div", { className: "wf-spacer" });
  _e282.appendChild(_e288);
  const _e289 = WF.h("p", { className: "wf-text wf-text--bold wf-text--small" }, "Highlights:");
  _e289.style.marginBottom = "4px";
  _e282.appendChild(_e289);
  const _e290 = WF.h("ul", { className: "wf-list" });
  const _e291 = WF.h("p", { className: "wf-text" }, "Developed practical skills through semester-long projects starting from Semester 3, applying theoretical knowledge to real-world IT solutions");
  _e290.appendChild(_e291);
  const _e292 = WF.h("p", { className: "wf-text" }, "Enhanced soft skills through courses in communication, research methodology, and professional ethics");
  _e290.appendChild(_e292);
  const _e293 = WF.h("p", { className: "wf-text" }, "Balanced academics with work experience, gaining hands-on industry insights and strengthening adaptability and time management");
  _e290.appendChild(_e293);
  const _e294 = WF.h("p", { className: "wf-text" }, "Built a strong foundation in IT, combining technical expertise with problem-solving and teamwork skills");
  _e290.appendChild(_e294);
  _e282.appendChild(_e290);
  const _e295 = WF.h("div", { className: "wf-spacer" });
  _e282.appendChild(_e295);
  const _e296 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Activities: GDSC, Open Days, Juniors Welcoming");
  _e282.appendChild(_e296);
  _e282.style.borderBottom = "0.5px solid var(--color-border)";
  _e282.style.paddingBottom = "2rem";
  _e282.style.marginBottom = "2rem";
  _e279.appendChild(_e282);
  const _e297 = WF.h("h2", { className: "wf-heading wf-heading--h2" }, "Certifications");
  _e297.style.marginBottom = "1.5rem";
  _e279.appendChild(_e297);
  const _e298 = WF.h("div", { className: "wf-stack" });
  const _e299 = WF.h("p", { className: "wf-text wf-text--bold" }, "Fundamentals of Backend Engineering");
  _e298.appendChild(_e299);
  const _e300 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Udemy — Aug 2025");
  _e300.style.fontFamily = "var(--font-family-mono)";
  _e300.style.marginBottom = "4px";
  _e298.appendChild(_e300);
  const _e301 = WF.h("p", { className: "wf-text" }, "Deep dive into the protocols and communication patterns that power modern backend systems.");
  _e298.appendChild(_e301);
  _e298.style.borderBottom = "0.5px solid var(--color-border)";
  _e298.style.paddingBottom = "1.5rem";
  _e298.style.marginBottom = "1.5rem";
  _e279.appendChild(_e298);
  const _e302 = WF.h("div", { className: "wf-stack" });
  const _e303 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e304 = WF.h("span", { className: "wf-badge" }, "Coursera");
  _e303.appendChild(_e304);
  const _e305 = WF.h("span", { className: "wf-badge" }, "2020");
  _e303.appendChild(_e305);
  _e302.appendChild(_e303);
  const _e306 = WF.h("div", { className: "wf-spacer" });
  _e302.appendChild(_e306);
  const _e307 = WF.h("p", { className: "wf-text wf-text--bold" }, "Server-side Development with NodeJS, Express and MongoDB");
  _e307.style.marginBottom = "4px";
  _e302.appendChild(_e307);
  const _e308 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Introduction to HTML5 · Interactivity with JavaScript · Front-End Web UI Frameworks: Bootstrap 4 · IT Project Management · Front-End Web Development with React · Introduction to TCP/IP · Introduction to CSS3 · Computer Security and Systems Management");
  _e308.style.lineHeight = "1.6";
  _e302.appendChild(_e308);
  _e279.appendChild(_e302);
  const _e309 = Component_SiteFooter({});
  _e279.appendChild(_e309);
  _e279.style.maxWidth = "860px";
  _root.appendChild(_e279);
  return _root;
}

function Page_Home(params) {
  const _twLines = WF.signal(["> specializing in Rust, Node.js, distributed systems", "> 6+ years shipping production-grade backends", "> building with AI — 95% of my workflow, intentionally", "> available for senior roles & architecture consulting"]);
  const _twIndex = WF.signal(0);
  const _twDisplay = WF.signal("");
  const _twCharIdx = WF.signal(0);
  const _twPhase = WF.signal("typing");
  const _root = document.createDocumentFragment();
  const _e310 = WF.h("div", { className: "wf-container" });
  const _e311 = Component_SiteNav({});
  _e310.appendChild(_e311);
  const _e312 = WF.h("div", { className: "wf-stack" });
  const _e313 = WF.h("div", { className: "wf-row wf-row--center wf-row--gap-xs" });
  const _e314 = WF.h("div", { className: "wf-stack" });
  _e314.style.flexShrink = "0";
  _e314.style.width = "8px";
  _e314.style.height = "8px";
  _e314.style.borderRadius = "50%";
  _e314.style.background = "var(--color-primary)";
  _e313.appendChild(_e314);
  const _e315 = WF.h("p", { className: "wf-text wf-text--small wf-text--primary wf-text--uppercase" }, "available for work");
  _e315.style.fontFamily = "var(--font-family-mono)";
  _e315.style.letterSpacing = "0.06em";
  _e313.appendChild(_e315);
  _e313.style.flexWrap = "nowrap";
  _e313.style.marginBottom = "1.1rem";
  _e313.style.fontFamily = "var(--font-family-mono)";
  _e312.appendChild(_e313);
  const _e316 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Monzer Omer");
  _e316.style.fontSize = "38px";
  _e316.style.fontWeight = "300";
  _e316.style.letterSpacing = "-0.03em";
  _e316.style.lineHeight = "1.15";
  _e316.style.marginBottom = "0.2rem";
  _e316.classList.add("wf-s317");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s317 { font-size: 32px; } } @media (max-width: 480px) { .wf-s317 { font-size: 28px; } } "; document.head.appendChild(_s); }
  _e312.appendChild(_e316);
  const _e318 = WF.h("h2", { className: "wf-heading wf-heading--h2" }, "Senior Backend Engineer");
  _e318.style.fontSize = "38px";
  _e318.style.fontWeight = "500";
  _e318.style.letterSpacing = "-0.03em";
  _e318.style.lineHeight = "1.15";
  _e318.style.marginBottom = "0.9rem";
  _e318.classList.add("wf-s319");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s319 { font-size: 28px; } } @media (max-width: 480px) { .wf-s319 { font-size: 24px; } } "; document.head.appendChild(_s); }
  _e312.appendChild(_e318);
  const _e320 = WF.h("div", { className: "wf-row wf-row--center" });
  const _e321 = WF.h("p", { className: "wf-text wf-text--muted" }, () => `${_twDisplay()}|`);
  _e321.style.fontFamily = "var(--font-family-mono)";
  _e320.appendChild(_e321);
  _e320.style.marginBottom = "1.6rem";
  _e312.appendChild(_e320);
  const _e322 = WF.h("p", { className: "wf-text" }, "Building scalable, resilient systems — with Rust, Node.js, and distributed architecture. I design for correctness and optimize for the long run.");
  _e322.style.fontSize = "15px";
  _e322.style.fontWeight = "300";
  _e322.style.lineHeight = "1.7";
  _e322.style.maxWidth = "540px";
  _e322.style.marginBottom = "1.8rem";
  _e322.classList.add("wf-s323");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 480px) { .wf-s323 { font-size: 14px; margin-bottom: 1.2rem; } } "; document.head.appendChild(_s); }
  _e312.appendChild(_e322);
  const _e324 = Component_AIBadge({});
  _e312.appendChild(_e324);
  const _e325 = WF.h("div", { className: "wf-spacer" });
  _e312.appendChild(_e325);
  const _e326 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e327 = WF.h("button", { className: "wf-btn wf-btn--primary", "on:click": (e) => { WF.navigate("/projects"); } }, "View projects");
  _e326.appendChild(_e327);
  const _e328 = WF.h("button", { className: "wf-btn", "on:click": (e) => { WF.navigate("/contact"); } }, "Get in touch");
  _e326.appendChild(_e328);
  _e312.appendChild(_e326);
  _e312.style.marginBottom = "3rem";
  _e312.classList.add("wf-s329");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s329 { margin-bottom: 2rem; } } @media (max-width: 480px) { .wf-s329 { margin-bottom: 1.5rem; } } "; document.head.appendChild(_s); }
  _e310.appendChild(_e312);
  const _e330 = WF.h("hr", { className: "wf-divider" });
  _e310.appendChild(_e330);
  const _e331 = Component_AICallout({});
  _e310.appendChild(_e331);
  const _e332 = WF.h("div", { className: "wf-spacer" });
  _e310.appendChild(_e332);
  const _e333 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Selected projects");
  _e333.style.fontFamily = "var(--font-family-mono)";
  _e333.style.letterSpacing = "0.12em";
  _e333.style.marginBottom = "1.2rem";
  _e310.appendChild(_e333);
  const _e334 = WF.h("div", { className: "wf-stack" });
  const _e335 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e336 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "01");
  _e336.style.fontFamily = "var(--font-family-mono)";
  _e336.style.minWidth = "24px";
  _e335.appendChild(_e336);
  const _e337 = WF.h("div", { className: "wf-stack" });
  const _e338 = WF.h("p", { className: "wf-text wf-text--bold" }, "WebFluent");
  _e337.appendChild(_e338);
  const _e339 = WF.h("p", { className: "wf-text" }, "A web-first language that compiles to HTML, CSS, JS, and PDF. This portfolio is built with it.");
  _e339.style.color = "var(--color-muted)";
  _e337.appendChild(_e339);
  const _e340 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e341 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Flagship");
  _e340.appendChild(_e341);
  const _e342 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e340.appendChild(_e342);
  const _e343 = WF.h("span", { className: "wf-badge" }, "Compiler Design");
  _e340.appendChild(_e343);
  _e340.style.marginTop = "8px";
  _e337.appendChild(_e340);
  _e335.appendChild(_e337);
  _e335.style.padding = "1rem 0";
  _e335.style.borderBottom = "0.5px solid var(--color-border)";
  _e334.appendChild(_e335);
  const _e344 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e345 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "02");
  _e345.style.fontFamily = "var(--font-family-mono)";
  _e345.style.minWidth = "24px";
  _e344.appendChild(_e345);
  const _e346 = WF.h("div", { className: "wf-stack" });
  const _e347 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e346.appendChild(_e347);
  const _e348 = WF.h("p", { className: "wf-text" }, "Business OS for clinics — EMR, telehealth, AI diagnostics, multi-branch. Live across MENA & Africa.");
  _e348.style.color = "var(--color-muted)";
  _e346.appendChild(_e348);
  const _e349 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e350 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e349.appendChild(_e350);
  const _e351 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e349.appendChild(_e351);
  const _e352 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e349.appendChild(_e352);
  _e349.style.marginTop = "8px";
  _e346.appendChild(_e349);
  _e344.appendChild(_e346);
  _e344.style.padding = "1rem 0";
  _e344.style.borderBottom = "0.5px solid var(--color-border)";
  _e334.appendChild(_e344);
  const _e353 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e354 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "03");
  _e354.style.fontFamily = "var(--font-family-mono)";
  _e354.style.minWidth = "24px";
  _e353.appendChild(_e354);
  const _e355 = WF.h("div", { className: "wf-stack" });
  const _e356 = WF.h("p", { className: "wf-text wf-text--bold" }, "sys-voice-daemon");
  _e355.appendChild(_e356);
  const _e357 = WF.h("p", { className: "wf-text" }, "Privacy-first offline voice-to-text for Linux. Kernel-level uinput injection, zero cloud dependency.");
  _e357.style.color = "var(--color-muted)";
  _e355.appendChild(_e357);
  const _e358 = WF.h("div", { className: "wf-row wf-row--gap-xs" });
  const _e359 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e358.appendChild(_e359);
  const _e360 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e358.appendChild(_e360);
  const _e361 = WF.h("span", { className: "wf-badge" }, "Linux");
  _e358.appendChild(_e361);
  _e358.style.marginTop = "8px";
  _e355.appendChild(_e358);
  _e353.appendChild(_e355);
  _e353.style.padding = "1rem 0";
  _e334.appendChild(_e353);
  _e310.appendChild(_e334);
  const _e362 = WF.h("div", { className: "wf-spacer" });
  _e310.appendChild(_e362);
  const _e363 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e364 = WF.h("p", { className: "wf-text wf-text--primary" }, "All projects →");
  _e363.appendChild(_e364);
  _e310.appendChild(_e363);
  const _e365 = Component_SiteFooter({});
  _e310.appendChild(_e365);
  _e310.style.maxWidth = "860px";
  _root.appendChild(_e310);
  WF.effect(() => {
    eval((((((((((((((((((((((((((((((("setTimeout(function tick() { " + "var lines = _twLines(); ") + "var idx = _twIndex(); ") + "var line = lines[idx]; ") + "var phase = _twPhase(); ") + "if (phase === 'typing') { ") + "var ci = _twCharIdx() + 1; ") + "_twCharIdx.set(ci); ") + "_twDisplay.set(line.slice(0, ci)); ") + "if (ci === line.length) { ") + "_twPhase.set('pausing'); ") + "setTimeout(tick, 2200); ") + "return; ") + "} ") + "setTimeout(tick, 38); ") + "} else if (phase === 'pausing') { ") + "_twPhase.set('deleting'); ") + "setTimeout(tick, 40); ") + "} else { ") + "var ci = _twCharIdx() - 1; ") + "_twCharIdx.set(ci); ") + "_twDisplay.set(line.slice(0, ci)); ") + "if (ci === 0) { ") + "_twIndex.set((idx + 1) % lines.length); ") + "_twPhase.set('typing'); ") + "setTimeout(tick, 320); ") + "return; ") + "} ") + "setTimeout(tick, 18); ") + "} ") + "}, 600)"));
  });
  return _root;
}

function Page_Skills(params) {
  const _root = document.createDocumentFragment();
  const _e366 = WF.h("div", { className: "wf-container" });
  const _e367 = Component_SiteNav({});
  _e366.appendChild(_e367);
  const _e368 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Infrastructure & Capabilities");
  _e368.style.marginBottom = "0.4rem";
  _e366.appendChild(_e368);
  const _e369 = WF.h("p", { className: "wf-text wf-text--muted" }, "Languages, frameworks, and systems I architect, build, and deploy with.");
  _e369.style.marginBottom = "2.5rem";
  _e366.appendChild(_e369);
  const _e370 = Component_AICallout({});
  _e366.appendChild(_e370);
  const _e371 = WF.h("div", { className: "wf-spacer" });
  _e366.appendChild(_e371);
  const _e372 = WF.h("div", { className: "wf-grid wf-grid--gap-md", style: { gridTemplateColumns: 'repeat(3, 1fr)' } });
  const _e373 = WF.h("div", { className: "wf-card" });
  const _e374 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "AI & Tooling");
  _e374.style.fontFamily = "var(--font-family-mono)";
  _e374.style.letterSpacing = "0.08em";
  _e374.style.marginBottom = "8px";
  _e373.appendChild(_e374);
  const _e375 = WF.h("ul", { className: "wf-list" });
  const _e376 = WF.h("p", { className: "wf-text" }, "Claude");
  _e375.appendChild(_e376);
  const _e377 = WF.h("p", { className: "wf-text" }, "Cursor");
  _e375.appendChild(_e377);
  const _e378 = WF.h("p", { className: "wf-text" }, "GitHub Copilot");
  _e375.appendChild(_e378);
  const _e379 = WF.h("p", { className: "wf-text" }, "LLM APIs");
  _e375.appendChild(_e379);
  _e373.appendChild(_e375);
  _e373.style.padding = "1.25rem";
  _e373.classList.add("wf-s380");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s380 { padding: 1rem; } } @media (max-width: 480px) { .wf-s380 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e373);
  const _e381 = WF.h("div", { className: "wf-card" });
  const _e382 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Languages");
  _e382.style.fontFamily = "var(--font-family-mono)";
  _e382.style.letterSpacing = "0.08em";
  _e382.style.marginBottom = "8px";
  _e381.appendChild(_e382);
  const _e383 = WF.h("ul", { className: "wf-list" });
  const _e384 = WF.h("p", { className: "wf-text" }, "Rust");
  _e383.appendChild(_e384);
  const _e385 = WF.h("p", { className: "wf-text" }, "TypeScript");
  _e383.appendChild(_e385);
  const _e386 = WF.h("p", { className: "wf-text" }, "JavaScript");
  _e383.appendChild(_e386);
  const _e387 = WF.h("p", { className: "wf-text" }, "SQL");
  _e383.appendChild(_e387);
  _e381.appendChild(_e383);
  _e381.style.padding = "1.25rem";
  _e381.classList.add("wf-s388");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s388 { padding: 1rem; } } @media (max-width: 480px) { .wf-s388 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e381);
  const _e389 = WF.h("div", { className: "wf-card" });
  const _e390 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Databases & Storage");
  _e390.style.fontFamily = "var(--font-family-mono)";
  _e390.style.letterSpacing = "0.08em";
  _e390.style.marginBottom = "8px";
  _e389.appendChild(_e390);
  const _e391 = WF.h("ul", { className: "wf-list" });
  const _e392 = WF.h("p", { className: "wf-text" }, "PostgreSQL");
  _e391.appendChild(_e392);
  const _e393 = WF.h("p", { className: "wf-text" }, "MySQL");
  _e391.appendChild(_e393);
  const _e394 = WF.h("p", { className: "wf-text" }, "MongoDB");
  _e391.appendChild(_e394);
  const _e395 = WF.h("p", { className: "wf-text" }, "Firebase");
  _e391.appendChild(_e395);
  const _e396 = WF.h("p", { className: "wf-text" }, "Redis");
  _e391.appendChild(_e396);
  _e389.appendChild(_e391);
  _e389.style.padding = "1.25rem";
  _e389.classList.add("wf-s397");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s397 { padding: 1rem; } } @media (max-width: 480px) { .wf-s397 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e389);
  const _e398 = WF.h("div", { className: "wf-card" });
  const _e399 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Messaging & Streaming");
  _e399.style.fontFamily = "var(--font-family-mono)";
  _e399.style.letterSpacing = "0.08em";
  _e399.style.marginBottom = "8px";
  _e398.appendChild(_e399);
  const _e400 = WF.h("ul", { className: "wf-list" });
  const _e401 = WF.h("p", { className: "wf-text" }, "Apache Kafka");
  _e400.appendChild(_e401);
  const _e402 = WF.h("p", { className: "wf-text" }, "RabbitMQ");
  _e400.appendChild(_e402);
  const _e403 = WF.h("p", { className: "wf-text" }, "Event-Driven Design");
  _e400.appendChild(_e403);
  const _e404 = WF.h("p", { className: "wf-text" }, "WebSocket");
  _e400.appendChild(_e404);
  const _e405 = WF.h("p", { className: "wf-text" }, "gRPC");
  _e400.appendChild(_e405);
  _e398.appendChild(_e400);
  _e398.style.padding = "1.25rem";
  _e398.classList.add("wf-s406");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s406 { padding: 1rem; } } @media (max-width: 480px) { .wf-s406 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e398);
  const _e407 = WF.h("div", { className: "wf-card" });
  const _e408 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Systems & Architecture");
  _e408.style.fontFamily = "var(--font-family-mono)";
  _e408.style.letterSpacing = "0.08em";
  _e408.style.marginBottom = "8px";
  _e407.appendChild(_e408);
  const _e409 = WF.h("ul", { className: "wf-list" });
  const _e410 = WF.h("p", { className: "wf-text" }, "Microservices Architecture");
  _e409.appendChild(_e410);
  const _e411 = WF.h("p", { className: "wf-text" }, "Distributed Systems");
  _e409.appendChild(_e411);
  const _e412 = WF.h("p", { className: "wf-text" }, "WebAssembly");
  _e409.appendChild(_e412);
  const _e413 = WF.h("p", { className: "wf-text" }, "System Design");
  _e409.appendChild(_e413);
  const _e414 = WF.h("p", { className: "wf-text" }, "Compiler Design");
  _e409.appendChild(_e414);
  _e407.appendChild(_e409);
  _e407.style.padding = "1.25rem";
  _e407.classList.add("wf-s415");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s415 { padding: 1rem; } } @media (max-width: 480px) { .wf-s415 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e407);
  const _e416 = WF.h("div", { className: "wf-card" });
  const _e417 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "DevOps & Infrastructure");
  _e417.style.fontFamily = "var(--font-family-mono)";
  _e417.style.letterSpacing = "0.08em";
  _e417.style.marginBottom = "8px";
  _e416.appendChild(_e417);
  const _e418 = WF.h("ul", { className: "wf-list" });
  const _e419 = WF.h("p", { className: "wf-text" }, "Docker");
  _e418.appendChild(_e419);
  const _e420 = WF.h("p", { className: "wf-text" }, "Nginx");
  _e418.appendChild(_e420);
  const _e421 = WF.h("p", { className: "wf-text" }, "Linux");
  _e418.appendChild(_e421);
  const _e422 = WF.h("p", { className: "wf-text" }, "CI/CD");
  _e418.appendChild(_e422);
  const _e423 = WF.h("p", { className: "wf-text" }, "Git");
  _e418.appendChild(_e423);
  _e416.appendChild(_e418);
  _e416.style.padding = "1.25rem";
  _e416.classList.add("wf-s424");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s424 { padding: 1rem; } } @media (max-width: 480px) { .wf-s424 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e416);
  const _e425 = WF.h("div", { className: "wf-card" });
  const _e426 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Frontend & Desktop");
  _e426.style.fontFamily = "var(--font-family-mono)";
  _e426.style.letterSpacing = "0.08em";
  _e426.style.marginBottom = "8px";
  _e425.appendChild(_e426);
  const _e427 = WF.h("ul", { className: "wf-list" });
  const _e428 = WF.h("p", { className: "wf-text" }, "React");
  _e427.appendChild(_e428);
  const _e429 = WF.h("p", { className: "wf-text" }, "React Native");
  _e427.appendChild(_e429);
  const _e430 = WF.h("p", { className: "wf-text" }, "Electron");
  _e427.appendChild(_e430);
  const _e431 = WF.h("p", { className: "wf-text" }, "Tauri");
  _e427.appendChild(_e431);
  const _e432 = WF.h("p", { className: "wf-text" }, "GTK4 / libadwaita");
  _e427.appendChild(_e432);
  _e425.appendChild(_e427);
  _e425.style.padding = "1.25rem";
  _e425.classList.add("wf-s433");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s433 { padding: 1rem; } } @media (max-width: 480px) { .wf-s433 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e425);
  const _e434 = WF.h("div", { className: "wf-card" });
  const _e435 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small wf-text--uppercase" }, "Security & Quality");
  _e435.style.fontFamily = "var(--font-family-mono)";
  _e435.style.letterSpacing = "0.08em";
  _e435.style.marginBottom = "8px";
  _e434.appendChild(_e435);
  const _e436 = WF.h("ul", { className: "wf-list" });
  const _e437 = WF.h("p", { className: "wf-text" }, "AES Encryption");
  _e436.appendChild(_e437);
  const _e438 = WF.h("p", { className: "wf-text" }, "JWT / OAuth");
  _e436.appendChild(_e438);
  const _e439 = WF.h("p", { className: "wf-text" }, "Unit Testing");
  _e436.appendChild(_e439);
  const _e440 = WF.h("p", { className: "wf-text" }, "Code Review");
  _e436.appendChild(_e440);
  const _e441 = WF.h("p", { className: "wf-text" }, "Agile / Scrum");
  _e436.appendChild(_e441);
  _e434.appendChild(_e436);
  _e434.style.padding = "1.25rem";
  _e434.classList.add("wf-s442");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s442 { padding: 1rem; } } @media (max-width: 480px) { .wf-s442 { padding: 0.875rem; } } "; document.head.appendChild(_s); }
  _e372.appendChild(_e434);
  _e372.classList.add("wf-s443");
  { const _s = document.createElement('style'); _s.textContent = "@media (max-width: 768px) { .wf-s443 { grid-template-columns: repeat(2, 1fr); gap: var(--spacing-sm); } } @media (max-width: 480px) { .wf-s443 { grid-template-columns: 1fr; } } "; document.head.appendChild(_s); }
  _e366.appendChild(_e372);
  const _e444 = Component_SiteFooter({});
  _e366.appendChild(_e444);
  _e366.style.maxWidth = "860px";
  _root.appendChild(_e366);
  return _root;
}

(function() {
  const routes = [
    { path: "/contact", render: (params) => Page_Contact(params) },
    { path: "/projects", render: (params) => Page_Projects(params) },
    { path: "/experience", render: (params) => Page_Experience(params) },
    { path: "/education", render: (params) => Page_Education(params) },
    { path: "/", render: (params) => Page_Home(params) },
    { path: "/skills", render: (params) => Page_Skills(params) },
  ];
  const container = document.getElementById('app');
  WF.createRouter(routes, container);
})();
