
"use strict";

/**
 * Restaurant Billing Software
 * Shared Firebase Admin Authentication Service.
 *
 * Requires:
 * - js/firebase-config.js
 *
 * Authorized administrator:
 * - Only the configured ADMIN_UID is allowed.
 */

(() => {
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  /**
   * Get the existing shared Firebase Authentication instance
   * and SDK from firebase-config.js.
   */
  async function getAuthContext() {
    const firebase = window.restaurantFirebase;

    if (!firebase || !firebase.ready) {
      throw new Error(
        "Firebase configuration is unavailable. Check firebase-config.js."
      );
    }

    const initialized = await firebase.ready;

    if (
      !initialized ||
      !firebase.auth ||
      !firebase.sdk ||
      !firebase.sdk.auth
    ) {
      throw new Error(
        "Firebase Authentication could not be initialized."
      );
    }

    return {
      auth: firebase.auth,
      authSDK: firebase.sdk.auth
    };
  }

  /**
   * Sign in using Firebase Email/Password Authentication.
   * Only the authorized administrator UID is accepted.
   */
  async function signIn(email, password) {
    if (typeof email !== "string" || !email.trim()) {
      throw new Error("Please enter your email address.");
    }

    if (typeof password !== "string" || !password) {
      throw new Error("Please enter your password.");
    }

    const { auth, authSDK } = await getAuthContext();

    const credential = await authSDK.signInWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );

    if (credential.user.uid !== ADMIN_UID) {
      try {
        await authSDK.signOut(auth);
      } catch (error) {
        console.error(
          "Unable to sign out unauthorized account:",
          error
        );
      }

      throw new Error(
        "Access denied. This account is not the authorized administrator."
      );
    }

    return credential.user;
  }

  /**
   * Sign out the current Firebase user.
   */
  async function signOut() {
    const { auth, authSDK } = await getAuthContext();

    await authSDK.signOut(auth);
  }

  /**
   * Send a Firebase password-reset email.
   */
  async function sendPasswordReset(email) {
    if (typeof email !== "string" || !email.trim()) {
      throw new Error("Please enter your email address.");
    }

    const { auth, authSDK } = await getAuthContext();

    await authSDK.sendPasswordResetEmail(
      auth,
      email.trim()
    );
  }

  /**
   * Watch authentication state.
   *
   * Only the authorized administrator is exposed to page scripts.
   * Other signed-in accounts are signed out.
   *
   * Returns the unsubscribe function.
   */
  async function watchAuth(callback) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "An authentication callback is required."
      );
    }

    const { auth, authSDK } = await getAuthContext();

    let signingOutUnauthorizedUser = false;

    return authSDK.onAuthStateChanged(
      auth,
      async user => {
        if (!user) {
          signingOutUnauthorizedUser = false;
          callback(null);
          return;
        }

        if (user.uid === ADMIN_UID) {
          callback(user);
          return;
        }

        if (signingOutUnauthorizedUser) {
          return;
        }

        signingOutUnauthorizedUser = true;

        try {
          await authSDK.signOut(auth);
        } catch (error) {
          console.error(
            "Unable to sign out unauthorized account:",
            error
          );
        } finally {
          signingOutUnauthorizedUser = false;
        }

        callback(null);
      },
      error => {
        console.error(
          "Firebase authentication state error:",
          error
        );

        callback(null);
      }
    );
  }

  /**
   * Expose the authentication API to other page scripts.
   */
  window.restaurantAuth = Object.freeze({
    signIn,
    signOut,
    sendPasswordReset,
    watchAuth
  });

  console.info(
    "Restaurant Billing: authentication service loaded."
  );
})();
