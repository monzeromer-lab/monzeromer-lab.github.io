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
        } else if (k === "disabled") {
          if (typeof v === "function") {
            effect(() => { el.disabled = v(); });
          } else {
            el.disabled = v;
          }
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
function Page_Education(params) {
  const _root = document.createDocumentFragment();
  const _e0 = WF.h("div", { className: "wf-container" });
  const _e1 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e2 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Education");
  _e2.style.fontSize = "2rem";
  _e2.style.fontWeight = "700";
  _e2.style.color = "#E8E6E1";
  _e2.style.letterSpacing = "-0.02em";
  _e2.style.marginBottom = "3rem";
  _e1.appendChild(_e2);
  const _e3 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e4 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e5 = WF.h("p", { className: "wf-text wf-text--bold" }, "National Ribat University");
  _e5.style.fontSize = "1.2rem";
  _e5.style.color = "#E8E6E1";
  _e4.appendChild(_e5);
  const _e6 = WF.h("p", { className: "wf-text" }, "Bachelor of Information Technology");
  _e6.style.color = "#E8E6E1";
  _e6.style.fontSize = "1rem";
  _e4.appendChild(_e6);
  const _e7 = WF.h("p", { className: "wf-text wf-text--muted" }, "Oct 2018 — Feb 2025");
  _e7.style.color = "#C69C6D";
  _e7.style.fontFamily = "JetBrains Mono, monospace";
  _e7.style.fontSize = "0.85rem";
  _e4.appendChild(_e7);
  _e3.appendChild(_e4);
  _e3.style.background = "#242422";
  _e3.style.border = "1px solid #2D2C2A";
  _e3.style.borderRadius = "0.75rem";
  _e3.style.padding = "2rem";
  _e1.appendChild(_e3);
  _e0.appendChild(_e1);
  _e0.style.maxWidth = "800px";
  _e0.style.margin = "0 auto";
  _e0.style.padding = "120px 2rem";
  _root.appendChild(_e0);
  return _root;
}

function Page_Experience(params) {
  const _root = document.createDocumentFragment();
  const _e8 = WF.h("div", { className: "wf-container" });
  const _e9 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e10 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Experience");
  _e10.style.fontSize = "2rem";
  _e10.style.fontWeight = "700";
  _e10.style.color = "#E8E6E1";
  _e10.style.letterSpacing = "-0.02em";
  _e10.style.marginBottom = "1rem";
  _e9.appendChild(_e10);
  const _e11 = WF.h("p", { className: "wf-text wf-text--muted" }, "A reverse-chronological record of impact and engineering decisions.");
  _e11.style.color = "#8C8B88";
  _e11.style.fontSize = "1rem";
  _e11.style.marginBottom = "3rem";
  _e9.appendChild(_e11);
  const _e12 = WF.h("div", { className: "wf-spacer" });
  _e9.appendChild(_e12);
  const _e13 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e14 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e15 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e16 = WF.h("p", { className: "wf-text wf-text--bold" }, "SilverKey Technologies");
  _e16.style.fontSize = "1.2rem";
  _e16.style.color = "#E8E6E1";
  _e15.appendChild(_e16);
  const _e17 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Mar 2025 — Present");
  _e17.style.color = "#C69C6D";
  _e17.style.fontFamily = "JetBrains Mono, monospace";
  _e17.style.fontSize = "0.8rem";
  _e15.appendChild(_e17);
  _e14.appendChild(_e15);
  const _e18 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Node.js Developer");
  _e18.style.color = "#8C8B88";
  _e18.style.fontSize = "0.95rem";
  _e14.appendChild(_e18);
  const _e19 = WF.h("div", { className: "wf-spacer" });
  _e14.appendChild(_e19);
  const _e20 = WF.h("p", { className: "wf-text" }, "Built a high-performance image processing microservice using Rust, achieving an average performance increase of over 98%. Led the migration of the existing codebase to TypeScript for improved maintainability and type safety. Optimized database queries and implemented caching strategies for critical data paths.");
  _e20.style.color = "#E8E6E1";
  _e20.style.lineHeight = "1.7";
  _e20.style.fontSize = "0.95rem";
  _e14.appendChild(_e20);
  const _e21 = WF.h("div", { className: "wf-spacer" });
  _e14.appendChild(_e21);
  const _e22 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e23 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e23.style.fontFamily = "JetBrains Mono, monospace";
  _e23.style.background = "#C69C6D";
  _e23.style.color = "#1A1A19";
  _e23.style.padding = "0.25rem 0.75rem";
  _e23.style.borderRadius = "0.375rem";
  _e23.style.fontSize = "0.75rem";
  _e23.style.fontWeight = "600";
  _e22.appendChild(_e23);
  const _e24 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e24.style.fontFamily = "JetBrains Mono, monospace";
  _e24.style.background = "#2D2C2A";
  _e24.style.color = "#E8E6E1";
  _e24.style.padding = "0.25rem 0.75rem";
  _e24.style.borderRadius = "0.375rem";
  _e24.style.fontSize = "0.75rem";
  _e22.appendChild(_e24);
  const _e25 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e25.style.fontFamily = "JetBrains Mono, monospace";
  _e25.style.background = "#2D2C2A";
  _e25.style.color = "#E8E6E1";
  _e25.style.padding = "0.25rem 0.75rem";
  _e25.style.borderRadius = "0.375rem";
  _e25.style.fontSize = "0.75rem";
  _e22.appendChild(_e25);
  _e14.appendChild(_e22);
  _e13.appendChild(_e14);
  _e13.style.background = "#242422";
  _e13.style.border = "1px solid #2D2C2A";
  _e13.style.borderRadius = "0.75rem";
  _e13.style.padding = "2rem";
  _e13.style.marginBottom = "2rem";
  _e9.appendChild(_e13);
  const _e26 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e27 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e28 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e29 = WF.h("p", { className: "wf-text wf-text--bold" }, "Ecom Payments");
  _e29.style.fontSize = "1.2rem";
  _e29.style.color = "#E8E6E1";
  _e28.appendChild(_e29);
  const _e30 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Aug 2024 — Feb 2025");
  _e30.style.color = "#C69C6D";
  _e30.style.fontFamily = "JetBrains Mono, monospace";
  _e30.style.fontSize = "0.8rem";
  _e28.appendChild(_e30);
  _e27.appendChild(_e28);
  const _e31 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Engineer");
  _e31.style.color = "#8C8B88";
  _e31.style.fontSize = "0.95rem";
  _e27.appendChild(_e31);
  const _e32 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e32);
  const _e33 = WF.h("p", { className: "wf-text" }, "Designed and implemented NestJS microservices architecture for payment processing. Integrated AES encryption for securing sensitive transaction data. Built robust message queuing infrastructure with RabbitMQ and containerized deployments using Docker.");
  _e33.style.color = "#E8E6E1";
  _e33.style.lineHeight = "1.7";
  _e33.style.fontSize = "0.95rem";
  _e27.appendChild(_e33);
  const _e34 = WF.h("div", { className: "wf-spacer" });
  _e27.appendChild(_e34);
  const _e35 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e36 = WF.h("span", { className: "wf-badge" }, "NestJS");
  _e36.style.fontFamily = "JetBrains Mono, monospace";
  _e36.style.background = "#2D2C2A";
  _e36.style.color = "#E8E6E1";
  _e36.style.padding = "0.25rem 0.75rem";
  _e36.style.borderRadius = "0.375rem";
  _e36.style.fontSize = "0.75rem";
  _e35.appendChild(_e36);
  const _e37 = WF.h("span", { className: "wf-badge" }, "RabbitMQ");
  _e37.style.fontFamily = "JetBrains Mono, monospace";
  _e37.style.background = "#2D2C2A";
  _e37.style.color = "#E8E6E1";
  _e37.style.padding = "0.25rem 0.75rem";
  _e37.style.borderRadius = "0.375rem";
  _e37.style.fontSize = "0.75rem";
  _e35.appendChild(_e37);
  const _e38 = WF.h("span", { className: "wf-badge" }, "Docker");
  _e38.style.fontFamily = "JetBrains Mono, monospace";
  _e38.style.background = "#2D2C2A";
  _e38.style.color = "#E8E6E1";
  _e38.style.padding = "0.25rem 0.75rem";
  _e38.style.borderRadius = "0.375rem";
  _e38.style.fontSize = "0.75rem";
  _e35.appendChild(_e38);
  const _e39 = WF.h("span", { className: "wf-badge" }, "AES");
  _e39.style.fontFamily = "JetBrains Mono, monospace";
  _e39.style.background = "#2D2C2A";
  _e39.style.color = "#E8E6E1";
  _e39.style.padding = "0.25rem 0.75rem";
  _e39.style.borderRadius = "0.375rem";
  _e39.style.fontSize = "0.75rem";
  _e35.appendChild(_e39);
  _e27.appendChild(_e35);
  _e26.appendChild(_e27);
  _e26.style.background = "#242422";
  _e26.style.border = "1px solid #2D2C2A";
  _e26.style.borderRadius = "0.75rem";
  _e26.style.padding = "2rem";
  _e26.style.marginBottom = "2rem";
  _e9.appendChild(_e26);
  const _e40 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e41 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e42 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e43 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e43.style.fontSize = "1.2rem";
  _e43.style.color = "#E8E6E1";
  _e42.appendChild(_e43);
  const _e44 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Dec 2022 — Jan 2024");
  _e44.style.color = "#C69C6D";
  _e44.style.fontFamily = "JetBrains Mono, monospace";
  _e44.style.fontSize = "0.8rem";
  _e42.appendChild(_e44);
  _e41.appendChild(_e42);
  const _e45 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Engineer");
  _e45.style.color = "#8C8B88";
  _e45.style.fontSize = "0.95rem";
  _e41.appendChild(_e45);
  const _e46 = WF.h("div", { className: "wf-spacer" });
  _e41.appendChild(_e46);
  const _e47 = WF.h("p", { className: "wf-text" }, "Architected microservices using GraphQL for flexible API composition and Apache Kafka for real-time data streaming across distributed services. Designed event-driven systems handling high-throughput data pipelines with fault tolerance and horizontal scalability.");
  _e47.style.color = "#E8E6E1";
  _e47.style.lineHeight = "1.7";
  _e47.style.fontSize = "0.95rem";
  _e41.appendChild(_e47);
  const _e48 = WF.h("div", { className: "wf-spacer" });
  _e41.appendChild(_e48);
  const _e49 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e50 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e50.style.fontFamily = "JetBrains Mono, monospace";
  _e50.style.background = "#2D2C2A";
  _e50.style.color = "#E8E6E1";
  _e50.style.padding = "0.25rem 0.75rem";
  _e50.style.borderRadius = "0.375rem";
  _e50.style.fontSize = "0.75rem";
  _e49.appendChild(_e50);
  const _e51 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e51.style.fontFamily = "JetBrains Mono, monospace";
  _e51.style.background = "#2D2C2A";
  _e51.style.color = "#E8E6E1";
  _e51.style.padding = "0.25rem 0.75rem";
  _e51.style.borderRadius = "0.375rem";
  _e51.style.fontSize = "0.75rem";
  _e49.appendChild(_e51);
  const _e52 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e52.style.fontFamily = "JetBrains Mono, monospace";
  _e52.style.background = "#2D2C2A";
  _e52.style.color = "#E8E6E1";
  _e52.style.padding = "0.25rem 0.75rem";
  _e52.style.borderRadius = "0.375rem";
  _e52.style.fontSize = "0.75rem";
  _e49.appendChild(_e52);
  _e41.appendChild(_e49);
  _e40.appendChild(_e41);
  _e40.style.background = "#242422";
  _e40.style.border = "1px solid #2D2C2A";
  _e40.style.borderRadius = "0.75rem";
  _e40.style.padding = "2rem";
  _e40.style.marginBottom = "2rem";
  _e9.appendChild(_e40);
  const _e53 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e54 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e55 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e56 = WF.h("p", { className: "wf-text wf-text--bold" }, "EnayaTech");
  _e56.style.fontSize = "1.2rem";
  _e56.style.color = "#E8E6E1";
  _e55.appendChild(_e56);
  const _e57 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Feb 2020 — Jul 2020");
  _e57.style.color = "#C69C6D";
  _e57.style.fontFamily = "JetBrains Mono, monospace";
  _e57.style.fontSize = "0.8rem";
  _e55.appendChild(_e57);
  _e54.appendChild(_e55);
  const _e58 = WF.h("p", { className: "wf-text wf-text--muted" }, "Backend Developer");
  _e58.style.color = "#8C8B88";
  _e58.style.fontSize = "0.95rem";
  _e54.appendChild(_e58);
  const _e59 = WF.h("div", { className: "wf-spacer" });
  _e54.appendChild(_e59);
  const _e60 = WF.h("p", { className: "wf-text" }, "Developed RESTful APIs with Express.js, designed and maintained database schemas using both MySQL and MongoDB. Built backend services supporting mobile and web client applications with focus on API performance and data consistency.");
  _e60.style.color = "#E8E6E1";
  _e60.style.lineHeight = "1.7";
  _e60.style.fontSize = "0.95rem";
  _e54.appendChild(_e60);
  const _e61 = WF.h("div", { className: "wf-spacer" });
  _e54.appendChild(_e61);
  const _e62 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e63 = WF.h("span", { className: "wf-badge" }, "Express.js");
  _e63.style.fontFamily = "JetBrains Mono, monospace";
  _e63.style.background = "#2D2C2A";
  _e63.style.color = "#E8E6E1";
  _e63.style.padding = "0.25rem 0.75rem";
  _e63.style.borderRadius = "0.375rem";
  _e63.style.fontSize = "0.75rem";
  _e62.appendChild(_e63);
  const _e64 = WF.h("span", { className: "wf-badge" }, "MySQL");
  _e64.style.fontFamily = "JetBrains Mono, monospace";
  _e64.style.background = "#2D2C2A";
  _e64.style.color = "#E8E6E1";
  _e64.style.padding = "0.25rem 0.75rem";
  _e64.style.borderRadius = "0.375rem";
  _e64.style.fontSize = "0.75rem";
  _e62.appendChild(_e64);
  const _e65 = WF.h("span", { className: "wf-badge" }, "MongoDB");
  _e65.style.fontFamily = "JetBrains Mono, monospace";
  _e65.style.background = "#2D2C2A";
  _e65.style.color = "#E8E6E1";
  _e65.style.padding = "0.25rem 0.75rem";
  _e65.style.borderRadius = "0.375rem";
  _e65.style.fontSize = "0.75rem";
  _e62.appendChild(_e65);
  _e54.appendChild(_e62);
  _e53.appendChild(_e54);
  _e53.style.background = "#242422";
  _e53.style.border = "1px solid #2D2C2A";
  _e53.style.borderRadius = "0.75rem";
  _e53.style.padding = "2rem";
  _e53.style.marginBottom = "2rem";
  _e9.appendChild(_e53);
  _e8.appendChild(_e9);
  _e8.style.maxWidth = "800px";
  _e8.style.margin = "0 auto";
  _e8.style.padding = "120px 2rem";
  _root.appendChild(_e8);
  return _root;
}

