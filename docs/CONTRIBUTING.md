# Contributing to Gingee

First off, thank you for your interest in Gingee! We're thrilled that you're considering contributing to a project that's exploring the future of software development.

Gingee is a pioneering project, deeply co-authored by a human architect and a Generative AI partner. This unique origin shapes our development philosophy. We value not just the final code, but the creative process of dialogue, refinement, and testing that produces it.

This guide provides a set of conventions for contributing to the project, ensuring that we can grow the platform in a consistent, secure, and collaborative way.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct [MD](./CODE_OF_CONDUCT.md) [HTML](./CODE_OF_CONDUCT.html). By participating, you are expected to uphold this code.

## How Can I Contribute?

There are many ways to contribute to Gingee, and all are valuable.

*   **Reporting Bugs:** If you find a bug, please open an issue on our GitHub repository. Provide a clear title, a detailed description of the bug, steps to reproduce it, and what you expected to happen versus what actually happened.
*   **Suggesting Enhancements:** Have an idea for a new module or a feature enhancement? We'd love to hear it! Open an issue with a clear title and a detailed proposal explaining the feature and why it would be a valuable addition to Gingee.
*   **Improving Documentation:** Great documentation is the key to a great project. If you find a typo, a confusing explanation, or feel a section is missing, please don't hesitate to open an issue or a Pull Request.

## Submitting a Pull Request (The Gingee Way)

We have a unique development process called **Dialog-Driven Development**, which embraces collaboration with AI. While you are free to write code entirely by hand, we encourage and have a process for contributions made with a GenAI partner.

Here's the workflow for submitting a code contribution:

1.  **Find an Issue:** Look for an existing issue to work on or open a new one to discuss your proposed changes. This helps ensure your work aligns with the project's goals.

2.  **Fork & Branch:** Fork the repository and create a new branch for your feature or fix.
    ```bash
    git checkout -b feat/my-awesome-feature
    ```

3.  **Develop Your Solution:**
    *   Make your code changes.
    *   Adhere to the existing code style (we use Prettier for automatic formatting).
    *   **Add or update tests** that cover your changes. This is non-negotiable. All code must be verifiable.
    *   **Update documentation** (JSDoc comments in the code, and any relevant `.md` files in the `/docs` folder).

4.  **The "Prompt Log" (For AI-Assisted Contributions)**
    > If you collaborated with a Generative AI to produce your solution, we ask that you document this unique process.

    *   Create a file named `PROMPT.md` in the root of your branch.
    *   In this file, please include:
        1.  The key prompts you used to generate the initial code.
        2.  A brief summary of the AI's initial output and its flaws.
        3.  A description of the refinements, bug fixes, and tests you, the human developer, had to add to get the code to production quality.
    *   This log is incredibly valuable. It helps us understand the strengths and weaknesses of this new development paradigm and provides a learning opportunity for the entire community.

5.  **Commit Your Changes:** We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. This helps us automate changelogs and clearly communicate the purpose of every change.
    *   **Examples:**
        -   `feat: Add 'websockets' module for real-time communication`
        -   `fix: Correctly handle cache clearing in platform.deleteApp`
        -   `docs: Update reference guide for the 'db' module`

6.  **Submit the Pull Request:** Push your branch to your fork and open a Pull Request against the `main` branch of the Gingee repository.
    *   In your PR description, link to the issue it resolves (e.g., "Closes #42").
    *   If you included a `PROMPT.md`, please mention it.

### Development Environment Setup

1.  Fork and clone the repository.
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  To run the full test suite for all database adapters, you will need local instances of PostgreSQL and MySQL running. Configure the necessary credentials in the `app.json` files within the `web/` directory.
4.  Start the server in development mode:
    ```bash
    npm start
    ```

Thank you again for your interest in making Gingee better. We look forward to your contributions
