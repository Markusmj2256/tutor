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
  const contactSection = document.getElementById("kontakt");

  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle("scrolled", y > 12);

    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";

    if (mobileCta && hero) {
      const nearContact = contactSection && contactSection.getBoundingClientRect().top < window.innerHeight * 0.75;
      mobileCta.classList.toggle("show", y > hero.offsetHeight * 0.7 && !nearContact);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const navToggle = document.getElementById("nav-toggle");
  const siteNav = document.getElementById("site-nav");
  if (navToggle && siteNav) {
    const setMenuOpen = (open) => {
      siteNav.classList.toggle("open", open);
      navToggle.setAttribute("aria-expanded", String(open));
    };
    navToggle.addEventListener("click", () => {
      setMenuOpen(!siteNav.classList.contains("open"));
    });
    siteNav.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setMenuOpen(false))
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && siteNav.classList.contains("open")) {
        setMenuOpen(false);
        navToggle.focus();
      }
    });
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
    if (!btn) return;
    const answer = item.querySelector(".faq-a");
    if (answer) answer.inert = !item.classList.contains("open");
    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach((other) => {
        other.classList.remove("open");
        other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
        const otherAnswer = other.querySelector(".faq-a");
        if (otherAnswer) otherAnswer.inert = true;
      });
      if (!isOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
        if (answer) answer.inert = false;
      }
    });
  });

  /* ---------- Pakkevalg og interesse for holdundervisning ---------- */
  const bookingForm = document.getElementById("booking-form");
  const packageSelect = bookingForm?.querySelector('[name="package"]');
  if (packageSelect) {
    document.querySelectorAll("[data-package]").forEach((button) => {
      button.addEventListener("click", () => {
        const packageName = button.dataset.package;
        if ([...packageSelect.options].some((option) => option.value === packageName)) {
          packageSelect.value = packageName;
          packageSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
  }

  const groupForm = document.getElementById("group-form");
  if (groupForm) {
    const subjectSelect = groupForm.querySelector('[name="subject"]');
    const otherField = document.getElementById("other-subject-field");
    const otherInput = document.getElementById("other-subject");
    if (subjectSelect && otherField && otherInput) {
      const updateOtherSubject = () => {
        const isOther = subjectSelect.value === "Andet fag";
        otherField.hidden = !isOther;
        otherInput.required = isOther;
        otherInput.disabled = !isOther;
      };
      subjectSelect.addEventListener("change", updateOtherSubject);
      groupForm.addEventListener("reset", () => {
        requestAnimationFrame(updateOtherSubject);
      });
      updateOtherSubject();
    }
  }

  /* ---------- Kontaktformularer → klargør mail i brugerens mailprogram ---------- */
  const setupMailForm = (form, isGroup) => {
    if (!form) return;
    const isIndividual = !isGroup && Boolean(form.querySelector('[name="package"]'));

    const feedback = document.createElement("p");
    feedback.className = "form-note form-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-atomic", "true");
    feedback.hidden = true;
    form.append(feedback);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const get = (k) => (data.get(k) || "").toString().trim();
      const name = get("name");
      const level = get("level");
      const subject = get("subject");
      const message = get("message");
      const subjectLine = isGroup
        ? `Interesse for holdundervisning${subject ? ` – ${subject}` : ""}`
        : `Forespørgsel om ${isIndividual ? "eneundervisning" : "undervisning"}${level ? ` – ${level}` : ""}`;
      const details = [
        ["Navn", name],
        ["E-mail", get("email")],
        ["Telefon", get("phone")],
        ["Klassetrin", level],
        ["Fag", subject],
        ["Ønsket fag", get("otherSubject")],
        ["Undervisningspakke", get("package")],
      ]
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}: ${value}`);
      const body = [
        "Hej Markus",
        "",
        isGroup
          ? "Jeg vil gerne kontaktes for at høre mere om at melde mig på et hold."
          : isIndividual
            ? "Jeg vil gerne høre mere om en til en-undervisning."
            : "Jeg vil gerne høre mere om undervisning.",
        "",
        ...details,
        ...(message ? ["", "Besked:", message] : []),
        "",
        "Venlig hilsen",
        name,
      ].join("\n");

      const mailto = `mailto:markusmj2256@gmail.com?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`;
      const retryLink = document.createElement("a");
      retryLink.href = mailto;
      retryLink.textContent = "Åbn mailen igen";
      feedback.hidden = false;
      feedback.replaceChildren(
        "Mailen er klargjort. Send den i dit mailprogram, så Markus kan kontakte dig. Formularen sender ikke automatisk dine oplysninger. ",
        retryLink,
        ". Hvis dit mailprogram ikke åbner, kan du skrive til markusmj2256@gmail.com eller ringe på 24 25 99 86."
      );

      // The browser cannot confirm whether an external mail application opens or sends.
      try {
        window.location.href = mailto;
      } catch {
        // The visible email address and retry link remain available.
      }
    });
  };

  setupMailForm(bookingForm, false);
  setupMailForm(groupForm, true);
})();