function Page_Projects(params) {
  const _root = document.createDocumentFragment();
  const _e66 = WF.h("div", { className: "wf-container" });
  const _e67 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e68 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Projects");
  _e68.style.fontSize = "2rem";
  _e68.style.fontWeight = "700";
  _e68.style.color = "#E8E6E1";
  _e68.style.letterSpacing = "-0.02em";
  _e68.style.marginBottom = "1rem";
  _e67.appendChild(_e68);
  const _e69 = WF.h("p", { className: "wf-text wf-text--muted" }, "Things I've designed, built, and shipped.");
  _e69.style.color = "#8C8B88";
  _e69.style.fontSize = "1rem";
  _e69.style.marginBottom = "3rem";
  _e67.appendChild(_e69);
  const _e70 = WF.h("div", { className: "wf-spacer" });
  _e67.appendChild(_e70);
  const _e71 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e72 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e73 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e74 = WF.h("p", { className: "wf-text wf-text--bold" }, "WebFluent");
  _e74.style.fontSize = "1.2rem";
  _e74.style.color = "#E8E6E1";
  _e73.appendChild(_e74);
  const _e75 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Flagship");
  _e75.style.fontFamily = "JetBrains Mono, monospace";
  _e75.style.background = "#C69C6D";
  _e75.style.color = "#1A1A19";
  _e75.style.padding = "0.25rem 0.75rem";
  _e75.style.borderRadius = "0.375rem";
  _e75.style.fontSize = "0.75rem";
  _e75.style.fontWeight = "600";
  _e73.appendChild(_e75);
  _e72.appendChild(_e73);
  const _e76 = WF.h("p", { className: "wf-text wf-text--muted" }, "A web-first programming language that compiles to HTML, CSS, JavaScript, and PDF.");
  _e76.style.color = "#8C8B88";
  _e76.style.fontSize = "0.95rem";
  _e72.appendChild(_e76);
  const _e77 = WF.h("div", { className: "wf-spacer" });
  _e72.appendChild(_e77);
  const _e78 = WF.h("p", { className: "wf-text" }, "WebFluent replaces the traditional web stack with a single, expressive language. It features reactive state, declarative UI components, built-in routing, i18n, SSG, and PDF output — all from .wf source files. This portfolio is built entirely with WebFluent.");
  _e78.style.color = "#E8E6E1";
  _e78.style.lineHeight = "1.7";
  _e78.style.fontSize = "0.95rem";
  _e72.appendChild(_e78);
  const _e79 = WF.h("div", { className: "wf-spacer" });
  _e72.appendChild(_e79);
  const _e80 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e81 = WF.h("p", { className: "wf-text wf-text--bold" }, "Key features:");
  _e81.style.color = "#C69C6D";
  _e81.style.fontSize = "0.9rem";
  _e81.style.fontWeight = "600";
  _e80.appendChild(_e81);
  const _e82 = WF.h("p", { className: "wf-text" }, "Reactive state & computed values with automatic UI updates");
  _e82.style.fontFamily = "JetBrains Mono, monospace";
  _e82.style.color = "#E8E6E1";
  _e82.style.fontSize = "0.85rem";
  _e80.appendChild(_e82);
  const _e83 = WF.h("p", { className: "wf-text" }, "Full component library — layout, forms, navigation, data display");
  _e83.style.fontFamily = "JetBrains Mono, monospace";
  _e83.style.color = "#E8E6E1";
  _e83.style.fontSize = "0.85rem";
  _e80.appendChild(_e83);
  const _e84 = WF.h("p", { className: "wf-text" }, "Static site generation with JS hydration");
  _e84.style.fontFamily = "JetBrains Mono, monospace";
  _e84.style.color = "#E8E6E1";
  _e84.style.fontSize = "0.85rem";
  _e80.appendChild(_e84);
  const _e85 = WF.h("p", { className: "wf-text" }, "PDF compilation with page layout, headers, footers");
  _e85.style.fontFamily = "JetBrains Mono, monospace";
  _e85.style.color = "#E8E6E1";
  _e85.style.fontSize = "0.85rem";
  _e80.appendChild(_e85);
  const _e86 = WF.h("p", { className: "wf-text" }, "Built-in i18n with automatic RTL support");
  _e86.style.fontFamily = "JetBrains Mono, monospace";
  _e86.style.color = "#E8E6E1";
  _e86.style.fontSize = "0.85rem";
  _e80.appendChild(_e86);
  _e72.appendChild(_e80);
  const _e87 = WF.h("div", { className: "wf-spacer" });
  _e72.appendChild(_e87);
  const _e88 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e89 = WF.h("span", { className: "wf-badge" }, "Rust");
  _e89.style.fontFamily = "JetBrains Mono, monospace";
  _e89.style.background = "#C69C6D";
  _e89.style.color = "#1A1A19";
  _e89.style.padding = "0.25rem 0.75rem";
  _e89.style.borderRadius = "0.375rem";
  _e89.style.fontSize = "0.75rem";
  _e89.style.fontWeight = "600";
  _e88.appendChild(_e89);
  const _e90 = WF.h("span", { className: "wf-badge" }, "Compiler Design");
  _e90.style.fontFamily = "JetBrains Mono, monospace";
  _e90.style.background = "#2D2C2A";
  _e90.style.color = "#E8E6E1";
  _e90.style.padding = "0.25rem 0.75rem";
  _e90.style.borderRadius = "0.375rem";
  _e90.style.fontSize = "0.75rem";
  _e88.appendChild(_e90);
  const _e91 = WF.h("span", { className: "wf-badge" }, "Language Design");
  _e91.style.fontFamily = "JetBrains Mono, monospace";
  _e91.style.background = "#2D2C2A";
  _e91.style.color = "#E8E6E1";
  _e91.style.padding = "0.25rem 0.75rem";
  _e91.style.borderRadius = "0.375rem";
  _e91.style.fontSize = "0.75rem";
  _e88.appendChild(_e91);
  const _e92 = WF.h("span", { className: "wf-badge" }, "PDF Generation");
  _e92.style.fontFamily = "JetBrains Mono, monospace";
  _e92.style.background = "#2D2C2A";
  _e92.style.color = "#E8E6E1";
  _e92.style.padding = "0.25rem 0.75rem";
  _e92.style.borderRadius = "0.375rem";
  _e92.style.fontSize = "0.75rem";
  _e88.appendChild(_e92);
  _e72.appendChild(_e88);
  _e71.appendChild(_e72);
  _e71.style.background = "#242422";
  _e71.style.border = "1px solid #C69C6D";
  _e71.style.borderRadius = "0.75rem";
  _e71.style.padding = "2rem";
  _e71.style.marginBottom = "2rem";
  _e67.appendChild(_e71);
  const _e93 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e94 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e95 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e96 = WF.h("p", { className: "wf-text wf-text--bold" }, "Circles");
  _e96.style.fontSize = "1.2rem";
  _e96.style.color = "#E8E6E1";
  _e95.appendChild(_e96);
  const _e97 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Team Lead");
  _e97.style.fontFamily = "JetBrains Mono, monospace";
  _e97.style.background = "#C69C6D";
  _e97.style.color = "#1A1A19";
  _e97.style.padding = "0.25rem 0.75rem";
  _e97.style.borderRadius = "0.375rem";
  _e97.style.fontSize = "0.75rem";
  _e97.style.fontWeight = "600";
  _e95.appendChild(_e97);
  _e94.appendChild(_e95);
  const _e98 = WF.h("p", { className: "wf-text wf-text--muted" }, "A comprehensive business operating system for small and medium clinics.");
  _e98.style.color = "#8C8B88";
  _e98.style.fontSize = "0.95rem";
  _e94.appendChild(_e98);
  const _e99 = WF.h("div", { className: "wf-spacer" });
  _e94.appendChild(_e99);
  const _e100 = WF.h("p", { className: "wf-text" }, "Circles manages every aspect of clinic operations — from financials and patient scheduling to HIPAA-compliant EMR, telehealth, AI-powered diagnostics, multi-branch support, and branded patient apps. Available across MENA and Africa through local partners.");
  _e100.style.color = "#E8E6E1";
  _e100.style.lineHeight = "1.7";
  _e100.style.fontSize = "0.95rem";
  _e94.appendChild(_e100);
  const _e101 = WF.h("div", { className: "wf-spacer" });
  _e94.appendChild(_e101);
  const _e102 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e103 = WF.h("span", { className: "wf-badge" }, "GraphQL");
  _e103.style.fontFamily = "JetBrains Mono, monospace";
  _e103.style.background = "#2D2C2A";
  _e103.style.color = "#E8E6E1";
  _e103.style.padding = "0.25rem 0.75rem";
  _e103.style.borderRadius = "0.375rem";
  _e103.style.fontSize = "0.75rem";
  _e102.appendChild(_e103);
  const _e104 = WF.h("span", { className: "wf-badge" }, "Kafka");
  _e104.style.fontFamily = "JetBrains Mono, monospace";
  _e104.style.background = "#2D2C2A";
  _e104.style.color = "#E8E6E1";
  _e104.style.padding = "0.25rem 0.75rem";
  _e104.style.borderRadius = "0.375rem";
  _e104.style.fontSize = "0.75rem";
  _e102.appendChild(_e104);
  const _e105 = WF.h("span", { className: "wf-badge" }, "Microservices");
  _e105.style.fontFamily = "JetBrains Mono, monospace";
  _e105.style.background = "#2D2C2A";
  _e105.style.color = "#E8E6E1";
  _e105.style.padding = "0.25rem 0.75rem";
  _e105.style.borderRadius = "0.375rem";
  _e105.style.fontSize = "0.75rem";
  _e102.appendChild(_e105);
  const _e106 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e106.style.fontFamily = "JetBrains Mono, monospace";
  _e106.style.background = "#2D2C2A";
  _e106.style.color = "#E8E6E1";
  _e106.style.padding = "0.25rem 0.75rem";
  _e106.style.borderRadius = "0.375rem";
  _e106.style.fontSize = "0.75rem";
  _e102.appendChild(_e106);
  _e94.appendChild(_e102);
  _e93.appendChild(_e94);
  _e93.style.background = "#242422";
  _e93.style.border = "1px solid #2D2C2A";
  _e93.style.borderRadius = "0.75rem";
  _e93.style.padding = "2rem";
  _e93.style.marginBottom = "2rem";
  _e67.appendChild(_e93);
  const _e107 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e108 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e109 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e110 = WF.h("p", { className: "wf-text wf-text--bold" }, "Al-Hakeem");
  _e110.style.fontSize = "1.2rem";
  _e110.style.color = "#E8E6E1";
  _e109.appendChild(_e110);
  const _e111 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Engineering Lead");
  _e111.style.fontFamily = "JetBrains Mono, monospace";
  _e111.style.background = "#C69C6D";
  _e111.style.color = "#1A1A19";
  _e111.style.padding = "0.25rem 0.75rem";
  _e111.style.borderRadius = "0.375rem";
  _e111.style.fontSize = "0.75rem";
  _e111.style.fontWeight = "600";
  _e109.appendChild(_e111);
  _e108.appendChild(_e109);
  const _e112 = WF.h("p", { className: "wf-text wf-text--muted" }, "A healthcare platform connecting physicians with medical services.");
  _e112.style.color = "#8C8B88";
  _e112.style.fontSize = "0.95rem";
  _e108.appendChild(_e112);
  const _e113 = WF.h("div", { className: "wf-spacer" });
  _e108.appendChild(_e113);
  const _e114 = WF.h("p", { className: "wf-text" }, "Al-Hakeem streamlines physician onboarding and medical service delivery. The platform supports bilingual operation in Arabic and English, serving healthcare professionals across the region with credential management and service coordination.");
  _e114.style.color = "#E8E6E1";
  _e114.style.lineHeight = "1.7";
  _e114.style.fontSize = "0.95rem";
  _e108.appendChild(_e114);
  const _e115 = WF.h("div", { className: "wf-spacer" });
  _e108.appendChild(_e115);
  const _e116 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e117 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e117.style.fontFamily = "JetBrains Mono, monospace";
  _e117.style.background = "#2D2C2A";
  _e117.style.color = "#E8E6E1";
  _e117.style.padding = "0.25rem 0.75rem";
  _e117.style.borderRadius = "0.375rem";
  _e117.style.fontSize = "0.75rem";
  _e116.appendChild(_e117);
  const _e118 = WF.h("span", { className: "wf-badge" }, "TypeScript");
  _e118.style.fontFamily = "JetBrains Mono, monospace";
  _e118.style.background = "#2D2C2A";
  _e118.style.color = "#E8E6E1";
  _e118.style.padding = "0.25rem 0.75rem";
  _e118.style.borderRadius = "0.375rem";
  _e118.style.fontSize = "0.75rem";
  _e116.appendChild(_e118);
  const _e119 = WF.h("span", { className: "wf-badge" }, "Healthcare");
  _e119.style.fontFamily = "JetBrains Mono, monospace";
  _e119.style.background = "#2D2C2A";
  _e119.style.color = "#E8E6E1";
  _e119.style.padding = "0.25rem 0.75rem";
  _e119.style.borderRadius = "0.375rem";
  _e119.style.fontSize = "0.75rem";
  _e116.appendChild(_e119);
  _e108.appendChild(_e116);
  _e107.appendChild(_e108);
  _e107.style.background = "#242422";
  _e107.style.border = "1px solid #2D2C2A";
  _e107.style.borderRadius = "0.75rem";
  _e107.style.padding = "2rem";
  _e107.style.marginBottom = "2rem";
  _e67.appendChild(_e107);
  const _e120 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e121 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e122 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e123 = WF.h("p", { className: "wf-text wf-text--bold" }, "Dabdoob");
  _e123.style.fontSize = "1.2rem";
  _e123.style.color = "#E8E6E1";
  _e122.appendChild(_e123);
  const _e124 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Team Lead");
  _e124.style.fontFamily = "JetBrains Mono, monospace";
  _e124.style.background = "#C69C6D";
  _e124.style.color = "#1A1A19";
  _e124.style.padding = "0.25rem 0.75rem";
  _e124.style.borderRadius = "0.375rem";
  _e124.style.fontSize = "0.75rem";
  _e124.style.fontWeight = "600";
  _e122.appendChild(_e124);
  _e121.appendChild(_e122);
  const _e125 = WF.h("p", { className: "wf-text wf-text--muted" }, "A mobile-first e-commerce platform serving the Middle East.");
  _e125.style.color = "#8C8B88";
  _e125.style.fontSize = "0.95rem";
  _e121.appendChild(_e125);
  const _e126 = WF.h("div", { className: "wf-spacer" });
  _e121.appendChild(_e126);
  const _e127 = WF.h("p", { className: "wf-text" }, "Dabdoob is a cross-platform shopping application available on iOS and Android, operating across Kuwait, Saudi Arabia, UAE, Qatar, and Bahrain. The platform delivers exclusive deals and a seamless mobile shopping experience across the GCC region.");
  _e127.style.color = "#E8E6E1";
  _e127.style.lineHeight = "1.7";
  _e127.style.fontSize = "0.95rem";
  _e121.appendChild(_e127);
  const _e128 = WF.h("div", { className: "wf-spacer" });
  _e121.appendChild(_e128);
  const _e129 = WF.h("div", { className: "wf-row wf-row--gap-sm" });
  const _e130 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e130.style.fontFamily = "JetBrains Mono, monospace";
  _e130.style.background = "#2D2C2A";
  _e130.style.color = "#E8E6E1";
  _e130.style.padding = "0.25rem 0.75rem";
  _e130.style.borderRadius = "0.375rem";
  _e130.style.fontSize = "0.75rem";
  _e129.appendChild(_e130);
  const _e131 = WF.h("span", { className: "wf-badge" }, "E-Commerce");
  _e131.style.fontFamily = "JetBrains Mono, monospace";
  _e131.style.background = "#2D2C2A";
  _e131.style.color = "#E8E6E1";
  _e131.style.padding = "0.25rem 0.75rem";
  _e131.style.borderRadius = "0.375rem";
  _e131.style.fontSize = "0.75rem";
  _e129.appendChild(_e131);
  const _e132 = WF.h("span", { className: "wf-badge" }, "Mobile");
  _e132.style.fontFamily = "JetBrains Mono, monospace";
  _e132.style.background = "#2D2C2A";
  _e132.style.color = "#E8E6E1";
  _e132.style.padding = "0.25rem 0.75rem";
  _e132.style.borderRadius = "0.375rem";
  _e132.style.fontSize = "0.75rem";
  _e129.appendChild(_e132);
  _e121.appendChild(_e129);
  _e120.appendChild(_e121);
  _e120.style.background = "#242422";
  _e120.style.border = "1px solid #2D2C2A";
  _e120.style.borderRadius = "0.75rem";
  _e120.style.padding = "2rem";
  _e120.style.marginBottom = "2rem";
  _e67.appendChild(_e120);
  const _e133 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e134 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e135 = WF.h("div", { className: "wf-row wf-row--between wf-row--center" });
  const _e136 = WF.h("p", { className: "wf-text wf-text--bold" }, "sys-voice-daemon");
  _e136.style.fontSize = "1.2rem";
  _e136.style.color = "#E8E6E1";
  _e135.appendChild(_e136);
  const _e137 = WF.h("span", { className: "wf-badge" }, "Open Source");
  _e137.style.fontFamily = "JetBrains Mono, monospace";
  _e137.style.background = "#2D2C2A";
  _e137.style.color = "#E8E6E1";
  _e137.style.padding = "0.25rem 0.75rem";
  _e137.style.borderRadius = "0.375rem";
  _e137.style.fontSize = "0.75rem";
  _e135.appendChild(_e137);
  _e134.appendChild(_e135);
  const _e138 = WF.h("p", { className: "wf-text wf-text--muted" }, "Privacy-first, offline voice-to-text daemon for Linux.");
  _e138.style.color = "#8C8B88";
  _e138.style.fontSize = "0.95rem";
  _e134.appendChild(_e138);
  const _e139 = WF.h("div", { className: "wf-spacer" });
  _e134.appendChild(_e139);
  const _e140 = WF.h("p", { className: "wf-text" }, "A system-level daemon that automatically detects active text fields and injects transcriptions into any window. Uses a kernel-level virtual keyboard via uinput for seamless, privacy-respecting voice input — entirely offline with no cloud dependency.");
  _e140.style.color = "#E8E6E1";
  _e140.style.lineHeight = "1.7";
  _e140.style.fontSize = "0.95rem";
  _e134.appendChild(_e140);
  const _e141 = WF.h("div", { className: "wf-spacer" });
  _e134.appendChild(_e141);
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
  const _e144 = WF.h("span", { className: "wf-badge" }, "Linux");
  _e144.style.fontFamily = "JetBrains Mono, monospace";
  _e144.style.background = "#2D2C2A";
  _e144.style.color = "#E8E6E1";
  _e144.style.padding = "0.25rem 0.75rem";
  _e144.style.borderRadius = "0.375rem";
  _e144.style.fontSize = "0.75rem";
  _e142.appendChild(_e144);
  const _e145 = WF.h("span", { className: "wf-badge" }, "uinput");
  _e145.style.fontFamily = "JetBrains Mono, monospace";
  _e145.style.background = "#2D2C2A";
  _e145.style.color = "#E8E6E1";
  _e145.style.padding = "0.25rem 0.75rem";
  _e145.style.borderRadius = "0.375rem";
  _e145.style.fontSize = "0.75rem";
  _e142.appendChild(_e145);
  const _e146 = WF.h("span", { className: "wf-badge" }, "Systems");
  _e146.style.fontFamily = "JetBrains Mono, monospace";
  _e146.style.background = "#2D2C2A";
  _e146.style.color = "#E8E6E1";
  _e146.style.padding = "0.25rem 0.75rem";
  _e146.style.borderRadius = "0.375rem";
  _e146.style.fontSize = "0.75rem";
  _e142.appendChild(_e146);
  _e134.appendChild(_e142);
  _e133.appendChild(_e134);
  _e133.style.background = "#242422";
  _e133.style.border = "1px solid #2D2C2A";
  _e133.style.borderRadius = "0.75rem";
  _e133.style.padding = "2rem";
  _e133.style.marginBottom = "2rem";
  _e67.appendChild(_e133);
  _e66.appendChild(_e67);
  _e66.style.maxWidth = "800px";
  _e66.style.margin = "0 auto";
  _e66.style.padding = "120px 2rem";
  _root.appendChild(_e66);
  return _root;
}

