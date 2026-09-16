/* Flyer attribution follows links in this visit, without cookies or storage.
 * A visit is a URL journey, not a unique person. Supabase validates the ID,
 * campaign and 24-hour window and counts only saved, new leads. */
(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // Cloudflare Pages serverer /holdundervisning og sender /holdundervisning.html
  // videre dertil, mens andre værter bruger endelsen. Begge former godtages, så
  // sporingen overlever et hostingskifte.
  const PAGES = new Set([
    "/", "/index", "/index.html",
    "/eneundervisning", "/eneundervisning.html",
    "/holdundervisning", "/holdundervisning.html",
  ]);
  // Én skrivemåde sendes til serveren, så rapporterne ikke splittes i to.
  const canonicalPath = (p) => {
    const bare = p.replace(/\.html$/, "");
    return bare === "" || bare === "/index" ? "/" : bare;
  };

  window.TutorFlyerTracking = {
    init(endpoint, key) {
      const url = new URL(location.href);
      const flyer = url.searchParams.get("flyer");
      if (!/^f[1-5]$/.test(flyer || "") || !PAGES.has(url.pathname)) {
        return { attribution: async () => ({}) };
      }
      let visit = url.searchParams.get("fv");
      if (!UUID.test(visit || "")) visit = crypto.randomUUID();
      const isTest = url.searchParams.get("tracking_test") === "1";
      let registered = false;
      let pending;

      function decorate() {
        const current = new URL(location.href);
        current.searchParams.set("flyer", flyer);
        current.searchParams.set("fv", visit);
        history.replaceState(history.state, "", current);
        document.querySelectorAll("a[href]").forEach((link) => {
          const target = new URL(link.href, location.href);
          if (target.origin !== location.origin || !PAGES.has(target.pathname)) return;
          target.searchParams.set("flyer", flyer);
          target.searchParams.set("fv", visit);
          if (isTest) target.searchParams.set("tracking_test", "1");
          link.href = target.href;
        });
      }

      async function register(retryExpired = true) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(2500),
            body: JSON.stringify({ action: "flyer_visit", flyer_id: flyer,
              visit_id: visit, landing_path: canonicalPath(url.pathname), is_test: isTest }),
          });
          const result = await response.json();
          if (!response.ok) return false;
          if (result.existing && !result.ok && retryExpired) {
            visit = crypto.randomUUID();
            decorate();
            return register(false);
          }
          registered = result.ok === true;
          return registered;
        } catch {
          // Analytics must never stop a family from contacting Markus.
          return false;
        }
      }

      function ensureRegistered() {
        if (registered) return Promise.resolve(true);
        if (!pending) pending = register().finally(() => { pending = null; });
        return pending;
      }
      decorate();
      if (document.visibilityState === "visible") ensureRegistered();
      else document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") ensureRegistered();
      }, { once: true });

      return {
        async attribution() {
          return await ensureRegistered() ? { flyer_id: flyer, flyer_visit_id: visit } : {};
        },
      };
    },
  };
})();
