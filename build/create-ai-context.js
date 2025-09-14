const fs = require('fs-extra');
const path = require('path');
const jsdoc2md = require('jsdoc-to-markdown');

/**
 * This script builds a single, comprehensive context.md file.
 * This file is designed to be provided to a Generative AI to make it an
 * expert on the Gingee platform.
 */
async function createContextFile() {
  try {
    console.log('Starting Gingee AI context bundle creation...');

    const projectRoot = path.resolve(__dirname, '..');
    const distPath = path.join(projectRoot, 'docs', 'ai-context');
    const tempPath = path.join(projectRoot, 'temp', `context-build-${Date.now()}`);
    const outputPath = path.join(distPath, 'ai-context.md');

    fs.ensureDirSync(distPath);
    fs.ensureDirSync(tempPath);

    // --- 1. Define the Source Files ---
    
    // The human-written conceptual guides
    const docFiles = [
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
      'docs/features.md'
    ];
    
    // The explicit list of PUBLIC app modules to include in the API reference
    const publicModuleFiles = [
      'modules/auth.js',
      'modules/cache.js',
      'modules/chart.js',
      'modules/crypto.js',
      'modules/dashboard.js',
      'modules/db.js',
      'modules/encode.js',
      'modules/formdata.js',
      'modules/fs.js',
      'modules/html.js',
      'modules/httpclient.js',
      'modules/image.js',
      'modules/pdf.js',
      'modules/platform.js',
      'modules/qrcode.js',
      'modules/utils.js',
      'modules/uuid.js',
      'modules/zip.js',
    ];

    // --- 2. Generate the API Reference from JSDoc ---
    console.log('Extracting JSDoc and generating API reference...');

    // Copy only the public modules to the temporary directory
    publicModuleFiles.forEach(file => {
        fs.copySync(path.join(projectRoot, file), path.join(tempPath, path.basename(file)));
    });

    // Run jsdoc-to-markdown on the clean, temporary directory
    const apiReferenceMd = await jsdoc2md.render({
        files: path.join(tempPath, '*.js'),
        'heading-depth': 2 // Start markdown headings at ##
    });

    // --- 3. Stitch all content together ---
    console.log('Stitching documentation files together...');
    
    let finalContent = [];

    // Add the intro/primer
    finalContent.push("# Gingee Expert Developer Context");
    finalContent.push("You are an expert developer for a Node.js application server called Gingee. Your goal is to help users build applications on this platform by exclusively using the following concepts and API reference. Always write server scripts in the required `module.exports = async function() { await gingee(async ($g) => { ... }) }` format.");
    
    // Add the core documentation
    docFiles.forEach(docPath => {
        const content = fs.readFileSync(path.join(projectRoot, docPath), 'utf8');
        finalContent.push('---\n');
        // Extract the title from the first line of the markdown file
        finalContent.push(`# ${content.split('\n')[0].replace('# ', '')}`);
        finalContent.push(content);
    });

    // Add the generated API reference
    finalContent.push('---\n');
    finalContent.push('# App Module API Reference');
    finalContent.push(apiReferenceMd);

    finalContent.push("## Important points to remember\n- Gingee is sandboxed and does not allow usage of any NodeJS builtin modules or other external libraries.\n- Some Gingee modules such as 'fs' sound similar to the NodeJS builtin modules but are not the same. Always refer the API reference to use these modules.\n- Always follow the security and permission guidelines outlined in the documentation.\n- File paths with leading slashes are relative to the scope root (BOX or WEB) as applicable.\n- File paths without leading slashes are relative to the working directory of the executing script.\n- Server script URLs do not end with '.js' or any other extension, when you are trying to access them e.g. via the Browser 'fetch' function");

    // --- 4. Write the final file ---
    fs.writeFileSync(outputPath, finalContent.join('\n\n'));
    
    // --- 5. Cleanup ---
    fs.removeSync(tempPath);

    console.log('\n\x1b[32m%s\x1b[0m', `✅ Gingee AI context bundle created successfully!`);
    console.log(`   Output: ${outputPath}`);

  } catch (err) {
    console.error('\n\x1b[31m%s\x1b[0m', 'Failed to create context bundle:');
    console.error(err);
    process.exit(1);
  }
}

createContextFile();
