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
)

from moviepy import VideoClip, VideoFileClip

# Enable TypeScript generation in development
PYTAURI_GEN_TS = getenv("PYTAURI_GEN_TS") != "0"

commands: Commands = Commands(experimental_gen_ts=PYTAURI_GEN_TS)


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

    clipped.write_videofile(body.output_path, codec="libx264", audio_codec="aac")

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

    clipped.write_videofile(
        str(_preview_temp_path),
        codec="libx264",
        audio_codec="aac",
        preset="ultrafast",
        bitrate="1000k",
    )

    clipped.close()
    video.close()

    return str(_preview_temp_path)


def main() -> int:
    with start_blocking_portal("asyncio") as portal:
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
        exit_code = app.run_return()
        return exit_code
