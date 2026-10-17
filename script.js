"use strict";

/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Dashboard JavaScript
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const menuBtn = document.getElementById("menuBtn");

  const mobileQuery = window.matchMedia("(max-width: 900px)");

  if (!sidebar || !overlay || !menuBtn) {
    console.error(
      "Dashboard initialization failed: sidebar, overlay, or menu button is missing."
    );
    return;
  }

  /* =======================================================
     MOBILE SIDEBAR
     ======================================================= */

  function openSidebar() {
    if (!mobileQuery.matches) return;

    sidebar.classList.add("open");
    overlay.classList.add("show");

    menuBtn.setAttribute("aria-expanded", "true");
    sidebar.setAttribute("aria-hidden", "false");
    overlay.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");

    menuBtn.setAttribute("aria-expanded", "false");
    sidebar.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";
  }

  function toggleSidebar() {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  menuBtn.setAttribute("aria-controls", "sidebar");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.setAttribute("aria-label", "Open navigation menu");

  sidebar.setAttribute("aria-hidden", "true");
  overlay.setAttribute("aria-hidden", "true");

  menuBtn.addEventListener("click", toggleSidebar);

  overlay.addEventListener("click", closeSidebar);

  /* Close the sidebar using the Escape key. */
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      sidebar.classList.contains("open")
    ) {
      closeSidebar();
      menuBtn.focus();
    }
  });

  /* Reset the sidebar when switching back to desktop width. */
  function handleViewportChange() {
    if (!mobileQuery.matches) {
      closeSidebar();
      sidebar.setAttribute("aria-hidden", "false");
    } else if (!sidebar.classList.contains("open")) {
      sidebar.setAttribute("aria-hidden", "true");
    }
  }

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", handleViewportChange);
  } else {
    /* Compatibility with older browsers. */
    mobileQuery.addListener(handleViewportChange);
  }

  /* =======================================================
     NAVIGATION PLACEHOLDERS
     Actual page navigation will be connected when the
     individual pages are created.
     ======================================================= */

  const navigationLinks = document.querySelectorAll(
    ".sidebar .nav-item"
  );

  navigationLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const destination = link.getAttribute("href");

      /* Prevent placeholder links from jumping to the top. */
      if (!destination || destination === "#") {
        event.preventDefault();
      }

      /* Close the mobile menu after a navigation selection. */
      if (mobileQuery.matches) {
        closeSidebar();
      }
    });
  });

  /* Prevent unfinished footer links from jumping to the top. */
  document.querySelectorAll('.page-footer a[href="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
    });
  });

  /* =======================================================
     DASHBOARD INITIALIZATION
     ======================================================= */

  handleViewportChange();

  console.info("Restaurant Billing Dashboard initialized.");
});
