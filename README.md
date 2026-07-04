# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Platform Setup

This project is set up to run on both macOS and Windows. The app code and Tauri configuration are cross-platform, but each OS needs its own native prerequisites.

### macOS

- Install Rust with `rustup`.
- Install Xcode Command Line Tools with `xcode-select --install`.
- Install the full Xcode app if you plan to build release bundles or ship the app.

### Windows

- Install Rust with `rustup-init.exe` from the Rust website.
- Install Visual Studio Build Tools with the "Desktop development with C++" workload.
- Make sure the Microsoft Edge WebView2 Runtime is installed.

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