function Page_Skills(params) {
  const _root = document.createDocumentFragment();
  const _e147 = WF.h("div", { className: "wf-container" });
  const _e148 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e149 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Infrastructure & Capabilities");
  _e149.style.fontSize = "2rem";
  _e149.style.fontWeight = "700";
  _e149.style.color = "#E8E6E1";
  _e149.style.letterSpacing = "-0.02em";
  _e149.style.marginBottom = "1rem";
  _e148.appendChild(_e149);
  const _e150 = WF.h("p", { className: "wf-text wf-text--muted" }, "The systems, languages, and tools I architect with.");
  _e150.style.color = "#8C8B88";
  _e150.style.fontSize = "1rem";
  _e150.style.marginBottom = "3rem";
  _e148.appendChild(_e150);
  const _e151 = WF.h("div", { className: "wf-spacer" });
  _e148.appendChild(_e151);
  const _e152 = WF.h("div", { className: "wf-grid wf-grid--gap-md", style: { gridTemplateColumns: 'repeat(2, 1fr)' } });
  const _e153 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e154 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e155 = WF.h("p", { className: "wf-text wf-text--bold" }, "Languages");
  _e155.style.fontSize = "1rem";
  _e155.style.color = "#C69C6D";
  _e155.style.fontWeight = "600";
  _e155.style.marginBottom = "0.5rem";
  _e154.appendChild(_e155);
  const _e156 = WF.h("p", { className: "wf-text" }, "Rust");
  _e156.style.fontFamily = "JetBrains Mono, monospace";
  _e156.style.color = "#E8E6E1";
  _e156.style.fontSize = "0.9rem";
  _e154.appendChild(_e156);
  const _e157 = WF.h("p", { className: "wf-text" }, "TypeScript");
  _e157.style.fontFamily = "JetBrains Mono, monospace";
  _e157.style.color = "#E8E6E1";
  _e157.style.fontSize = "0.9rem";
  _e154.appendChild(_e157);
  const _e158 = WF.h("p", { className: "wf-text" }, "JavaScript");
  _e158.style.fontFamily = "JetBrains Mono, monospace";
  _e158.style.color = "#E8E6E1";
  _e158.style.fontSize = "0.9rem";
  _e154.appendChild(_e158);
  const _e159 = WF.h("p", { className: "wf-text" }, "SQL");
  _e159.style.fontFamily = "JetBrains Mono, monospace";
  _e159.style.color = "#E8E6E1";
  _e159.style.fontSize = "0.9rem";
  _e154.appendChild(_e159);
  _e153.appendChild(_e154);
  _e153.style.background = "#242422";
  _e153.style.border = "1px solid #2D2C2A";
  _e153.style.borderRadius = "0.75rem";
  _e153.style.padding = "2rem";
  _e152.appendChild(_e153);
  const _e160 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e161 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e162 = WF.h("p", { className: "wf-text wf-text--bold" }, "Frameworks & Runtime");
  _e162.style.fontSize = "1rem";
  _e162.style.color = "#C69C6D";
  _e162.style.fontWeight = "600";
  _e162.style.marginBottom = "0.5rem";
  _e161.appendChild(_e162);
  const _e163 = WF.h("p", { className: "wf-text" }, "Node.js");
  _e163.style.fontFamily = "JetBrains Mono, monospace";
  _e163.style.color = "#E8E6E1";
  _e163.style.fontSize = "0.9rem";
  _e161.appendChild(_e163);
  const _e164 = WF.h("p", { className: "wf-text" }, "NestJS");
  _e164.style.fontFamily = "JetBrains Mono, monospace";
  _e164.style.color = "#E8E6E1";
  _e164.style.fontSize = "0.9rem";
  _e161.appendChild(_e164);
  const _e165 = WF.h("p", { className: "wf-text" }, "Express.js");
  _e165.style.fontFamily = "JetBrains Mono, monospace";
  _e165.style.color = "#E8E6E1";
  _e165.style.fontSize = "0.9rem";
  _e161.appendChild(_e165);
  const _e166 = WF.h("p", { className: "wf-text" }, "GraphQL");
  _e166.style.fontFamily = "JetBrains Mono, monospace";
  _e166.style.color = "#E8E6E1";
  _e166.style.fontSize = "0.9rem";
  _e161.appendChild(_e166);
  _e160.appendChild(_e161);
  _e160.style.background = "#242422";
  _e160.style.border = "1px solid #2D2C2A";
  _e160.style.borderRadius = "0.75rem";
  _e160.style.padding = "2rem";
  _e152.appendChild(_e160);
  const _e167 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e168 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e169 = WF.h("p", { className: "wf-text wf-text--bold" }, "Data & Streaming");
  _e169.style.fontSize = "1rem";
  _e169.style.color = "#C69C6D";
  _e169.style.fontWeight = "600";
  _e169.style.marginBottom = "0.5rem";
  _e168.appendChild(_e169);
  const _e170 = WF.h("p", { className: "wf-text" }, "PostgreSQL");
  _e170.style.fontFamily = "JetBrains Mono, monospace";
  _e170.style.color = "#E8E6E1";
  _e170.style.fontSize = "0.9rem";
  _e168.appendChild(_e170);
  const _e171 = WF.h("p", { className: "wf-text" }, "MySQL");
  _e171.style.fontFamily = "JetBrains Mono, monospace";
  _e171.style.color = "#E8E6E1";
  _e171.style.fontSize = "0.9rem";
  _e168.appendChild(_e171);
  const _e172 = WF.h("p", { className: "wf-text" }, "MongoDB");
  _e172.style.fontFamily = "JetBrains Mono, monospace";
  _e172.style.color = "#E8E6E1";
  _e172.style.fontSize = "0.9rem";
  _e168.appendChild(_e172);
  const _e173 = WF.h("p", { className: "wf-text" }, "Apache Kafka");
  _e173.style.fontFamily = "JetBrains Mono, monospace";
  _e173.style.color = "#E8E6E1";
  _e173.style.fontSize = "0.9rem";
  _e168.appendChild(_e173);
  const _e174 = WF.h("p", { className: "wf-text" }, "RabbitMQ");
  _e174.style.fontFamily = "JetBrains Mono, monospace";
  _e174.style.color = "#E8E6E1";
  _e174.style.fontSize = "0.9rem";
  _e168.appendChild(_e174);
  _e167.appendChild(_e168);
  _e167.style.background = "#242422";
  _e167.style.border = "1px solid #2D2C2A";
  _e167.style.borderRadius = "0.75rem";
  _e167.style.padding = "2rem";
  _e152.appendChild(_e167);
  const _e175 = WF.h("div", { className: "wf-card wf-card--elevated" });
  const _e176 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e177 = WF.h("p", { className: "wf-text wf-text--bold" }, "Systems & Security");
  _e177.style.fontSize = "1rem";
  _e177.style.color = "#C69C6D";
  _e177.style.fontWeight = "600";
  _e177.style.marginBottom = "0.5rem";
  _e176.appendChild(_e177);
  const _e178 = WF.h("p", { className: "wf-text" }, "Microservices Architecture");
  _e178.style.fontFamily = "JetBrains Mono, monospace";
  _e178.style.color = "#E8E6E1";
  _e178.style.fontSize = "0.9rem";
  _e176.appendChild(_e178);
  const _e179 = WF.h("p", { className: "wf-text" }, "Distributed Systems");
  _e179.style.fontFamily = "JetBrains Mono, monospace";
  _e179.style.color = "#E8E6E1";
  _e179.style.fontSize = "0.9rem";
  _e176.appendChild(_e179);
  const _e180 = WF.h("p", { className: "wf-text" }, "AES Encryption");
  _e180.style.fontFamily = "JetBrains Mono, monospace";
  _e180.style.color = "#E8E6E1";
  _e180.style.fontSize = "0.9rem";
  _e176.appendChild(_e180);
  const _e181 = WF.h("p", { className: "wf-text" }, "Docker");
  _e181.style.fontFamily = "JetBrains Mono, monospace";
  _e181.style.color = "#E8E6E1";
  _e181.style.fontSize = "0.9rem";
  _e176.appendChild(_e181);
  _e175.appendChild(_e176);
  _e175.style.background = "#242422";
  _e175.style.border = "1px solid #2D2C2A";
  _e175.style.borderRadius = "0.75rem";
  _e175.style.padding = "2rem";
  _e152.appendChild(_e175);
  _e148.appendChild(_e152);
  _e147.appendChild(_e148);
  _e147.style.maxWidth = "800px";
  _e147.style.margin = "0 auto";
  _e147.style.padding = "120px 2rem";
  _root.appendChild(_e147);
  return _root;
}

