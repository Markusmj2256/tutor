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
    // Det gratis prøvehold i november har flere ansøgere end pladser. Derfor
    // bliver kommentarfeltet til et motivationsfelt — og det bliver påkrævet.
    const freeNote = document.getElementById("free-hold-note");
    const messageField = document.getElementById("group-message");
    const messageLabel = document.getElementById("group-message-label");
    const MESSAGE_TEXT = {
      normal: {
        label: "Dage, behov eller andre ønsker (valgfrit)",
        placeholder:
          "Fx hvilke dage der passer, hvilke emner der driller, eller om du søger sammen med en ven",
      },
      free: {
        label: "Din motivation — hvorfor vil du gerne med på holdet?",
        placeholder:
          "Fx hvad du gerne vil blive bedre til, hvad der driller i matematikken, og hvad eksamen betyder for dig",
      },
    };

    if (subjectSelect) {
      // Valgene genkendes på data-attributter frem for på deres tekst, så
      // formuleringen i formularen kan ændres uden at logikken går i stykker.
      const flag = (name) => subjectSelect.selectedOptions[0]?.dataset[name] === "1";

      const updateSubjectFields = () => {
        const isOther = flag("other");
        if (otherField && otherInput) {
          otherField.hidden = !isOther;
          otherInput.required = isOther;
          otherInput.disabled = !isOther;
        }

        const isFree = flag("free");
        if (freeNote) freeNote.hidden = !isFree;
        if (messageField && messageLabel) {
          const text = isFree ? MESSAGE_TEXT.free : MESSAGE_TEXT.normal;
          messageField.required = isFree;
          messageField.placeholder = text.placeholder;
          messageLabel.textContent = text.label;
        }
      };

      subjectSelect.addEventListener("change", updateSubjectFields);
      groupForm.addEventListener("reset", () => {
        requestAnimationFrame(updateSubjectFields);
      });
      updateSubjectFields();
    }
  }

  /* ---------- Kontaktformularer → sendes til backend ---------- */
  // Supabase edge-funktion, der gemmer henvendelsen og sender en mail til Markus.
  // Nøglen herunder er den offentlige anon-nøgle; den er lavet til at ligge i
  // klientkode. Selve tabellen er lukket med row level security, så nøglen alene
  // giver ingen adgang til de indsendte oplysninger.
  const CONTACT_ENDPOINT = "https://kslmcjkyhxdevdfyzzrb.supabase.co/functions/v1/contact";
  const CONTACT_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbG1jamt5aHhkZXZkZnl6enJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0Mzc4NDIsImV4cCI6MjEwMTAxMzg0Mn0.lP-uPzYevRcKCos3wOQVB56XjrDgWrHqXJtSt1x-300";

  const flyerTracking = window.TutorFlyerTracking?.init(CONTACT_ENDPOINT, CONTACT_KEY);

  const setupContactForm = (form, source) => {
    if (!form) return;
    // Tidspunktet formularen blev vist. En indsendelse under to sekunder
    // efter er ikke udfyldt af et menneske, og backenden kasserer den.
    const shownAt = Date.now();
    const button = form.querySelector('[type="submit"]');
    const buttonMarkup = button ? button.innerHTML : "";

    const feedback = document.createElement("p");
    feedback.className = "form-note form-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-atomic", "true");
    feedback.hidden = true;
    form.append(feedback);

    const fallback = (lead) => {
      const mail = document.createElement("a");
      mail.href = "mailto:markusmj2256@gmail.com";
      mail.textContent = "markusmj2256@gmail.com";
      const tel = document.createElement("a");
      tel.href = "tel:+4524259986";
      tel.textContent = "24 25 99 86";
      feedback.replaceChildren(lead, mail, " eller ring på ", tel, ".");
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const get = (key) => (data.get(key) || "").toString().trim();
      // Holdformularen har et ekstra felt til ønsket fag; det hører til emnet.
      const subject = [get("subject"), get("otherSubject")].filter(Boolean).join(" – ");

      if (button) {
        button.disabled = true;
        button.textContent = "Sender…";
      }
      feedback.hidden = true;

      try {
        const attribution = await flyerTracking?.attribution() ?? {};
        const response = await fetch(CONTACT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONTACT_KEY}`,
          },
          body: JSON.stringify({
            ...attribution,
            source,
            name: get("name"),
            phone: get("phone"),
            email: get("email"),
            level: get("level"),
            subject,
            package: get("package"),
            message: get("message"),
            company: get("company"), // honeypot — kun bots udfylder den
            elapsed_ms: Date.now() - shownAt,
            page_url: location.href,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Serveren svarede ${response.status}`);

        form.reset();
        feedback.hidden = false;
        feedback.textContent =
          "Tak — din besked er sendt. Markus vender tilbage, typisk samme dag.";
      } catch (error) {
        feedback.hidden = false;
        fallback(`Beskeden kunne ikke sendes (${error.message}). Prøv igen, eller skriv til `);
      } finally {
        if (button) {
          button.disabled = false;
          button.innerHTML = buttonMarkup;
        }
      }
    });
  };

  const currentPage = location.pathname.split("/").pop() || "index.html";
  setupContactForm(bookingForm, currentPage.startsWith("ene") ? "ene" : "forside");
  setupContactForm(groupForm, "hold");
})();
