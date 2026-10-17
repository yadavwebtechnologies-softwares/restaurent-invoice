
"use strict";

/**
 * Restaurant Billing Software
 * Authentication guard for protected pages
 */

(() => {
  // Prevent protected page content from appearing before auth is checked.
  document.documentElement.style.visibility = "hidden";

  function redirectToLogin() {
    window.location.replace("login.html");
  }

  async function protectPage() {
    try {
      if (
        !window.restaurantFirebase?.ready ||
        !window.restaurantAuth?.watchAuth
      ) {
        throw new Error("Authentication service is unavailable.");
      }

      const initialized = await window.restaurantFirebase.ready;

      if (!initialized) {
        throw new Error("Firebase initialization failed.");
      }

      await window.restaurantAuth.watchAuth((user) => {
        if (!user) {
          redirectToLogin();
          return;
        }

        document.documentElement.style.visibility = "";
      });
    } catch (error) {
      console.error("Page authentication check failed:", error);
      redirectToLogin();
    }
  }

  protectPage();
})();
