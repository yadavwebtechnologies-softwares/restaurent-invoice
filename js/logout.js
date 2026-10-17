
"use strict";

/**
 * Restaurant Billing Software
 * Manual logout and configurable inactivity timeout.
 *
 * Reads the timeout from the existing Settings preference.
 * Does not define a fixed session duration.
 */

(() => {
  const SETTINGS_KEY = "restaurantBilling.settings.demo.v1";
  const ACTIVITY_KEY = "restaurantBilling.auth.lastActivity.v1";
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  let inactivityTimer = null;
  let currentTimeoutMs = null;
  let signedIn = false;
  let signingOut = false;
  let lastActivity = 0;

  function getTimeoutMs() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);

      if (!raw) return null;

      const settings = JSON.parse(raw);

      if (
        settings.application !== "restaurant-billing" ||
        !settings.misc
      ) {
        return null;
      }

      const minutes = Number(settings.misc.sessionTimeout);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return null;
      }

      return minutes * 60 * 1000;
    } catch (error) {
      console.error("Unable to read session timeout setting:", error);
      return null;
    }
  }

  function getLastActivity() {
    try {
      const value = Number(localStorage.getItem(ACTIVITY_KEY));

      return Number.isFinite(value) && value > 0 ? value : null;
    } catch (error) {
      console.error("Unable to read session activity:", error);
      return null;
    }
  }

  function saveLastActivity(timestamp) {
    lastActivity = timestamp;

    try {
      localStorage.setItem(ACTIVITY_KEY, String(timestamp));
    } catch (error) {
      console.error("Unable to save session activity:", error);
    }
  }

  function addLogoutButton() {
    if (document.getElementById("restaurantLogoutBtn")) return;

    const toolbar =
      document.querySelector(".topbar-right") ||
      document.querySelector(".topbar");

    if (!toolbar) {
      console.warn("Logout button could not find the page toolbar.");
      return;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.id = "restaurantLogoutBtn";
    button.className = "btn btn-soft";
    button.textContent = "Logout";
    button.setAttribute("aria-label", "Log out of Restaurant Billing");

    button.addEventListener("click", () => {
      endSession("manual");
    });

    const profile = toolbar.querySelector(".profile");

    if (profile && profile.parentElement === toolbar) {
      toolbar.insertBefore(button, profile);
    } else {
      toolbar.appendChild(button);
    }
  }

  function clearInactivityTimer() {
    if (inactivityTimer !== null) {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function scheduleTimeoutCheck() {
    clearInactivityTimer();

    if (!signedIn || signingOut) return;

    currentTimeoutMs = getTimeoutMs();

    if (currentTimeoutMs === null) {
      console.warn(
        "Session timeout is not active because no valid saved preference was found. Save the timeout in Settings."
      );
      return;
    }

    const activityTime = getLastActivity();

    if (activityTime === null) {
      saveLastActivity(Date.now());
      inactivityTimer = window.setTimeout(
        scheduleTimeoutCheck,
        currentTimeoutMs
      );
      return;
    }

    lastActivity = activityTime;

    const elapsed = Date.now() - activityTime;
    const remaining = currentTimeoutMs - elapsed;

    if (remaining <= 0) {
      endSession("timeout");
      return;
    }

    inactivityTimer = window.setTimeout(
      scheduleTimeoutCheck,
      remaining
    );
  }

  function recordActivity() {
    if (!signedIn || signingOut) return;

    const now = Date.now();

    // Avoid repeated storage writes for closely grouped events.
    if (now - lastActivity < 750) return;

    saveLastActivity(now);
    scheduleTimeoutCheck();
  }

  async function endSession(reason) {
    if (signingOut) return;

    signingOut = true;
    clearInactivityTimer();

    const button = document.getElementById("restaurantLogoutBtn");

    if (button) {
      button.disabled = true;
      button.textContent =
        reason === "timeout" ? "Session Expired..." : "Signing Out...";
    }

    try {
      if (!window.restaurantAuth?.signOut) {
        throw new Error("Firebase sign-out service is unavailable.");
      }

      await window.restaurantAuth.signOut();

      signedIn = false;

      try {
        localStorage.removeItem(ACTIVITY_KEY);
      } catch (error) {
        console.error("Unable to clear activity timestamp:", error);
      }

      window.location.replace("login.html");
    } catch (error) {
      console.error("Logout failed:", error);

      signingOut = false;

      if (button) {
        button.disabled = false;
        button.textContent = "Logout";
      }

      window.alert(
        "Logout could not be completed. Please try again."
      );

      // Retry the expired-session logout if timeout already elapsed.
      if (reason === "timeout") {
        inactivityTimer = window.setTimeout(
          () => endSession("timeout"),
          3000
        );
      } else {
        scheduleTimeoutCheck();
      }
    }
  }

  function handleStorageChange(event) {
    if (event.key === ACTIVITY_KEY) {
      const activityTime = Number(event.newValue);

      if (Number.isFinite(activityTime) && activityTime > 0) {
        lastActivity = activityTime;
      }

      scheduleTimeoutCheck();
      return;
    }

    if (event.key === SETTINGS_KEY) {
      scheduleTimeoutCheck();
    }
  }

  document.addEventListener("pointerdown", recordActivity, {
    passive: true
  });

  document.addEventListener("keydown", recordActivity);
  document.addEventListener("touchstart", recordActivity, {
    passive: true
  });
  document.addEventListener("scroll", recordActivity, {
    passive: true
  });
  document.addEventListener("click", recordActivity);

  window.addEventListener("storage", handleStorageChange);

  async function initialiseLogout() {
    try {
      if (!window.restaurantFirebase?.ready) {
        throw new Error("Firebase initialization is unavailable.");
      }

      const initialized = await window.restaurantFirebase.ready;

      if (!initialized || !window.restaurantAuth?.watchAuth) {
        throw new Error("Firebase authentication is unavailable.");
      }

      await window.restaurantAuth.watchAuth((user) => {
        if (!user || user.uid !== ADMIN_UID) {
          signedIn = false;
          clearInactivityTimer();
          return;
        }

        if (signingOut) return;

        signedIn = true;
        addLogoutButton();
        scheduleTimeoutCheck();
      });
    } catch (error) {
      console.error("Logout service initialization failed:", error);
    }
  }

  initialiseLogout();
})();
