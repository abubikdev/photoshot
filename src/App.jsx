import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

const MAX_CAPTURES = 12;
const MAX_VIDEO_DURATION_MS = 60_000;
const MAX_VIDEO_DURATION_SECONDS = 60;
const VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    VIDEO_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function App() {
  const webcamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimeoutRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const capturesRef = useRef([]);
  const [captures, setCaptures] = useState([]);
  const [mode, setMode] = useState("photo");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const videoConstraints = {
    aspectRatio: 9 / 16,
    facingMode: "user",
  };

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  const clearRecordingTimers = useCallback(() => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRecordingTimers();

      capturesRef.current.forEach((capture) => {
        if (capture.type === "video") {
          URL.revokeObjectURL(capture.src);
        }
      });
    };
  }, [clearRecordingTimers]);

  const appendCapture = useCallback((nextCapture) => {
    setCaptures((currentCaptures) => {
      const nextCaptures = [nextCapture, ...currentCaptures];
      const trimmedCaptures = nextCaptures.slice(MAX_CAPTURES);

      trimmedCaptures.forEach((capture) => {
        if (capture.type === "video") {
          URL.revokeObjectURL(capture.src);
        }
      });

      return nextCaptures.slice(0, MAX_CAPTURES);
    });
  }, []);

  const capturePhoto = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();

    if (src) {
      appendCapture({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "photo",
        src,
      });
    }
  }, [appendCapture]);

  const stopVideoCapture = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }, []);

  const startVideoCapture = useCallback(() => {
    const stream = webcamRef.current?.stream;

    if (!stream || typeof MediaRecorder === "undefined") {
      return;
    }

    clearRecordingTimers();
    recordedChunksRef.current = [];

    const mimeType = getSupportedVideoMimeType();
    const mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorderRef.current = mediaRecorder;
    recordingStartedAtRef.current = Date.now();

    mediaRecorder.ondataavailable = ({ data }) => {
      if (data && data.size > 0) {
        recordedChunksRef.current.push(data);
      }
    };

    mediaRecorder.onstop = () => {
      const durationMs = recordingStartedAtRef.current
        ? Date.now() - recordingStartedAtRef.current
        : 0;
      const duration = Math.min(
        MAX_VIDEO_DURATION_SECONDS,
        Math.max(1, Math.round(durationMs / 1000)),
      );
      const chunks = recordedChunksRef.current;
      const nextMimeType = mediaRecorder.mimeType || "video/webm";

      clearRecordingTimers();
      mediaRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      recordedChunksRef.current = [];
      setIsRecording(false);
      setRecordingSeconds(0);

      if (chunks.length === 0) {
        return;
      }

      const blob = new Blob(chunks, { type: nextMimeType });

      if (blob.size === 0) {
        return;
      }

      appendCapture({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "video",
        src: URL.createObjectURL(blob),
        duration,
      });
    };

    mediaRecorder.start();
    setIsRecording(true);
    setRecordingSeconds(0);

    recordingIntervalRef.current = window.setInterval(() => {
      const elapsedSeconds = recordingStartedAtRef.current
        ? Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
        : 0;

      setRecordingSeconds(
        Math.min(elapsedSeconds, MAX_VIDEO_DURATION_SECONDS),
      );
    }, 250);

    recordingTimeoutRef.current = window.setTimeout(() => {
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }, MAX_VIDEO_DURATION_MS);
  }, [appendCapture, clearRecordingTimers]);

  const handleShutter = useCallback(() => {
    if (mode === "photo") {
      capturePhoto();
      return;
    }

    if (isRecording) {
      stopVideoCapture();
      return;
    }

    startVideoCapture();
  }, [capturePhoto, isRecording, mode, startVideoCapture, stopVideoCapture]);

  const latestCapture = captures[0];
  const hasVideoSupport = typeof MediaRecorder !== "undefined";
  const safeAreaStyle = {
    paddingTop: "max(1rem, env(safe-area-inset-top))",
    paddingBottom: "max(1.15rem, env(safe-area-inset-bottom))",
  };

  return (
    <main
      className="min-h-[100dvh] bg-black px-5 text-white"
      style={safeAreaStyle}
    >
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col justify-center">
        <div className="relative mx-auto w-full max-w-[470px]">
          <div className="relative aspect-[2/3] overflow-hidden rounded-[2.35rem]">
            <div className="absolute inset-0">
              <Webcam
                ref={webcamRef}
                mirrored
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={videoConstraints}
                className="h-full w-full bg-[#0f172a] object-cover"
              />
            </div>

            <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(15,23,42,0.42)_0%,_rgba(15,23,42,0.2)_36%,_rgba(15,23,42,0.46)_100%)]" />

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_58%)]" />

            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <h1 className="text-5xl font-semibold tracking-tight text-white">
                Capture Area
              </h1>
              <p className="mt-1 text-[2rem] text-white/90">Live camera feed</p>
            </div>

            {mode === "video" && (
              <div className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs uppercase tracking-[0.22em] text-white/85 backdrop-blur-sm">
                {isRecording
                  ? `Rec ${formatDuration(recordingSeconds)}`
                  : "Video Mode"}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto mt-7 w-full max-w-[470px]">
          <div className="grid grid-cols-[4.25rem_1fr_4.25rem] items-center">
            <div aria-hidden className="size-[4.25rem]" />

            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleShutter}
                className="grid size-[6.55rem] place-items-center rounded-full border border-white/20 bg-white/10 p-2 transition hover:scale-[1.02] hover:bg-white/14 active:scale-95"
                aria-label={
                  mode === "video"
                    ? isRecording
                      ? "Stop recording"
                      : "Start recording"
                    : "Capture photo"
                }
              >
                <span className="grid size-full place-items-center rounded-full border-[3px] border-white/85 bg-white/95">
                  <span
                    className={`${
                      mode === "video"
                        ? isRecording
                          ? "size-9 rounded-md bg-red-600"
                          : "size-[4.2rem] rounded-full bg-red-500"
                        : "size-[4.2rem] rounded-full bg-slate-900"
                    } transition-all`}
                  />
                </span>
              </button>
            </div>

            {latestCapture ? (
              <div className="relative size-[4.25rem] overflow-hidden rounded-full border border-white/35 bg-slate-900 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                {latestCapture.type === "video" ? (
                  <video
                    src={latestCapture.src}
                    className="h-full w-full object-cover"
                    muted
                    autoPlay
                    loop
                    playsInline
                  />
                ) : (
                  <img
                    src={latestCapture.src}
                    alt="Latest capture"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            ) : (
              <div className="grid size-[4.25rem] place-items-center rounded-full border border-white/20 bg-white/[0.06] text-[0.62rem] text-white/45">
                0
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-center gap-8 text-[2rem] text-white/42">
            <button
              type="button"
              onClick={() => setMode("photo")}
              disabled={isRecording}
              className={mode === "photo" ? "text-white" : ""}
            >
              Photo
            </button>
            <button
              type="button"
              onClick={() => setMode("video")}
              disabled={isRecording || !hasVideoSupport}
              className={mode === "video" ? "text-white" : ""}
            >
              Video
            </button>
          </div>

          {!hasVideoSupport && (
            <p className="mt-3 text-center text-xs text-white/45">
              Video recording is not supported in this browser.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
