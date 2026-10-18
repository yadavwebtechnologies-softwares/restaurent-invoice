/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Protected Page Authentication Guard
   Owner profile display and authorization
   No secrets, demo users or database writes
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const LOGIN_URL = "index.html";

  const access = {
    ready: false,
    authorized: false,
    user: null,
    error: null,
    readyPromise: null
  };

  window.restaurantAccess = access;

  let redirecting = false;

  function updateOwnerProfile(user) {
    if (!user || user.uid !== OWNER_UID) return;

    const displayName =
      typeof user.displayName === "string"
        ? user.displayName.trim()
        : "";

    const email =
      typeof user.email === "string"
        ? user.email.trim()
        : "";

    const accountLabel = displayName || email || "Owner";

    const nameElement = document.getElementById("ownerDisplayName");

    if (nameElement) {
      nameElement.textContent = accountLabel;
    }

    const avatarElement = document.getElementById("ownerAvatar");

    if (avatarElement) {
      const source = displayName || email || "Owner";
      const initials = source.includes("@")
        ? source.split("@")[0].split(/[._\-\s]+/).filter(Boolean)
        : source.split(/\s+/).filter(Boolean);

      avatarElement.textContent = initials
        .slice(0, 2)
        .map(function (part) {
          return part.charAt(0).toUpperCase();
        })
        .join("") || "O";

      avatarElement.setAttribute("aria-label", accountLabel);
      avatarElement.setAttribute("title", accountLabel);
    }
  }

  function updatePageStatus(message, isError) {
    const statusIds = [
      "dashboardStatus",
      "invoicePageStatus",
      "productsPageStatus",
      "settingsPageStatus",
      "sidebarConnectionStatus"
    ];

    statusIds.forEach(function (id) {
      const element = document.getElementById(id);

      if (!element) return;

      element.textContent = message;
      element.classList.remove("is-connected", "is-error");

      if (isError) {
        element.classList.add("is-error");
      }
    });
  }

  function redirectToLogin() {
    if (redirecting) return;

    redirecting = true;
    window.location.replace(LOGIN_URL);
  }

  function finish(authorized, user, error) {
    access.ready = true;
    access.authorized = Boolean(authorized);
    access.user = authorized ? user : null;
    access.error = error || null;

    if (access.authorized) {
      updateOwnerProfile(user);
    }

    document.dispatchEvent(
      new CustomEvent("restaurant-access-ready", {
        detail: {
          authorized: access.authorized,
          uid: access.user ? access.user.uid : null
        }
      })
    );
  }

  function getAuthAPI(firebase) {
    const api = firebase && firebase.sdk && firebase.sdk.auth;

    if (
      !firebase ||
      !firebase.ready ||
      !firebase.auth ||
      !api ||
      typeof api.onAuthStateChanged !== "function" ||
      typeof api.signOut !== "function"
    ) {
      throw new Error("Firebase Authentication is unavailable.");
    }

    return api;
  }

  async function initializeGuard() {
    const firebase = window.restaurantFirebase;

    if (!firebase || !firebase.readyPromise) {
      throw new Error("Firebase configuration loader is unavailable.");
    }

    const initialized = await firebase.readyPromise;

    if (!initialized || !firebase.ready) {
      throw new Error(
        firebase.error?.message || "Firebase initialization failed."
      );
    }

    const authAPI = getAuthAPI(firebase);

    return new Promise(function (resolve, reject) {
      let settled = false;
      let unsubscribe = null;

      function complete(authorized, user, error) {
        if (settled) return;

        settled = true;

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        finish(authorized, user, error);
        resolve(authorized);
      }

      try {
        unsubscribe = authAPI.onAuthStateChanged(
          firebase.auth,

          async function (user) {
            if (!user) {
              complete(false, null, "No authenticated owner session.");
              updatePageStatus("Authentication required.", true);
              redirectToLogin();
              return;
            }

            if (user.uid !== OWNER_UID) {
              try {
                await authAPI.signOut(firebase.auth);
              } catch (error) {
                console.error(
                  "Unauthorized session sign-out failed:",
                  error && error.code ? error.code : "unknown"
                );
              }

              complete(
                false,
                null,
                "The current account is not authorized."
              );

              redirectToLogin();
              return;
            }

            complete(true, user, null);
            updatePageStatus("Owner session verified.", false);
          },

          function (error) {
            const message =
              error && error.code
                ? "Authentication check failed: " + error.code
                : "Authentication check failed.";

            complete(false, null, message);
            updatePageStatus(
              "Unable to verify the owner session.",
              true
            );

            redirectToLogin();
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  access.readyPromise = initializeGuard()
    .then(function (authorized) {
      if (!authorized) {
        return false;
      }

      return true;
    })
    .catch(function (error) {
      access.ready = true;
      access.authorized = false;
      access.user = null;
      access.error = error instanceof Error
        ? error.message
        : "Unknown authentication error.";

      console.error(
        "Protected-page authorization failed:",
        access.error
      );

      updatePageStatus(
        "Authentication unavailable. Returning to login.",
        true
      );

      finish(false, null, access.error);
      redirectToLogin();

      return false;
    });

})();