function Page_Home(params) {
  const _root = document.createDocumentFragment();
  const _e182 = WF.h("div", { className: "wf-container" });
  const _e183 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e184 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Monzer Omer");
  _e184.style.fontSize = "3rem";
  _e184.style.fontWeight = "700";
  _e184.style.color = "#E8E6E1";
  _e184.style.letterSpacing = "-0.02em";
  _e184.style.lineHeight = "1.1";
  _e183.appendChild(_e184);
  const _e185 = WF.h("div", { className: "wf-spacer" });
  _e183.appendChild(_e185);
  const _e186 = WF.h("p", { className: "wf-text wf-text--muted" }, "Senior Backend Engineer");
  _e186.style.fontSize = "1.25rem";
  _e186.style.color = "#8C8B88";
  _e186.style.fontWeight = "400";
  _e183.appendChild(_e186);
  const _e187 = WF.h("div", { className: "wf-spacer" });
  _e183.appendChild(_e187);
  const _e188 = WF.h("p", { className: "wf-text" }, "Architecting scalable, resilient solutions and high-performance systems. Dedicated to clean, maintainable server-side architectures, data integrity, and low-level optimization.");
  _e188.style.fontSize = "1.1rem";
  _e188.style.color = "#E8E6E1";
  _e188.style.lineHeight = "1.7";
  _e188.style.maxWidth = "600px";
  _e183.appendChild(_e188);
  const _e189 = WF.h("div", { className: "wf-spacer" });
  _e183.appendChild(_e189);
  const _e190 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e191 = WF.h("span", { className: "wf-badge wf-badge--primary" }, "Rust");
  _e191.style.fontFamily = "JetBrains Mono, monospace";
  _e191.style.background = "#C69C6D";
  _e191.style.color = "#1A1A19";
  _e191.style.padding = "0.4rem 1rem";
  _e191.style.borderRadius = "0.375rem";
  _e191.style.fontSize = "0.875rem";
  _e191.style.fontWeight = "600";
  _e190.appendChild(_e191);
  const _e192 = WF.h("span", { className: "wf-badge" }, "Node.js");
  _e192.style.fontFamily = "JetBrains Mono, monospace";
  _e192.style.background = "#2D2C2A";
  _e192.style.color = "#E8E6E1";
  _e192.style.padding = "0.4rem 1rem";
  _e192.style.borderRadius = "0.375rem";
  _e192.style.fontSize = "0.875rem";
  _e190.appendChild(_e192);
  const _e193 = WF.h("span", { className: "wf-badge" }, "Distributed Systems");
  _e193.style.fontFamily = "JetBrains Mono, monospace";
  _e193.style.background = "#2D2C2A";
  _e193.style.color = "#E8E6E1";
  _e193.style.padding = "0.4rem 1rem";
  _e193.style.borderRadius = "0.375rem";
  _e193.style.fontSize = "0.875rem";
  _e190.appendChild(_e193);
  _e183.appendChild(_e190);
  const _e194 = WF.h("div", { className: "wf-spacer" });
  _e183.appendChild(_e194);
  const _e195 = WF.h("div", { className: "wf-row wf-row--gap-md" });
  const _e196 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e197 = WF.h("p", { className: "wf-text" }, "View Experience →");
  _e197.style.color = "#C69C6D";
  _e197.style.fontWeight = "500";
  _e197.style.fontSize = "1rem";
  _e196.appendChild(_e197);
  _e195.appendChild(_e196);
  const _e198 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e199 = WF.h("p", { className: "wf-text" }, "Get in Touch →");
  _e199.style.color = "#8C8B88";
  _e199.style.fontSize = "1rem";
  _e198.appendChild(_e199);
  _e195.appendChild(_e198);
  _e183.appendChild(_e195);
  _e182.appendChild(_e183);
  _e182.style.maxWidth = "800px";
  _e182.style.margin = "0 auto";
  _e182.style.padding = "120px 2rem";
  _e182.style.minHeight = "100vh";
  _e182.style.display = "flex";
  _e182.style.flexDirection = "column";
  _e182.style.justifyContent = "center";
  _root.appendChild(_e182);
  return _root;
}

