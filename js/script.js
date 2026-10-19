/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Shared UI and Navigation
   Common page-refresh infrastructure
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
  let pageRefreshHandler = null;
  let pageRefreshButton = null;
  let refreshInProgress = false;

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

    element.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

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
     4. Consistent page-refresh infrastructure
     --------------------------------------------------------- */

  function getPageStatusElement() {
    const candidates = [
      "dashboardStatus",
      "invoicePageStatus",
      "invoicesPageStatus",
      "productsPageStatus",
      "reportsPageStatus",
      "settingsPageStatus"
    ];

    for (const id of candidates) {
      const element = document.getElementById(id);

      if (element) return element;
    }

    return null;
  }

  function reportRefreshError(error) {
    console.error("Page data refresh failed:", error);

    const statusElement = getPageStatusElement();

    if (statusElement) {
      setStatus(
        statusElement,
        "Refresh failed. Check your connection and try again.",
        "error"
      );
    }
  }

  function createRefreshButton() {
    if (pageRefreshButton && pageRefreshButton.isConnected) {
      return pageRefreshButton;
    }

    const topbarRight = document.querySelector(".topbar-right");

    if (!topbarRight) {
      return null;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.id = "pageRefreshBtn";
    button.className = "btn btn-secondary btn-small page-refresh-button";
    button.textContent = "Refresh";
    button.setAttribute("aria-label", "Refresh current page data");
    button.title = "Load the latest data for this page";

    button.addEventListener("click", async function () {
      if (
        refreshInProgress ||
        button.disabled ||
        typeof pageRefreshHandler !== "function"
      ) {
        return;
      }

      refreshInProgress = true;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Refreshing...";

      try {
        await pageRefreshHandler();
      } catch (error) {
        reportRefreshError(error);
      } finally {
        refreshInProgress = false;
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = "Refresh";
      }
    });

    topbarRight.insertBefore(button, topbarRight.firstChild);

    pageRefreshButton = button;

    return button;
  }

  /*
   * Each page registers its own safe data-refresh function.
   * No automatic page reload is performed.
   * The page-specific handler must preserve current form/filter state.
   */
  function registerPageRefresh(handler) {
    if (typeof handler !== "function") {
      throw new TypeError(
        "Page refresh handler must be a function."
      );
    }

    pageRefreshHandler = handler;

    const button = createRefreshButton();

    if (!button) {
      pageRefreshHandler = null;
      return function () {};
    }

    /*
     * Return an unregister function for page-specific cleanup.
     */
    return function unregisterPageRefresh() {
      if (pageRefreshHandler === handler) {
        pageRefreshHandler = null;
      }

      if (pageRefreshButton) {
        pageRefreshButton.remove();
        pageRefreshButton = null;
      }
    };
  }

  /* ---------------------------------------------------------
     5. Mobile navigation
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

    closeMenu();
  }

  /* ---------------------------------------------------------
     6. Active navigation link
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
     7. Shared public helpers for other page scripts
     --------------------------------------------------------- */

  const sharedUI = Object.freeze({
    getElement: getElement,
    setText: setText,
    escapeHTML: escapeHTML,
    formatCurrency: formatCurrency,
    setStatus: setStatus,
    showMessage: showMessage,
    openMenu: openMenu,
    closeMenu: closeMenu,
    registerPageRefresh: registerPageRefresh
  });

  window.restaurantUI = sharedUI;

})();
