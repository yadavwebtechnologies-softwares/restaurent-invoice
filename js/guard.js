
"use strict";

/**
 * Restaurant Billing Software
 * Authentication guard for protected pages.
 *
 * Requires:
 * - js/firebase-config.js
 * - js/auth.js
 *
 * Responsibilities:
 * - Hide protected page content until authentication is checked.
 * - Allow access only to the authorized administrator.
 * - Redirect unauthenticated users to login.html.
 * - Handle Firebase initialization and authentication errors.
 */

(() => {
  const LOGIN_PAGE = "login.html";
  const AUTH_CHECK_TIMEOUT = 15000;

  let redirectStarted = false;
  let pageAuthorized = false;
  let authCheckTimer = null;
  let unsubscribeAuth = null;

  // Hide protected page content until the initial auth check completes.
  document.documentElement.style.visibility = "hidden";

  /**
   * Redirect to the login page only once.
   */
  function redirectToLogin() {
    if (redirectStarted) {
      return;
    }

    redirectStarted = true;

    if (authCheckTimer !== null) {
      window.clearTimeout(authCheckTimer);
      authCheckTimer = null;
    }

    document.documentElement.style.visibility = "hidden";

    window.location.replace(LOGIN_PAGE);
  }

  /**
   * Display an authorized page.
   */
  function allowPageAccess() {
    if (redirectStarted) {
      return;
    }

    pageAuthorized = true;
    document.documentElement.style.visibility = "";
  }

  /**
   * Initialize Firebase, then monitor the administrator's
   * authentication state.
   */
  async function protectPage() {
    try {
      const firebase = window.restaurantFirebase;
      const authService = window.restaurantAuth;

      if (!firebase?.ready) {
        throw new Error(
          "Firebase configuration is unavailable. Check firebase-config.js."
        );
      }

      if (!authService?.watchAuth) {
        throw new Error(
          "Authentication service is unavailable. Check auth.js."
        );
      }

      const initialized = await firebase.ready;

      if (!initialized || !firebase.auth) {
        throw new Error(
          "Firebase initialization failed."
        );
      }

      // Wait for the initial authentication state.
      const initialAuthState = new Promise((resolve, reject) => {
        authCheckTimer = window.setTimeout(() => {
          authCheckTimer = null;

          reject(
            new Error(
              "Authentication check timed out. Please reload the page."
            )
          );
        }, AUTH_CHECK_TIMEOUT);

        Promise.resolve(
          authService.watchAuth(user => {
            if (redirectStarted) {
              return;
            }

            if (!user) {
              redirectToLogin();

              resolve(false);
              return;
            }

            allowPageAccess();

            resolve(true);
          })
        )
          .then(unsubscribe => {
            unsubscribeAuth = unsubscribe;
          })
          .catch(error => {
            reject(error);
          });
      });

      const isAuthorized = await initialAuthState;

      if (authCheckTimer !== null) {
        window.clearTimeout(authCheckTimer);
        authCheckTimer = null;
      }

      if (!isAuthorized) {
        return;
      }

      console.info(
        "Restaurant Billing: protected page access authorized."
      );
    } catch (error) {
      console.error(
        "Page authentication check failed:",
        error
      );

      redirectToLogin();
    }
  }

  // Start the protection process.
  protectPage();

  // Keep a reference to the auth subscription for debugging.
  // The listener remains active to detect later sign-outs.
  window.restaurantPageGuard = Object.freeze({
    get authorized() {
      return pageAuthorized;
    },

    get redirecting() {
      return redirectStarted;
    },

    unsubscribe() {
      if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
        unsubscribeAuth = null;
      }
    }
  });
})();
