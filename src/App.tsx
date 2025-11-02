import { useState, useRef, useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { 
  Film, 
  Scissors, 
  Play, 
  Pause, 
  FolderOpen,
  Eye,
  Download
} from "lucide-react";
import { VideoTimeline } from "./components/VideoTimeline";
import * as api from "./bindings/apiClient";
import type { Commands } from "./bindings/_apiTypes";
import "./App.css";

type VideoInfo = Commands["get_video_info"]["output"];

function App() {
  // Video state
  const [videoPath, setVideoPath] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoSrc, setVideoSrc] = useState("");
  
  // Timeline state
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Preview state
  const [previewPath, setPreviewPath] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  
  // UI state
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  // Shared video loading logic
  const loadVideo = async (path: string, source: "manual" | "mcp") => {
    setStatus(source === "mcp" ? `Loading video from MCP: ${path}` : "Loading video...");
    setVideoPath(path);
    setPreviewPath("");
    setPreviewSrc("");
    
    try {
      const info = await api.getVideoInfo({ inputPath: path });
      
      setVideoInfo(info);
      setEndTime(info.duration);
      setStartTime(0);
      setCurrentTime(0);
      setVideoSrc(convertFileSrc(path));
      
      const prefix = source === "mcp" ? "Video loaded via MCP" : "Video loaded";
      setStatus(`${prefix}: ${info.duration.toFixed(2)}s, ${info.size[0]}x${info.size[1]}`);
    } catch (error) {
      setStatus(`Error ${source === "mcp" ? "loading video from MCP" : ""}: ${error}`);
    }
  };

  // Listen for MCP load video events
  useEffect(() => {
    const unlisten = listen<{ path: string }>("mcp-load-video", (event) => {
      loadVideo(event.payload.path, "mcp");
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // Load video manually
  const handleLoadVideo = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Video", extensions: ["mp4", "avi", "mov", "mkv", "webm"] }],
    });

    if (selected) {
      await loadVideo(selected, "manual");
    }
  };

  // Generate preview
  const handleGeneratePreview = async () => {
    if (!videoPath) return;
    
    setIsGeneratingPreview(true);
    setStatus("Generating preview...");
    
    try {
      const result = await api.generatePreview({
        inputPath: videoPath,
        startTime,
        endTime,
      });

      setPreviewPath(result);
      const assetUrl = convertFileSrc(result);
      setPreviewSrc(assetUrl);
      setStatus("Preview generated successfully!");
    } catch (error) {
      setStatus(`Error generating preview: ${error}`);
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  // Save final video
  const handleSaveVideo = async () => {
    if (!videoPath) return;
    
    const savePath = await save({
      filters: [{ name: "Video", extensions: ["mp4"] }],
      defaultPath: "edited_video.mp4",
    });

    if (savePath) {
      setIsSaving(true);
      setStatus("Saving video...");
      
      try {
        const result = await api.clipVideo({
          inputPath: videoPath,
          outputPath: savePath,
          startTime: startTime,
          endTime: endTime,
        });
        
        setStatus(result);
      } catch (error) {
        setStatus(`Error: ${error}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  // Video playback controls
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      
      // Loop within selection
      if (videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;
      }
    }
  };

  const handleTimeChange = (start: number, end: number) => {
    setStartTime(start);
    setEndTime(end);
    
    // Update video position
    if (videoRef.current && videoRef.current.currentTime < start) {
      videoRef.current.currentTime = start;
    }
  };

  useEffect(() => {
    if (videoRef.current && videoSrc) {
      videoRef.current.currentTime = startTime;
    }
  }, [videoSrc, startTime]);

  return (
    <div className="h-screen bg-linear-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-700/50">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-2xl lg:text-3xl font-bold mb-1 bg-linear-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            🎬 Video Editor
          </h1>
          <p className="text-gray-400 text-xs lg:text-sm">Powered by PyTauri + MoviePy</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-7xl mx-auto space-y-4">
        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{/* Original Video Panel */}
          <div className="bg-gray-800/50 backdrop-blur rounded-xl p-4 border border-gray-700 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Film className="w-5 h-5" />
                Original Video
              </h2>
              <button
                onClick={handleLoadVideo}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm"
              >
                <FolderOpen className="w-4 h-4" />
                Load Video
              </button>
            </div>

            <div className="w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "16/9", maxHeight: "280px" }}>
              {videoSrc ? (
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="w-full h-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Film className="w-16 h-16 mx-auto mb-2 opacity-50" />
                    <p>No video loaded</p>
                  </div>
                </div>
              )}
            </div>

            {/* Video Info */}
            {videoInfo && (
              <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400">Duration:</span> <span className="font-mono">{videoInfo.duration.toFixed(2)}s</span></div>
                  <div><span className="text-gray-400">FPS:</span> <span className="font-mono">{videoInfo.fps}</span></div>
                  <div><span className="text-gray-400">Resolution:</span> <span className="font-mono">{videoInfo.size[0] as number}x{videoInfo.size[1] as number}</span></div>
                  <div><span className="text-gray-400">Audio:</span> <span className="font-mono">{videoInfo.audio ? "Yes" : "No"}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Preview Panel */}
          <div className="bg-gray-800/50 backdrop-blur rounded-xl p-4 border border-gray-700 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Preview
              </h2>
              <button
                onClick={handleGeneratePreview}
                disabled={!videoPath || isGeneratingPreview}
                className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors text-sm"
              >
                <Scissors className="w-4 h-4" />
                {isGeneratingPreview ? "Generating..." : "Generate Preview"}
              </button>
            </div>

            <div className="w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "16/9", maxHeight: "280px" }}>
              {previewSrc ? (
                <video
                  ref={previewRef}
                  src={previewSrc}
                  controls
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Eye className="w-16 h-16 mx-auto mb-2 opacity-50" />
                    <p>No preview generated</p>
                  </div>
                </div>
              )}
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveVideo}
              disabled={!previewPath || isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors font-semibold text-sm"
            >
              <Download className="w-5 h-5" />
              {isSaving ? "Saving..." : "Save Final Video"}
            </button>
          </div>
        </div>

        {/* Timeline Editor */}
        {videoInfo && (
          <div className="bg-gray-800/50 backdrop-blur rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Scissors className="w-5 h-5" />
                Timeline Editor
              </h2>
              {videoSrc && (
                <button
                  onClick={handlePlayPause}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors font-semibold text-sm"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Play
                    </>
                  )}
                </button>
              )}
            </div>
            
            <VideoTimeline
              duration={videoInfo.duration}
              startTime={startTime}
              endTime={endTime}
              currentTime={currentTime}
              onTimeChange={handleTimeChange}
            />
          </div>
        )}

        {/* Status Bar */}
        <div className="bg-gray-800/50 backdrop-blur rounded-xl p-3 border border-gray-700">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.includes('Error') ? 'bg-red-500' : status.includes('successfully') ? 'bg-green-500' : 'bg-blue-500'} animate-pulse`} />
            <span className="text-xs font-mono truncate">{status || "Ready"}</span>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default App;
