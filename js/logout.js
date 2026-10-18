/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Shared Logout Functionality
   No hardcoded secrets or demo accounts
   ========================================================= */

(function () {
  "use strict";

  const LOGIN_URL = "index.html";
  const logoutButtons = document.querySelectorAll("#logoutBtn");

  if (!logoutButtons.length) {
    return;
  }

  let logoutInProgress = false;

  function setLogoutMessage(message, type) {
    const candidates = [
      "dashboardStatus",
      "invoicePageStatus",
      "productsPageStatus",
      "settingsPageStatus"
    ];

    for (const id of candidates) {
      const element = document.getElementById(id);

      if (!element) continue;

      element.textContent = message;
      element.classList.remove("is-connected", "is-error", "is-warning");

      if (type) {
        element.classList.add("is-" + type);
      }

      return;
    }
  }

  function setButtonsDisabled(disabled) {
    logoutButtons.forEach(function (button) {
      button.disabled = disabled;
      button.setAttribute("aria-busy", String(disabled));

      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent.trim();
      }

      button.textContent = disabled
        ? "Signing Out..."
        : button.dataset.originalLabel;
    });
  }

  async function handleLogout() {
    if (logoutInProgress) return;

    logoutInProgress = true;
    setButtonsDisabled(true);
    setLogoutMessage("Signing out securely...", "warning");

    try {
      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready || !firebase.auth) {
        throw new Error(
          firebase.error?.message || "Firebase Authentication is unavailable."
        );
      }

      const authAPI = firebase.sdk?.auth;

      if (!authAPI || typeof authAPI.signOut !== "function") {
        throw new Error("Firebase sign-out method is unavailable.");
      }

      await authAPI.signOut(firebase.auth);

      /*
       * Replace the current protected page in history.
       * The login page remains a normal HTML destination.
       */
      window.location.replace(LOGIN_URL);

    } catch (error) {
      logoutInProgress = false;
      setButtonsDisabled(false);

      console.error("Sign-out failed:", {
        code: error && error.code ? error.code : "unknown"
      });

      setLogoutMessage(
        "Could not sign out. Check your connection and try again.",
        "error"
      );
    }
  }

  logoutButtons.forEach(function (button) {
    button.addEventListener("click", handleLogout);
  });

})();