function Page_Contact(params) {
  const _root = document.createDocumentFragment();
  const _e200 = WF.h("div", { className: "wf-container" });
  const _e201 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e202 = WF.h("h2", { className: "wf-heading wf-heading--h1" }, "Let's build something robust.");
  _e202.style.fontSize = "2rem";
  _e202.style.fontWeight = "700";
  _e202.style.color = "#E8E6E1";
  _e202.style.letterSpacing = "-0.02em";
  _e202.style.marginBottom = "1rem";
  _e201.appendChild(_e202);
  const _e203 = WF.h("p", { className: "wf-text wf-text--muted" }, "Available for senior backend roles, architecture consulting, and high-impact engineering challenges.");
  _e203.style.color = "#8C8B88";
  _e203.style.fontSize = "1rem";
  _e203.style.lineHeight = "1.7";
  _e203.style.marginBottom = "2rem";
  _e203.style.maxWidth = "500px";
  _e201.appendChild(_e203);
  const _e204 = WF.h("div", { className: "wf-spacer" });
  _e201.appendChild(_e204);
  const _e205 = WF.h("div", { className: "wf-stack wf-stack--gap-md" });
  const _e206 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e207 = WF.h("p", { className: "wf-text wf-text--muted" }, "Email");
  _e207.style.color = "#8C8B88";
  _e207.style.fontSize = "0.85rem";
  _e207.style.minWidth = "80px";
  _e206.appendChild(_e207);
  const _e208 = WF.h("a", { className: "wf-link", href: WF._basePath + "mailto:monzer.a.omer@gmail.com" });
  const _e209 = WF.h("p", { className: "wf-text" }, "monzer.a.omer@gmail.com");
  _e209.style.color = "#C69C6D";
  _e209.style.fontFamily = "JetBrains Mono, monospace";
  _e209.style.fontSize = "0.95rem";
  _e208.appendChild(_e209);
  _e206.appendChild(_e208);
  _e205.appendChild(_e206);
  const _e210 = WF.h("hr", { className: "wf-divider" });
  _e210.style.borderColor = "#2D2C2A";
  _e210.style.margin = "0.5rem 0";
  _e205.appendChild(_e210);
  const _e211 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e212 = WF.h("p", { className: "wf-text wf-text--muted" }, "LinkedIn");
  _e212.style.color = "#8C8B88";
  _e212.style.fontSize = "0.85rem";
  _e212.style.minWidth = "80px";
  _e211.appendChild(_e212);
  const _e213 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://linkedin.com/in/monzer-omer" });
  const _e214 = WF.h("p", { className: "wf-text" }, "linkedin.com/in/monzer-omer");
  _e214.style.color = "#C69C6D";
  _e214.style.fontFamily = "JetBrains Mono, monospace";
  _e214.style.fontSize = "0.95rem";
  _e213.appendChild(_e214);
  _e211.appendChild(_e213);
  _e205.appendChild(_e211);
  const _e215 = WF.h("hr", { className: "wf-divider" });
  _e215.style.borderColor = "#2D2C2A";
  _e215.style.margin = "0.5rem 0";
  _e205.appendChild(_e215);
  const _e216 = WF.h("div", { className: "wf-row wf-row--gap-md wf-row--center" });
  const _e217 = WF.h("p", { className: "wf-text wf-text--muted" }, "GitHub");
  _e217.style.color = "#8C8B88";
  _e217.style.fontSize = "0.85rem";
  _e217.style.minWidth = "80px";
  _e216.appendChild(_e217);
  const _e218 = WF.h("a", { className: "wf-link", href: WF._basePath + "https://github.com/monzer-omer" });
  const _e219 = WF.h("p", { className: "wf-text" }, "github.com/monzer-omer");
  _e219.style.color = "#C69C6D";
  _e219.style.fontFamily = "JetBrains Mono, monospace";
  _e219.style.fontSize = "0.95rem";
  _e218.appendChild(_e219);
  _e216.appendChild(_e218);
  _e205.appendChild(_e216);
  _e201.appendChild(_e205);
  _e200.appendChild(_e201);
  _e200.style.maxWidth = "800px";
  _e200.style.margin = "0 auto";
  _e200.style.padding = "120px 2rem";
  _e200.style.minHeight = "60vh";
  _e200.style.display = "flex";
  _e200.style.flexDirection = "column";
  _e200.style.justifyContent = "center";
  _root.appendChild(_e200);
  return _root;
}

