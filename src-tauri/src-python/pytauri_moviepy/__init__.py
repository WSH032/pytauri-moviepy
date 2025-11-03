# --- Hack `sys.path` to support using `pywin32` ---
#
# `mcp` depends on `pywin32`, and `pywin32` does not work properly in embedded environments, see:
# - <https://github.com/indygreg/PyOxidizer/issues/442#issuecomment-940829173>
# - <https://github.com/mhammond/pywin32/blob/572e657c6c24415fc364d9e31bbe78c0dac6eb9c/win32/Lib/pywintypes.py#L8>
import sys


if sys.platform == "win32" and hasattr(sys, "frozen"):
    import pywin32_system32

    sys.path.append(pywin32_system32.__path__[0])

# --------------------------------------------------


from os import getenv
import atexit
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Optional

from anyio.from_thread import start_blocking_portal
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from pytauri import (
    Commands,
    builder_factory,
    context_factory,
    Emitter,
    AppHandle,
)
from mcp.server.fastmcp import FastMCP
from anyio import to_thread

from moviepy import VideoClip, VideoFileClip


# Enable TypeScript generation in development
PYTAURI_GEN_TS = getenv("PYTAURI_GEN_TS") != "0"

commands: Commands = Commands(experimental_gen_ts=PYTAURI_GEN_TS)

mcp = FastMCP("pytauri-moviepy")

app_handle: AppHandle
"""Global singleton AppHandle, which will be initialized later."""


# Base model with camelCase conversion
class _BaseModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
    )


class VideoClipRequest(_BaseModel):
    """Request to clip a video segment.

    @property inputPath - Path to the input video file.
    @property outputPath - Path where the clipped video will be saved.
    @property startTime - Start time in seconds.
    @property endTime - End time in seconds (optional, defaults to video duration).
    """

    input_path: str
    output_path: str
    start_time: float = 0.0
    end_time: Optional[float] = None


class VideoInfoRequest(_BaseModel):
    """Request to get video information.

    @property inputPath - Path to the video file.
    """

    input_path: str


class PreviewRequest(_BaseModel):
    """Request to generate video preview.

    @property inputPath - Path to the input video file.
    @property startTime - Start time in seconds.
    @property endTime - End time in seconds (optional, defaults to video duration).
    """

    input_path: str
    start_time: float = 0.0
    end_time: Optional[float] = None


class VideoInfoResponse(_BaseModel):
    """Video information response.

    @property duration - Video duration in seconds.
    @property fps - Frames per second.
    @property size - Video resolution as [width, height].
    @property audio - Whether the video has audio track.
    """

    duration: float
    fps: float
    # incorrect ts type, see: <https://github.com/phillipdupuis/pydantic-to-typescript/issues/62>
    size: tuple[int, int]
    audio: bool


@commands.command()
async def clip_video(body: VideoClipRequest) -> str:
    """Clip a video segment.

    @param body - The video clip request parameters.
    """
    video = VideoFileClip(body.input_path)

    end_time = body.end_time if body.end_time else video.duration
    clipped: VideoClip = video.subclipped(body.start_time, end_time)

    await to_thread.run_sync(
        lambda: clipped.write_videofile(
            body.output_path, codec="libx264", audio_codec="aac"
        )
    )

    clipped.close()
    video.close()

    return f"Video clipped successfully: {body.output_path}"


@commands.command()
async def get_video_info(body: VideoInfoRequest) -> VideoInfoResponse:
    """Get information about a video file.

    @param body - The video info request parameters.
    """
    video = VideoFileClip(body.input_path)

    # video.size 返回 (width, height)
    size = video.size
    info = VideoInfoResponse(
        duration=video.duration,
        fps=video.fps,
        size=(int(size[0]), int(size[1])),
        audio=video.audio is not None,
    )

    video.close()

    return info


_preview_temp_path: Optional[Path] = None


@commands.command()
async def generate_preview(body: PreviewRequest) -> str:
    """Generate a preview video clip with lower quality for faster processing.

    @param body - The preview request parameters.
    """
    global _preview_temp_path

    video = VideoFileClip(body.input_path)

    end_time = body.end_time if body.end_time else video.duration
    clipped: VideoClip = video.subclipped(body.start_time, end_time)

    if _preview_temp_path is None:
        with NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            _preview_temp_path = Path(temp_file.name)

        def _cleanup_preview_file() -> None:
            global _preview_temp_path
            if _preview_temp_path and _preview_temp_path.exists():
                _preview_temp_path.unlink()
                _preview_temp_path = None

        atexit.register(_cleanup_preview_file)

    await to_thread.run_sync(
        lambda: clipped.write_videofile(
            str(_preview_temp_path),
            codec="libx264",
            audio_codec="aac",
            preset="ultrafast",
            bitrate="1000k",
        )
    )

    clipped.close()
    video.close()

    return str(_preview_temp_path)


# Supported video formats
VIDEO_FORMATS = ["mp4", "avi", "mov", "mkv", "webm"]


class VideoPathPayload(BaseModel):
    path: Path


@mcp.tool()
def load_video_from_path(video_path: str) -> dict:
    """Load a video file from the specified path into the video editor.

    This tool validates the video file format and sends an event to the frontend
    to load the video automatically.

    Args:
        video_path: Absolute path to the video file

    Returns:
        Dictionary with success status and message

    Raises:
        ValueError: If the file format is not supported
    """
    path = Path(video_path)

    # Check if file exists
    if not path.exists():
        raise ValueError(f"File not found: {video_path}")

    # Validate file extension
    file_extension = path.suffix.lstrip(".").lower()
    if file_extension not in VIDEO_FORMATS:
        raise ValueError(
            f"Unsupported video format: .{file_extension}. "
            f"Supported formats: {', '.join(VIDEO_FORMATS)}"
        )

    # Emit event to frontend
    abs_video_path = path.absolute()
    Emitter.emit(app_handle, "mcp-load-video", VideoPathPayload(path=abs_video_path))

    return {
        "success": True,
        "message": f"Video path sent to editor: {video_path}",
        "path": str(abs_video_path),
    }


def main() -> int:
    with start_blocking_portal("asyncio") as portal:
        mcp_task = portal.start_task_soon(mcp.run_streamable_http_async)

        if PYTAURI_GEN_TS:
            # Generate TypeScript client to frontend src/bindings directory
            output_dir = Path(__file__).parent.parent.parent.parent / "src" / "bindings"
            # CLI to run json-schema-to-typescript
            json2ts_cmd = "pnpm json2ts --format=false"

            # Start background task to generate TypeScript types
            portal.start_task_soon(
                lambda: commands.experimental_gen_ts_background(
                    output_dir, json2ts_cmd, cmd_alias=to_camel
                )
            )

        app = builder_factory().build(
            context=context_factory(),
            invoke_handler=commands.generate_handler(portal),
        )

        global app_handle
        app_handle = app.handle()

        exit_code = app.run_return()
        mcp_task.cancel()  # close the MCP server, or it will run forever
        return exit_code
