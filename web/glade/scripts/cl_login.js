document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('error-message');
    const loginButton = document.getElementById('login-button');

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setLoading(true);

        const username = usernameInput.value;
        const password = passwordInput.value;

        try {
            const response = await fetch('/glade/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed.');
            }

            // On success, redirect to the dashboard
            window.location.href = '/glade/index.html';

        } catch (error) {
            showError(error.message);
        } finally {
            setLoading(false);
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('d-none');
    }

    function setLoading(isLoading) {
        const spinner = loginButton.querySelector('.spinner-border');
        const text = loginButton.querySelector('#login-button-text');
        if (isLoading) {
            loginButton.disabled = true;
            spinner.classList.remove('d-none');
        } else {
            loginButton.disabled = false;
            spinner.classList.add('d-none');
        }
    }
});
