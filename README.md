# Desktop Spotlight AI

A private Windows desktop chat application powered by locally installed Ollama
models. It supports persistent conversations, file attachments, and
evidence-based questions about attached project folders.

## Live folders

When a folder is selected in the Windows app, Spotlight stores a live folder
reference and a metadata inventory instead of copying every file into the
conversation. For a source-grounded question, a read-only live-workspace loop
lets the local model browse directories, search the complete current tree,
inspect exact metadata, read safe text files in batches, and continue large
text files by byte offset. Tool results exist only for the active local Ollama
request and are not saved in the attachment or chat history. The workspace is
refreshed before project work and after approved changes. Models without tool
calling support fall back to the smaller selective-read path.

Whole-folder organization requests use a compact rule plan rather than asking
the model to generate one JSON action per file. The model chooses an ordered
hierarchy such as file type then alphabet; the native backend scans the complete
folder, expands the rule locally, detects conflicts, and previews counts plus a
small action sample. Approved work runs in batches of 200 with rollback on a
failed move, so the model's output size does not limit the folder size.

Specific move, copy, rename, folder creation, or deletion requests can still
produce explicit review cards. Nothing changes until the user reviews and
applies the proposal. Native path validation confines every action to the
selected folder and rejects traversal, root deletion, symbolic links, and
overwrites. Browser-selected folders remain read-only snapshots.

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
npm run qa:live-folder
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
- `qa:live-folder` checks actual local-model sort proposals and selective file
  choice without using canned application responses. Native Rust tests cover
  live metadata scans, ignored secrets, selective reads, and safe execution.

The V0.2 runner prints a random seed and stores every prompt, selected evidence
file, answer, score, and check result in `qa/v0.2-usefulness-report.md`. It does
not require a prewritten response phrase. To replay a result exactly:

```bash
node --no-warnings --experimental-strip-types qa/product-validation.mts --mode=v0.2 --seed=1891456394
```