(function() {
  const _app = document.getElementById('app');
  _app.innerHTML = '';
  const _e220 = WF.h("nav", { className: "wf-navbar" });
  const _e221 = WF.h("div", { className: "wf-navbar__brand" });
  const _e222 = WF.h("a", { className: "wf-link", href: WF._basePath + "/" });
  const _e223 = WF.h("p", { className: "wf-text wf-text--bold" }, "monzer.omer");
  _e223.style.fontFamily = "JetBrains Mono, monospace";
  _e223.style.color = "#E8E6E1";
  _e223.style.fontSize = "0.95rem";
  _e223.style.fontWeight = "600";
  _e222.appendChild(_e223);
  _e221.appendChild(_e222);
  _e220.appendChild(_e221);
  const _e224 = WF.h("div", { className: "wf-navbar__links" });
  const _e225 = WF.h("a", { className: "wf-link", href: WF._basePath + "/projects" });
  const _e226 = WF.h("p", { className: "wf-text" }, "Projects");
  _e226.style.color = "#8C8B88";
  _e226.style.fontSize = "0.875rem";
  _e225.appendChild(_e226);
  _e224.appendChild(_e225);
  const _e227 = WF.h("a", { className: "wf-link", href: WF._basePath + "/experience" });
  const _e228 = WF.h("p", { className: "wf-text" }, "Experience");
  _e228.style.color = "#8C8B88";
  _e228.style.fontSize = "0.875rem";
  _e227.appendChild(_e228);
  _e224.appendChild(_e227);
  const _e229 = WF.h("a", { className: "wf-link", href: WF._basePath + "/skills" });
  const _e230 = WF.h("p", { className: "wf-text" }, "Skills");
  _e230.style.color = "#8C8B88";
  _e230.style.fontSize = "0.875rem";
  _e229.appendChild(_e230);
  _e224.appendChild(_e229);
  const _e231 = WF.h("a", { className: "wf-link", href: WF._basePath + "/education" });
  const _e232 = WF.h("p", { className: "wf-text" }, "Education");
  _e232.style.color = "#8C8B88";
  _e232.style.fontSize = "0.875rem";
  _e231.appendChild(_e232);
  _e224.appendChild(_e231);
  const _e233 = WF.h("a", { className: "wf-link", href: WF._basePath + "/contact" });
  const _e234 = WF.h("p", { className: "wf-text" }, "Contact");
  _e234.style.color = "#8C8B88";
  _e234.style.fontSize = "0.875rem";
  _e233.appendChild(_e234);
  _e224.appendChild(_e233);
  _e220.appendChild(_e224);
  _e220.style.background = "rgba(26, 26, 25, 0.85)";
  _e220.style.backdropFilter = "blur(12px)";
  _e220.style.borderBottom = "1px solid #2D2C2A";
  _e220.style.padding = "0.75rem 2rem";
  _e220.style.position = "sticky";
  _e220.style.top = "0";
  _e220.style.zIndex = "100";
  _app.appendChild(_e220);
  const _routerEl = document.createElement('div');
  _routerEl.id = 'wf-router';
  _routerEl.style.flex = '1';
  _app.appendChild(_routerEl);
  const _routes = [
    { path: "/", render: (params) => Page_Home(params) },
    { path: "/projects", render: (params) => Page_Projects(params) },
    { path: "/experience", render: (params) => Page_Experience(params) },
    { path: "/skills", render: (params) => Page_Skills(params) },
    { path: "/education", render: (params) => Page_Education(params) },
    { path: "/contact", render: (params) => Page_Contact(params) },
  ];
  WF.createRouter(_routes, _routerEl);
  const _e235 = WF.h("div", {});
  const _e236 = WF.h("p", { className: "wf-text wf-text--muted wf-text--small" }, "Built with WebFluent");
  _e236.style.fontFamily = "JetBrains Mono, monospace";
  _e236.style.color = "#8C8B88";
  _e236.style.fontSize = "0.8rem";
  _e235.appendChild(_e236);
  _e235.style.borderTop = "1px solid #2D2C2A";
  _e235.style.padding = "1.5rem 2rem";
  _e235.style.textAlign = "center";
  _e235.style.position = "sticky";
  _e235.style.bottom = "0";
  _e235.style.background = "rgba(26, 26, 25, 0.85)";
  _e235.style.backdropFilter = "blur(12px)";
  _e235.style.zIndex = "100";
  _app.appendChild(_e235);
})();
