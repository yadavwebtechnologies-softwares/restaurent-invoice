
"use strict";

/**
 * Restaurant Billing Software
 * Admin login and password reset handlers
 */

(() => {
  const loginForm = document.getElementById("admin-login-form");
  const resetForm = document.getElementById("password-reset-form");

  const emailInput = document.getElementById("admin-email");
  const passwordInput = document.getElementById("admin-password");
  const loginMessage = document.getElementById("login-message");
  const loginButton = document.getElementById("admin-login-button");

  const resetEmail = document.getElementById("reset-email");
  const resetMessage = document.getElementById("reset-message");
  const resetButton = document.getElementById("reset-submit-button");

  function showMessage(element, text, type = "") {
    element.textContent = text;
    element.className = type;
  }

  function getErrorMessage(error) {
    const messages = {
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/user-not-found": "No account was found for this email.",
      "auth/too-many-requests":
        "Too many attempts. Please try again later.",
      "auth/network-request-failed":
        "Network error. Check your internet connection.",
      "auth/operation-not-allowed":
        "This authentication method is not enabled.",
      "auth/missing-email": "Please enter your email address.",
      "auth/invalid-continue-uri":
        "Password reset URL configuration is invalid.",
      "auth/unauthorized-continue-uri":
        "This website is not authorized for password reset."
    };

    return messages[error.code] ||
      "Something went wrong. Please try again.";
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      showMessage(loginMessage, "");
      loginButton.disabled = true;
      loginButton.textContent = "Signing in...";

      try {
        if (!window.restaurantFirebase?.ready) {
          throw new Error("Firebase configuration is unavailable.");
        }

        const initialized = await window.restaurantFirebase.ready;

        if (!initialized || !window.restaurantAuth) {
          throw new Error("Authentication service is unavailable.");
        }

        await window.restaurantAuth.signIn(
          emailInput.value,
          passwordInput.value
        );

        showMessage(
          loginMessage,
          "Login successful. Opening dashboard...",
          "success"
        );

        window.location.replace("index.html");
      } catch (error) {
        console.error("Admin login failed:", error);

        showMessage(
          loginMessage,
          error.code ? getErrorMessage(error) : error.message,
          "error"
        );

        passwordInput.value = "";
        passwordInput.focus();
      } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Sign In";
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      showMessage(resetMessage, "");
      resetButton.disabled = true;
      resetButton.textContent = "Sending...";

      try {
        if (!window.restaurantFirebase?.ready) {
          throw new Error("Firebase configuration is unavailable.");
        }

        const initialized = await window.restaurantFirebase.ready;

        if (!initialized || !window.restaurantAuth) {
          throw new Error("Authentication service is unavailable.");
        }

        await window.restaurantAuth.sendPasswordReset(
          resetEmail.value
        );

        showMessage(
          resetMessage,
          "If an eligible account exists, a password reset email will be sent. Check your inbox and spam folder.",
          "success"
        );
      } catch (error) {
        console.error("Password reset request failed:", error);

        showMessage(
          resetMessage,
          error.code ? getErrorMessage(error) : error.message,
          "error"
        );
      } finally {
        resetButton.disabled = false;
        resetButton.textContent = "Send Reset Link";
      }
    });
  }
})();
