/* Markus Johnsen Tutoring — interaktion & animation */
(() => {
  "use strict";

  // Klassen "js" sættes i <head>, når browseren kan IntersectionObserver og
  // brugeren ikke har bedt om reduceret bevægelse. Uden den animeres intet.
  const root = document.documentElement;
  const motion = root.classList.contains("js");

  /* ---------- Scroll: header, kontaktbjælke, parallax og trin-linje ---------- */
  // Alt samles i ét requestAnimationFrame pr. scroll og skriver kun
  // CSS-variabler og klasser, så browseren kan nøjes med at flytte lag.
  const header = document.getElementById("site-header");
  const mobileCta = document.getElementById("mobile-cta");
  const hero = document.getElementById("hero");
  const contactSection = document.getElementById("kontakt");
  const parallaxImages = motion ? [...document.querySelectorAll(".photo-frame img")] : [];
  const steps = motion ? document.querySelector(".steps") : null;

  let queued = false;
  const frame = () => {
    queued = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    if (header) header.classList.toggle("scrolled", y > 8);

    if (mobileCta && hero) {
      const nearContact = contactSection && contactSection.getBoundingClientRect().top < vh * 0.75;
      mobileCta.classList.toggle("show", y > hero.offsetHeight * 0.7 && !nearContact);
    }

    // Billedet er skaleret 8 % op (se styles.css), så der er 4 % luft i hver
    // side. Vi bruger 3,5 % af højden, så kanten aldrig kommer til syne.
    parallaxImages.forEach((img) => {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) return;
      const t = Math.max(-0.5, Math.min(0.5, (r.top + r.height / 2 - vh / 2) / vh));
      img.style.setProperty("--py", (t * -0.07 * r.height).toFixed(1));
    });

    if (steps) {
      const r = steps.getBoundingClientRect();
      const mark = vh * 0.62;
      steps.style.setProperty("--p", Math.min(1, Math.max(0, (mark - r.top) / r.height)).toFixed(3));
      [...steps.children].forEach((step) =>
        step.classList.toggle("on", step.getBoundingClientRect().top < mark)
      );
    }
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  frame();

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
  if (motion) {
    // Overskrifter deles i ord, så de kan stige op ét ad gangen. Teksten og
    // rækkefølgen er uændret, så skærmlæsere læser den som før.
    const splitWords = (el) => {
      let n = 0;
      const walk = (node) => {
        [...node.childNodes].forEach((child) => {
          if (child.nodeType === Node.ELEMENT_NODE) return walk(child);
          if (child.nodeType !== Node.TEXT_NODE) return;
          const parts = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (!part.trim()) return parts.append(" ");
            const word = document.createElement("span");
            word.className = "w";
            const inner = document.createElement("span");
            inner.textContent = part;
            inner.style.setProperty("--w", n++);
            word.append(inner);
            parts.append(word);
          });
          child.replaceWith(parts);
        });
      };
      walk(el);
      el.classList.add("split");
    };
    document.querySelectorAll(".section-title.reveal").forEach(splitWords);

    const setDelays = (items, step, offset = 0) =>
      items.forEach((el, i) => el.style.setProperty("--delay", `${(offset + i * step).toFixed(2)}s`));
    document.querySelectorAll(".reveal-stagger").forEach((group) => setDelays([...group.children], 0.08));
    // Hero'en er synlig fra start, så dens dele får hver sin forsinkelse.
    setDelays([...document.querySelectorAll(".hero-copy > .reveal")], 0.08, 0.05);

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    document.querySelectorAll(".reveal, .reveal-stagger").forEach((el) => io.observe(el));

    /* Nøgletal tæller op én gang, når de kommer til syne. Det færdige tal
       står i HTML'en, så det også er rigtigt uden JavaScript. */
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          cio.unobserve(entry.target);
          const el = entry.target;
          const target = parseInt(el.dataset.count, 10) || 0;
          const start = performance.now() + 450;
          el.textContent = "0";
          const tick = (now) => {
            const t = Math.min(1, Math.max(0, (now - start) / 1300));
            el.textContent = Math.round((1 - Math.pow(1 - t, 4)) * target);
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.6 }
    );
    document.querySelectorAll("[data-count]").forEach((el) => cio.observe(el));
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

  /* ---------- Kvittering efter indsendt formular ---------- */
  // Et <dialog> klarer selv Escape, fokuslås og baggrundsdæmpning. Vi tilføjer
  // kun klik-uden-for. Scroll-låsen bag vinduet styres af CSS ud fra [open],
  // så der ikke findes to tilstande, der kan komme ud af trit med hinanden.
  const thanks = document.getElementById("thanks");
  const showThanks = () => {
    if (!thanks || typeof thanks.showModal !== "function" || thanks.open) return;
    thanks.showModal();
  };
  if (thanks) {
    thanks.addEventListener("click", (event) => {
      // Selve dialogen fylder hele skærmen; kortet indeni gør ikke.
      if (event.target === thanks) thanks.close();
    });
    thanks.querySelector("[data-thanks-close]")
      ?.addEventListener("click", () => thanks.close());
  }

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
        showThanks();
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
