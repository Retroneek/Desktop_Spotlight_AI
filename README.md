# Desktop Spotlight AI

A private Windows desktop chat application powered by locally installed Ollama
models. It supports persistent conversations, file attachments, and
evidence-based questions about attached project folders.

## Platform Setup

The current release workflow targets Windows. The React frontend and Tauri
backend remain cross-platform, but each operating system needs its own native
prerequisites.

### macOS

- Install Rust with `rustup`.
- Install Xcode Command Line Tools with `xcode-select --install`.
- Install Xcode when building native release bundles.

### Windows

- Install Rust with `rustup-init.exe` from the Rust website.
- Install Visual Studio Build Tools with the "Desktop development with C++" workload.
- Make sure the Microsoft Edge WebView2 Runtime is installed.
- Install and start Ollama, then pull at least one chat model.

## Development

After the prerequisites are installed:

```bash
npm install
npm run tauri dev
```

For release builds:

```bash
npm run tauri build
```

The Windows executable and installers are written under
`src-tauri/target/release`.

## Quality validation

With Ollama running and at least one chat model installed:

```bash
npm run qa:v0.1
npm run qa:v0.2
npm run qa:product
npm run qa:responses
```

- `qa:v0.1` checks model discovery, endpoint handling, streaming, project
  scanning limits, ignored private/dependency paths, routing, retrieval, and
  build artifacts.
- `qa:v0.2` shuffles general user scenarios and changes prompt wording and
  sample data on every run. It grades the app's actual generated answers for
  meaning and behavior, then applies deterministic checks to facts such as
  arithmetic, paths, HTTP methods, formatting, and privacy exclusions.
- `qa:responses` is the deterministic regression suite for previously fixed
  behavior.

The V0.2 runner prints a random seed and stores every prompt, selected evidence
file, answer, score, and check result in `qa/v0.2-usefulness-report.md`. It does
not require a prewritten response phrase. To replay a result exactly:

```bash
node --no-warnings --experimental-strip-types qa/product-validation.mts --mode=v0.2 --seed=1891456394
```
