"use strict";

/**
 * Restaurant Billing Software
 * Admin login form handler
 */

(() => {
  const form = document.getElementById("admin-login-form");

  if (!form) {
    return;
  }

  const emailInput = document.getElementById("admin-email");
  const passwordInput = document.getElementById("admin-password");
  const message = document.getElementById("login-message");
  const submitButton = document.getElementById("admin-login-button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    message.textContent = "";
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";

    try {
      if (!window.restaurantFirebase?.ready) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const firebase = await window.restaurantFirebase.ready;

      if (!firebase || !window.restaurantAuth) {
        throw new Error("Authentication service is unavailable.");
      }

      await window.restaurantAuth.signIn(
        emailInput.value,
        passwordInput.value
      );

      message.textContent = "Login successful. Opening dashboard...";

      window.location.replace("index.html");
    } catch (error) {
      console.error("Admin login failed:", error);

      const errorMessages = {
        "auth/invalid-credential":
          "Email or password is incorrect.",
        "auth/invalid-email":
          "Please enter a valid email address.",
        "auth/too-many-requests":
          "Too many attempts. Please try again later.",
        "auth/network-request-failed":
          "Network error. Check your internet connection."
      };

      message.textContent =
        errorMessages[error.code] ||
        error.message ||
        "Login failed. Please try again.";

      passwordInput.value = "";
      passwordInput.focus();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Sign In";
    }
  });
})();
