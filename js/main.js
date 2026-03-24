/* ═══════════════════════════════════════════════════════════════
   CodeHumanist — main.js
   Nav scroll · Canvas node graph · Reveal animations · Waitlist
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── Nav: add .scrolled class on scroll ────────────────────── */
(function initNav() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');

  if (!nav) return;

  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const isOpen = links.classList.toggle('open');
      toggle.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Close on link click
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        links.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        links.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
})();

/* ── Hero Canvas: codebase node-graph animation ────────────── */
(function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H, nodes, animId;
  const NODE_COUNT = 38;
  const MAX_DIST = 180;
  const COLORS = {
    node: [
      'rgba(107,33,168,',   // purple-700
      'rgba(147,51,234,',   // purple-500
      'rgba(192,132,252,',  // purple-300
      'rgba(232,121,249,',  // fuchsia
    ],
    edge: 'rgba(107,33,168,',
  };

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function makeNodes() {
    nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      vx:   (Math.random() - 0.5) * 0.35,
      vy:   (Math.random() - 0.5) * 0.35,
      r:    Math.random() * 2.5 + 1.5,
      color: COLORS.node[Math.floor(Math.random() * COLORS.node.length)],
      alpha: Math.random() * 0.5 + 0.3,
      pulseOffset: Math.random() * Math.PI * 2,
    }));
  }

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);
    const t = ts / 1000;

    // Update positions
    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -20) n.x = W + 20;
      if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20;
      if (n.y > H + 20) n.y = -20;
    });

    // Draw edges
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          const opacity = (1 - dist / MAX_DIST) * 0.25;
          ctx.beginPath();
          ctx.strokeStyle = `${COLORS.edge}${opacity})`;
          ctx.lineWidth = 0.8;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    nodes.forEach(n => {
      const pulse = Math.sin(t * 1.5 + n.pulseOffset) * 0.3 + 0.7;
      const r = n.r * pulse;
      const alpha = n.alpha * pulse;

      // Glow
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
      grd.addColorStop(0, `${n.color}${alpha * 0.5})`);
      grd.addColorStop(1, `${n.color}0)`);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 4, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `${n.color}${alpha})`;
      ctx.fill();
    });

    animId = requestAnimationFrame(draw);
  }

  function init() {
    resize();
    makeNodes();
    if (animId) cancelAnimationFrame(animId);
    animId = requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(() => {
    resize();
    makeNodes();
  });
  ro.observe(canvas);

  // Pause when not visible
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        if (!animId) animId = requestAnimationFrame(draw);
      } else {
        if (animId) { cancelAnimationFrame(animId); animId = null; }
      }
    });
  });
  io.observe(canvas);

  init();
})();

/* ── Scroll-reveal animations ───────────────────────────────── */
(function initReveal() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!els.length) return;

  // Immediately reveal hero elements after short delay
  const heroEls = document.querySelectorAll('.hero [data-reveal]');
  heroEls.forEach(el => {
    const delay = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);
    setTimeout(() => el.classList.add('revealed'), 100 + delay);
  });

  // Observe all other elements
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  els.forEach(el => {
    if (!el.closest('.hero')) observer.observe(el);
  });
})();

/* ── Waitlist form handling ─────────────────────────────────── */
(function initWaitlist() {
  const STORAGE_KEY = 'ch_waitlist_email';

  function handleSubmit(form, feedbackEl) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = form.querySelector('input[type="email"]');
      const btn = form.querySelector('button[type="submit"]');
      const email = emailInput?.value?.trim();

      if (!email || !emailInput.checkValidity()) {
        showFeedback(feedbackEl, 'Please enter a valid email address.', 'error');
        emailInput?.focus();
        return;
      }

      // Prevent double-submit
      btn.disabled = true;
      btn.querySelector('.btn-text').textContent = 'Adding you…';

      try {
        // Store locally
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!existing.includes(email)) {
          existing.push(email);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        }

        // Small artificial delay for UX
        await new Promise(r => setTimeout(r, 600));

        showFeedback(feedbackEl, "You're on the list! We'll be in touch.", 'success');
        emailInput.value = '';

        // Sync both forms to success state
        document.querySelectorAll('.waitlist-form input[type="email"]').forEach(i => {
          i.value = '';
        });

        // Update button
        btn.querySelector('.btn-text').textContent = "You're in ✓";
        btn.style.background = 'rgba(134,239,172,0.15)';
        btn.style.borderColor = 'rgba(134,239,172,0.3)';
        btn.style.color = '#86efac';

      } catch (err) {
        showFeedback(feedbackEl, 'Something went wrong — please try again.', 'error');
        btn.disabled = false;
        btn.querySelector('.btn-text').textContent = 'Join the Waitlist';
      }
    });
  }

  function showFeedback(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = `form-feedback ${type}`;
  }

  const heroForm = document.getElementById('waitlist-form-hero');
  const heroFeedback = document.getElementById('form-feedback-hero');
  if (heroForm) handleSubmit(heroForm, heroFeedback);

  const ctaForm = document.getElementById('waitlist-form-cta');
  const ctaFeedback = document.getElementById('form-feedback-cta');
  if (ctaForm) handleSubmit(ctaForm, ctaFeedback);
})();

/* ── Smooth scroll for anchor links ────────────────────────── */
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
