const fs = require('fs-extra');
const path = require('path');
const fg = require('fast-glob');

/**
 * This script builds a single, comprehensive context-dev.md file.
 * This file contains the full source code and conceptual guides for the entire
 * Gingee ecosystem, designed to prime a GenAI partner for core development.
 */
async function createDevContextFile() {
  try {
    console.log('Starting Gingee Core Developer Context bundle creation...');

    const projectRoot = path.resolve(__dirname, '..');
    const distPath = path.join(projectRoot, 'build', 'dist');
    const outputPath = path.join(distPath, 'ai-context-gingee-dev.md');

    fs.ensureDirSync(distPath);

    // --- 1. Define the Source Files and Directories ---
    const sources = [
      {
        title: "Core Conceptual Guides",
        files: [
          'docs/concepts.md',
          'docs/gingee-cli.md',
          'docs/server-config.md',
          'docs/glade-admin.md',
          'docs/app-structure.md',
          'docs/server-script.md',
          'docs/app-developer-guide.md',
          'docs/packaging-guide.md',
          'docs/permissions-guide.md',
          'docs/app-spadev-guide.md',
          'docs/gstore-hosting-guide.md',
          'docs/features.md',
          'docs/roadmap.md'
        ]
      },
      {
        title: "Gingee package.json",
        files: ['package.json']
      },
      {
        title: "Gingee Server Engine",
        files: ['gingee.js']
      },
      {
        title: "Engine Modules",
        baseDir: 'modules',
        glob: '**/*.js'
      },
      {
        title: "Build System",
        baseDir: 'build',
        glob: '**/*.js'
      },
      {
        title: "Core Admin App: `glade`",
        description: "The source code for the bundled `glade` admin panel. This serves as a primary example of a privileged, MPA-style Gingee application.",
        baseDir: 'web/glade',
        glob: '**/*.{js,html,css,json,gpkg,md}',
        ignore: ['box/logs/**']
      },
      {
        title: "Server Script & Module Tests",
        description: "The source code for all server scripts used to test the app modules. These are excellent, practical examples of how to use each module's API.",
        baseDir: 'web/tests/box',
        glob: '*.js'
      },
      {
        title: "Server Script & Module Tests Runner",
        description: "The source code for the test runner web application.",
        files: [
          'web/tests/index.html',
          'web/tests/scripts/cl_tester.js',
          'web/tests/box/tests.json',
          'web/tests/box/api/get-test-source.js',
          'web/tests/box/api/get-tests.js'
        ]
      },
      {
        title: "Gingee Jest Test Suite",
        description: "The source code for all Jest tests in the Gingee framework. These tests cover the core functionality and edge cases of the framework.",
        baseDir: 'test',
        glob: '**/*.js'
      },
      {
        title: "Privileged App and Platform Module Tests",
        description: "The source code for all server scripts used to test the platform module accessible for privileged apps. These are excellent, practical examples of how to use platform module's API.",
        baseDir: 'web/tests/box',
        glob: '*.js'
      },
      {
        title: "Gingee CLI - Core",
        baseDir: '../gingee-cli',
        files: ['index.js']
      },
      {
        title: "Gingee CLI - Commands",
        baseDir: '../gingee-cli/commands',
        glob: '**/*.js'
      },
      {
        title: "Gingee CLI - Templates",
        baseDir: '../gingee-cli/templates',
        glob: '**/*'
      }
    ];

    let finalContent = [];

    // --- 2. Add the Initial Priming Prompt ---
    finalContent.push("# Gingee Core Contributor Context");
    finalContent.push("You are a senior full-stack architect and a core contributor to the Gingee platform. Your goal is to continue the development of the Gingee server engine, its modules, and its CLI tooling. This document contains the complete source code and architectural documentation for the entire ecosystem. Analyze it carefully and be prepared to act as a core developer.");

    // --- 3. NEW: Add the Project Structure Overview ---
    finalContent.push('\n---\n\n# Gingee Project Root: Folder Structure');
    finalContent.push(`
    This document describes the source code of the Gingee monorepo, which contains the 'gingee' engine and the 'gingee-cli' tool.

    -   **\`project_root/\`**: The root of the development repository.
        -   **\`gingee.js\`**: The main entry point for the Gingee server engine.
        -   **\`package.json\`**: The master manifest for the entire project, including all production and development dependencies for the engine.
        -   **\`build/\`**: Contains all build-related scripts and output.
            -   **\`package.js\`**: The script that builds the distributable \`gingee\` NPM package.
            -   **\`create-ai-context.js\`**: A script that generates a AI priming context documentation for app developers.
            -   **\`create-dev-context.js\`**: This script, which generates this context bundle to prime AI to be a Gingee project core developer.
            -   **\`dist/\`**: The output directory for all build artifacts.
        -   **\`docs/\`**: Contains all high-level documentation in Markdown format (\`concepts.md\`, \`cli - reference.md\`, etc.).
        -   **\`modules/\`**: Contains the source code for all of Gingee's core and app modules (the "standard library").
            -   **\`cache_drivers/\`**: Adapters for different caching backends (memory, redis).
            -   **\`dbproviders/\`**: Adapters for different database systems (postgres, sqlite, etc.).
        -   **\`settings/\`**: Contains default configuration assets that are bundled with the engine.
            -   **\`fonts/\`**: Default font files (e.g., Roboto) for the PDF and Chart modules.
            -   **\`ssl/\`**: Placeholder directory for SSL certificate files.
        -   **\`backups/\`**: (Runtime) Created by the server to store application backups (\`.gin\` files). Ignored by version control.
        -   **\`logs/\`**: (Runtime) The default location for main server log files. Ignored by version control.
        -   **\`temp/\`**: (Runtime) A directory for temporary files created during lifecycle operations. Ignored by version control.
        -   **\`web/\`**: The source directory for core applications that are bundled with the engine, like \`glade\`.
    -   **\`../gingee-cli/\`**: A sibling directory containing the source code for the CLI tool.
    `);

    // --- 3. Process and Stitch all Sources ---
    for (const source of sources) {
      console.log(`Processing section: ${source.title}...`);
      finalContent.push(`\n---\n\n# ${source.title}`);

      if (source.description) {
        finalContent.push(`\n_${source.description}_\n`);
      }

      let filePaths = [];
      if (source.files) {
        filePaths = source.files.map(f => path.join(source.baseDir || projectRoot, f));
      } else if (source.glob) {
        const searchDirectory = source.baseDir ? path.join(projectRoot, source.baseDir) : projectRoot;
        filePaths = await fg(source.glob, {
          cwd: searchDirectory,
          dot: true,
          absolute: true,
          ignore: source.ignore || []
        });
      }
      console.log('File count: ', filePaths.length);

      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) {
          console.warn(`   - WARNING: Source file not found, skipping: ${filePath}`);
          continue;
        }
        const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const fileExtension = path.extname(filePath).substring(1);

        finalContent.push(`\n### FILE: \`${relativePath}\`\n`);
        finalContent.push(`\`\`\`${fileExtension || 'text'}`);
        finalContent.push(fileContent);
        finalContent.push('```');
      }
    }

    // --- 4. Write the Final File ---
    fs.writeFileSync(outputPath, finalContent.join('\n'));

    console.log('\n\x1b[32m%s\x1b[0m', `✅ Gingee Core Developer Context created successfully!`);
    console.log(`   Output: ${outputPath}`);

  } catch (err) {
    console.error('\n\x1b[31m%s\x1b[0m', 'Failed to create dev context bundle:');
    console.error(err);
    process.exit(1);
  }
}

createDevContextFile();
