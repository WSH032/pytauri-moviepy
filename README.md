# PyTauri + MoviePy

This is a demo to verify whether a [MoviePy]-based video editing [PyTauri] app can be developed using Vibe Coding.

All code was generated with VSCode Copilot under my review.

[PyTauri]: https://github.com/pytauri/pytauri
[MoviePy]: https://github.com/Zulko/moviepy/

## Features

- Integration of PyTauri with MoviePy; the frontend displays video editing effects
- MCP server for connecting to AI services

## Development

```bash
# install frontend dependencies
pnpm install

# install python dependencies
uv venv --python-preference only-system
source .venv/bin/activate
uv sync

# run the app
pnpm tauri dev
```
