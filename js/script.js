/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Shared UI and Navigation
   No demo data, no secrets, no database writes
   ========================================================= */

(function () {
  "use strict";

  const MOBILE_BREAKPOINT = 860;

  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("menuBtn");
  const overlay = document.getElementById("overlay");

  let menuOpen = false;

  /* ---------------------------------------------------------
     1. Shared safe DOM helpers
     --------------------------------------------------------- */

  function getElement(target) {
    if (typeof target === "string") {
      return document.getElementById(target);
    }

    return target instanceof Element ? target : null;
  }

  function setText(target, value) {
    const element = getElement(target);

    if (!element) return false;

    element.textContent =
      value === null || value === undefined ? "" : String(value);

    return true;
  }

  function escapeHTML(value) {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return String(value ?? "").replace(
      /[&<>"']/g,
      function (character) {
        return replacements[character];
      }
    );
  }

  /* ---------------------------------------------------------
     2. Currency formatting
     --------------------------------------------------------- */

  const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function formatCurrency(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
      return "—";
    }

    return currencyFormatter.format(value);
  }

  /* ---------------------------------------------------------
     3. Common status messages
     --------------------------------------------------------- */

  function setStatus(target, message, state) {
    const element = getElement(target);

    if (!element) return false;

    element.textContent = String(message ?? "");

    element.classList.remove("is-connected", "is-error", "is-warning");

    if (state === "connected") {
      element.classList.add("is-connected");
    } else if (state === "error") {
      element.classList.add("is-error");
    } else if (state === "warning") {
      element.classList.add("is-warning");
    }

    return true;
  }

  function showMessage(target, message, type) {
    const element = getElement(target);

    if (!element) return false;

    element.textContent = String(message ?? "");

    element.classList.remove(
      "is-success",
      "is-error",
      "is-warning"
    );

    if (type === "success") {
      element.classList.add("is-success");
    } else if (type === "error") {
      element.classList.add("is-error");
    } else if (type === "warning") {
      element.classList.add("is-warning");
    }

    return true;
  }

  /* ---------------------------------------------------------
     4. Mobile navigation
     Uses existing HTML IDs and shared CSS classes.
     Does not intercept normal anchor navigation.
     --------------------------------------------------------- */

  function isMobileViewport() {
    return window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT}px)`
    ).matches;
  }

  function updateMenuState(open) {
    if (!app || !sidebar || !menuButton || !overlay) {
      return;
    }

    menuOpen = Boolean(open) && isMobileViewport();

    app.classList.toggle("is-menu-open", menuOpen);
    app.classList.toggle("menu-open", menuOpen);

    sidebar.setAttribute("aria-hidden", String(!menuOpen));
    menuButton.setAttribute("aria-expanded", String(menuOpen));
    menuButton.setAttribute(
      "aria-label",
      menuOpen ? "Close navigation" : "Open navigation"
    );

    overlay.hidden = !menuOpen;
  }

  function openMenu() {
    updateMenuState(true);
  }

  function closeMenu() {
    updateMenuState(false);
  }

  function toggleMenu() {
    if (menuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  if (app && sidebar && menuButton && overlay) {
    menuButton.addEventListener("click", toggleMenu);

    overlay.addEventListener("click", closeMenu);

    sidebar.addEventListener("click", function (event) {
      const link = event.target.closest("a[href]");

      if (link && isMobileViewport()) {
        /*
         * Let the browser follow the normal href.
         * Only close the mobile menu here.
         */
        closeMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menuOpen) {
        closeMenu();
        menuButton.focus();
      }
    });

    window.addEventListener("resize", function () {
      if (!isMobileViewport() && menuOpen) {
        closeMenu();
      }
    });

    /* Start with the mobile menu closed. */
    closeMenu();
  }

  /* ---------------------------------------------------------
     5. Active navigation link
     Based on the actual page URL, not JS redirection.
     --------------------------------------------------------- */

  function updateActiveNavigation() {
    if (!sidebar) return;

    const currentURL = new URL(window.location.href);
    const currentPath = currentURL.pathname.replace(/\/+$/, "");

    const links = sidebar.querySelectorAll(
      ".sidebar-navigation a.nav-item[href]"
    );

    links.forEach(function (link) {
      const linkURL = new URL(link.href, window.location.href);
      const linkPath = linkURL.pathname.replace(/\/+$/, "");

      const isActive = linkPath === currentPath;

      link.classList.toggle("active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  updateActiveNavigation();

  /* ---------------------------------------------------------
     6. Shared public helpers for other page scripts
     --------------------------------------------------------- */

  const sharedUI = Object.freeze({
    getElement: getElement,
    setText: setText,
    escapeHTML: escapeHTML,
    formatCurrency: formatCurrency,
    setStatus: setStatus,
    showMessage: showMessage,
    openMenu: openMenu,
    closeMenu: closeMenu
  });

  window.restaurantUI = sharedUI;

})();
