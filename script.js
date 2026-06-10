/* Markus Johnsen Tutoring — interaktion & animation */
(() => {
  "use strict";

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(hover: none)").matches;

  /* ---------- Header: scrolled state + progress bar ---------- */
  const header = document.getElementById("site-header");
  const progress = document.getElementById("progress");
  const mobileCta = document.getElementById("mobile-cta");
  const hero = document.getElementById("hero");

  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle("scrolled", y > 12);

    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";

    if (mobileCta && hero) {
      mobileCta.classList.toggle("show", y > hero.offsetHeight * 0.7);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const navToggle = document.getElementById("nav-toggle");
  const siteNav = document.getElementById("site-nav");
  if (navToggle && siteNav) {
    navToggle.addEventListener("click", () => {
      const open = siteNav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });
    siteNav.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        siteNav.classList.remove("open");
        navToggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  /* ---------- Scroll reveals ---------- */
  const revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
  if ("IntersectionObserver" in window && !prefersReduced) {
    document.querySelectorAll(".reveal-stagger").forEach((group) => {
      [...group.children].forEach((child, i) => {
        child.style.setProperty("--delay", `${i * 0.09}s`);
      });
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }

  /* ---------- Animerede tællere ---------- */
  const counters = document.querySelectorAll(".count");
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const animateCount = (el) => {
    const target = parseInt(el.dataset.count, 10) || 0;
    const dur = 1500;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(easeOut(p) * target);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ("IntersectionObserver" in window && !prefersReduced) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            cio.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => cio.observe(el));
  } else {
    counters.forEach((el) => (el.textContent = el.dataset.count));
  }

  /* ---------- Parallax på matematik-glyffer ---------- */
  if (hero && !prefersReduced && !isTouch) {
    const glyphs = document.querySelectorAll(".glyph");
    let raf = null;
    hero.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        glyphs.forEach((g) => {
          const depth = parseFloat(g.dataset.depth) || 3;
          g.style.transform = `translate(${dx * depth * -6}px, ${dy * depth * -6}px)`;
        });
        raf = null;
      });
    });
  }

  /* ---------- Tilt-effekt på kort ---------- */
  if (!prefersReduced && !isTouch) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      let raf = null;
      card.addEventListener("mousemove", (e) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform = `perspective(900px) rotateX(${py * -5}deg) rotateY(${px * 6}deg) translateY(-4px)`;
          raf = null;
        });
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll(".faq-item").forEach((item) => {
    const btn = item.querySelector(".faq-q");
    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach((other) => {
        other.classList.remove("open");
        other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---------- Kontaktformular → mailto ---------- */
  const bookingForm = document.getElementById("booking-form");
  if (bookingForm) {
    bookingForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(bookingForm);
      const get = (k) => (data.get(k) || "").toString().trim();
      const name = get("name");
      const phone = get("phone");
      const level = get("level");
      const subject = get("subject");
      const message = get("message");

      const subjectLine = `Forespørgsel om tutoring – ${level || "klassetrin"}`;
      const body = [
        "Hej Markus",
        "",
        "Jeg vil gerne høre mere om undervisning.",
        "",
        `Navn: ${name}`,
        `Telefon: ${phone}`,
        `Klassetrin: ${level}`,
        `Fag: ${subject}`,
        "",
        "Hvad vi gerne vil have hjælp til:",
        message || "(skriv kort om behovet)",
        "",
        "Venlig hilsen",
        name,
      ].join("\n");

      const mailto = new URL("mailto:markusmj2256@gmail.com");
      mailto.searchParams.set("subject", subjectLine);
      mailto.searchParams.set("body", body);
      window.location.href = mailto.toString();
    });
  }
})();
