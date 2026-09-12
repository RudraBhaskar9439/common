const form = document.getElementById('login-form');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('sign-in');
  const error = document.getElementById('login-error');
  button.disabled = true; button.textContent = 'Signing in…'; error.textContent = '';
  try {
    const response = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to sign in');
    form.elements.password.value = '';
    window.location.replace('/');
  } catch (err) { error.textContent = err.message || 'Unable to connect. Please try again.'; }
  finally { button.disabled = false; button.textContent = 'Sign in →'; }
});
